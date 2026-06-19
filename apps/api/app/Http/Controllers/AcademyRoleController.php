<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\PermissionCatalog;
use App\Support\PermissionResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Academy-facing CUSTOM role builder (the "let academies define their own roles" half of the
 * staff/RBAC design). The platform owns the PERMISSION catalog; an academy composes its own
 * named roles from the subset of capabilities it already holds, then assigns them to staff.
 *
 * Two layers guard every write:
 *  - Gate `role.manage` (RBAC — held by ACADEMY_OWNER / SUPER_ADMIN).
 *  - `entitled:custom_roles` route middleware (plan gate) on the mutating endpoints, so the
 *    builder is a paid capability while LISTING roles (to assign STAFF) stays free.
 *
 * Privilege-escalation clamp (the security boundary): an academy may only grant capabilities
 * the ACTING user themselves holds, intersected with the academy-scoped catalog — so a custom
 * role can never exceed its creator, and platform capabilities are unreachable by construction.
 * Capability codes are validated against this grantable set on every create/update.
 *
 * Roles are tenant-scoped (RLS on academy_roles / academy_role_permissions). The role `code`
 * is a generated, globally-unique token so it can be stored verbatim in user_roles.role and
 * the app.current_role GUC without colliding with a system role or another academy's role.
 */
final class AcademyRoleController extends Controller
{
    /** System roles an academy may VIEW/assign (never SUPER_ADMIN, never editable here). */
    private const ASSIGNABLE_SYSTEM_ROLES = ['ACADEMY_OWNER', 'TEACHER', 'STAFF'];

    private function ctx(): AuthContext
    {
        return app(AuthContext::class);
    }

    /** The academy this request is scoped to; contextless callers cannot manage roles. */
    private function academyId(): string
    {
        $id = $this->ctx()->academyId;
        if ($id === null) {
            abort(403, 'Enter an academy to manage its roles.');
        }

        return $id;
    }

    /**
     * The capabilities the acting user may hand out: their OWN capability set, intersected with
     * the academy-scoped catalog (so platform caps are excluded even for a Super Admin acting
     * inside an academy). This is the allow-list for every grant.
     *
     * @return list<string>
     */
    private function grantable(): array
    {
        $academyScoped = PermissionCatalog::roleMap()['ACADEMY_OWNER'];

        return array_values(array_intersect($this->ctx()->permissions, $academyScoped));
    }

    /**
     * Reject any requested capability the acting user is not entitled to delegate.
     *
     * @param  list<string>  $requested
     */
    private function assertGrantable(array $requested): void
    {
        $extra = array_values(array_diff($requested, $this->grantable()));
        if ($extra !== []) {
            throw ValidationException::withMessages([
                'permissions' => ['You cannot grant capabilities you do not hold: '.implode(', ', $extra)],
            ]);
        }
    }

    /** How many user_roles rows reference this role code (tenant-scoped by RLS). */
    private function assignedCount(string $code): int
    {
        return (int) DB::table('user_roles')->where('role', $code)->count();
    }

    /** Replace a custom role's capability grants with $codes. Caller wraps in a transaction. */
    private function syncPermissions(string $academyId, string $roleId, array $codes): void
    {
        $permIds = DB::table('permissions')->whereIn('code', $codes)->pluck('id', 'code');

        DB::table('academy_role_permissions')->where('role_id', $roleId)->delete();
        foreach (array_unique($codes) as $code) {
            DB::table('academy_role_permissions')->insert([
                'academy_id'    => $academyId,
                'role_id'       => $roleId,
                'permission_id' => $permIds[$code],
            ]);
        }
    }

    /** GET /api/roles — assignable system roles, this academy's custom roles, grantable catalog. */
    public function index(): JsonResponse
    {
        Gate::authorize('role.manage');

        $system = [];
        foreach (self::ASSIGNABLE_SYSTEM_ROLES as $code) {
            $system[] = [
                'code'          => $code,
                'name'          => $code,
                'system'        => true,
                'permissions'   => PermissionResolver::forRole($code),
                'assignedCount' => $this->assignedCount($code),
            ];
        }

        $roles = DB::table('academy_roles')->orderBy('name')->get();

        $permsByRole = DB::table('academy_role_permissions as arp')
            ->join('permissions as p', 'p.id', '=', 'arp.permission_id')
            ->orderBy('p.code')
            ->get(['arp.role_id', 'p.code'])
            ->groupBy('role_id')
            ->map(fn ($rows) => $rows->pluck('code')->all());

        $custom = $roles->map(fn ($r) => [
            'id'            => $r->id,
            'code'          => $r->code,
            'name'          => $r->name,
            'description'   => $r->description,
            'isActive'      => (bool) $r->is_active,
            'system'        => false,
            'permissions'   => $permsByRole[$r->id] ?? [],
            'assignedCount' => $this->assignedCount($r->code),
        ])->all();

        return response()->json([
            'system'    => $system,
            'custom'    => $custom,
            'grantable' => $this->grantable(),
        ]);
    }

    /** POST /api/roles — create a custom role (+ its capability grants). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('role.manage');

        $academyId = $this->academyId();
        $data = $this->validatePayload($request, creating: true);
        $this->assertGrantable($data['permissions']);

        $roleId = (string) Str::uuid();
        // Globally-unique, system-code-proof token (never matches SUPER_ADMIN/OWNER/TEACHER/STAFF).
        $code = 'CR_'.str_replace('-', '', $roleId);

        try {
            DB::transaction(function () use ($academyId, $roleId, $code, $data) {
                DB::table('academy_roles')->insert([
                    'id'          => $roleId,
                    'academy_id'  => $academyId,
                    'code'        => $code,
                    'name'        => $data['name'],
                    'description' => $data['description'] ?? null,
                    'is_active'   => true,
                    'created_at'  => now(),
                    'updated_at'  => now(),
                ]);
                $this->syncPermissions($academyId, $roleId, $data['permissions']);
            });
        } catch (\Throwable $e) {
            if (($e->getCode() === '23505') || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505')) {
                throw ValidationException::withMessages(['name' => ['A role with that name already exists.']]);
            }
            throw $e;
        }

        Audit::log('role.create', 'role', $roleId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'name'        => $data['name'],
            'permissions' => $data['permissions'],
        ]);

        return response()->json(['roleId' => $roleId, 'code' => $code], 201);
    }

    /** PATCH /api/roles/{id} — rename / re-describe / re-grant / (de)activate a custom role. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('role.manage');

        $academyId = $this->academyId();
        $role = DB::table('academy_roles')->where('id', $id)->first(); // RLS scopes to this academy
        if ($role === null) {
            abort(404, 'Role not found.');
        }

        $data = $this->validatePayload($request, creating: false);

        $fields = [];
        foreach (['name', 'description'] as $col) {
            if (array_key_exists($col, $data)) {
                $fields[$col] = $data[$col];
            }
        }
        if (array_key_exists('is_active', $data)) {
            $fields['is_active'] = (bool) $data['is_active'];
        }

        $before = ['permissions' => PermissionResolver::forRole($role->code)];

        if (array_key_exists('permissions', $data)) {
            $this->assertGrantable($data['permissions']);
        }

        try {
            DB::transaction(function () use ($id, $academyId, $fields, $data) {
                if ($fields !== []) {
                    DB::table('academy_roles')->where('id', $id)->update($fields + ['updated_at' => now()]);
                }
                if (array_key_exists('permissions', $data)) {
                    $this->syncPermissions($academyId, $id, $data['permissions']);
                }
            });
        } catch (\Throwable $e) {
            if (($e->getCode() === '23505') || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505')) {
                throw ValidationException::withMessages(['name' => ['A role with that name already exists.']]);
            }
            throw $e;
        }

        Audit::log('role.update', 'role', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: $fields + (array_key_exists('permissions', $data) ? ['permissions' => $data['permissions']] : []),
            before: $before);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/roles/{id} — remove a custom role (blocked while still assigned). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('role.manage');

        $academyId = $this->academyId();
        $role = DB::table('academy_roles')->where('id', $id)->first();
        if ($role === null) {
            abort(404, 'Role not found.');
        }

        if ($this->assignedCount($role->code) > 0) {
            throw ValidationException::withMessages([
                'role' => ['This role is still assigned to one or more users. Reassign them before deleting it.'],
            ]);
        }

        DB::table('academy_roles')->where('id', $id)->delete(); // cascades academy_role_permissions

        Audit::log('role.delete', 'role', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, before: [
            'name' => $role->name,
        ]);

        return response()->json(['ok' => true]);
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'name'          => [$req, 'string', 'max:120'],
            'description'   => ['sometimes', 'nullable', 'string', 'max:500'],
            'permissions'   => [$creating ? 'present' : 'sometimes', 'array'],
            'permissions.*' => ['string', Rule::in(PermissionCatalog::PERMISSIONS)],
            'is_active'     => ['sometimes', 'boolean'],
        ]);
    }
}
