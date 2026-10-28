<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
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
 * Module clamp (presentation, not security): a capability for a module the academy does not have
 * — video rooms, the LMS, CRM, payroll… — is not offered at all, and is left out of the role
 * details too. The `entitled:*` route gates already make such a grant inert; listing it only put
 * "Create classrooms" in front of an academy with no classroom. A role that already holds one
 * keeps it through an edit (see update()), so gaining the module later needs no re-ticking.
 *
 * Roles are tenant-scoped (RLS on academy_roles / academy_role_permissions). The role `code`
 * is a generated, globally-unique token so it can be stored verbatim in user_roles.role and
 * the app.current_role GUC without colliding with a system role or another academy's role.
 */
final class AcademyRoleController extends Controller
{
    /** System roles an academy may VIEW (never SUPER_ADMIN, never editable here), strongest first. */
    private const VISIBLE_SYSTEM_ROLES = [
        'ACADEMY_OWNER', 'MANAGER', 'SUPERVISOR', 'ACCOUNTANT', 'CUSTOMER_SERVICE', 'TEACHER', 'STAFF',
    ];

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
     * The capabilities the acting user holds and could delegate: their OWN capability set,
     * intersected with the academy-scoped catalog (so platform caps are excluded even for a Super
     * Admin acting inside an academy). The privilege clamp.
     *
     * @return list<string>
     */
    private function holdable(): array
    {
        $academyScoped = PermissionCatalog::roleMap()['ACADEMY_OWNER'];

        return array_values(array_intersect($this->ctx()->permissions, $academyScoped));
    }

    /**
     * What the builder offers and accepts: {@see holdable()} narrowed to the modules this academy
     * actually has. This is the allow-list for every grant.
     *
     * @return list<string>
     */
    private function grantable(?array $features = null): array
    {
        return PermissionCatalog::usableWith($this->holdable(), $features ?? $this->features());
    }

    /**
     * This academy's plan features. Deliberately not memoised on the controller: Laravel keeps
     * one controller instance per route, so a cached property would outlive the request.
     *
     * @return list<string>
     */
    private function features(): array
    {
        return Entitlement::resolve($this->academyId())['capabilities'];
    }

    /**
     * Reject any requested capability the acting user is not entitled to delegate.
     *
     * @param  list<string>  $requested
     */
    private function assertGrantable(array $requested): void
    {
        $extra = array_values(array_diff($requested, $this->grantable()));
        if ($extra === []) {
            return;
        }

        // Two different refusals: a module the academy lacks is an upgrade question, not an
        // escalation attempt, and saying "you do not hold" to an owner about their own
        // academy's capabilities would read as a bug.
        $notHeld = array_values(array_diff($extra, $this->holdable()));
        throw ValidationException::withMessages([
            'permissions' => [
                $notHeld !== []
                    ? 'You cannot grant capabilities you do not hold: '.implode(', ', $notHeld)
                    : 'These belong to a module this academy does not have: '.implode(', ', $extra)
                        .' / هذه الصلاحيات تتبع وحدة غير مفعّلة لدى الأكاديمية.',
            ],
        ]);
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

        $features = $this->features();
        $academyId = $this->academyId();

        $system = [];
        $effective = [];
        foreach (self::VISIBLE_SYSTEM_ROLES as $code) {
            $tunable = in_array($code, PermissionCatalog::TUNABLE_ROLES, true);
            // As THIS academy has it: a shared role carries the academy's own edits.
            $effective[$code] = PermissionResolver::forRoleIn($code, $academyId);
            $system[] = [
                'code'          => $code,
                'name'          => $code,
                'system'        => true,
                // Only what this academy can use: a TEACHER's `room.join` means nothing without
                // the video module, and listing it is how "rooms" showed up on a management-only
                // academy's roles page.
                'permissions'   => PermissionCatalog::usableWith($effective[$code], $features),
                'assignedCount' => $this->assignedCount($code),
                // The shared staff roles can be edited for this academy (tune()), and say when
                // they have been, so the page can offer "back to the default".
                'editable'      => $tunable,
                'tuned'         => $tunable && PermissionResolver::tuning($code, $academyId) !== null,
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
            'permissions'   => PermissionCatalog::usableWith($permsByRole[$r->id] ?? [], $features),
            'assignedCount' => $this->assignedCount($r->code),
        ])->all();

        $grantable = $this->grantable($features);

        // The builder's sections, narrowed to what this user may grant here: a section whose every
        // capability belongs to a module the academy lacks (or that the user does not hold) is
        // not offered at all.
        $areas = [];
        foreach (PermissionCatalog::AREAS as $area) {
            $view = array_values(array_intersect($area['view'], $grantable));
            $manage = array_values(array_intersect($area['manage'], $grantable));
            if ($view === [] && $manage === []) {
                continue;
            }
            $areas[] = ['key' => $area['key'], 'kind' => $area['kind'], 'view' => $view, 'manage' => $manage];
        }

        return response()->json([
            'system'    => $system,
            'custom'    => $custom,
            'grantable' => $grantable,
            'areas'     => $areas,
            // Which of the grantable capabilities move or reveal money, and which open a statistics
            // page. The builder marks both so an academy can SEE what it is handing over, rather
            // than having to know that `payout.adjust` is how an award gets paid.
            'financial'  => array_values(array_intersect($grantable, PermissionCatalog::FINANCIAL)),
            'statistics' => array_values(array_intersect($grantable, PermissionCatalog::STATISTICS)),
            // Starting points for a new role: each shared built-in role's own set (as this academy
            // has edited it), clamped to what the acting user may actually delegate — so "a
            // supervisor who only takes attendance" starts from the whole supervisor and unticks,
            // instead of from eighty empty boxes.
            'presets'   => array_map(fn (string $role): array => [
                'key'         => strtolower($role),
                'role'        => $role,
                'permissions' => array_values(array_intersect($grantable, $effective[$role])),
            ], ['MANAGER', 'SUPERVISOR', 'ACCOUNTANT', 'CUSTOMER_SERVICE']),
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
            // A capability this role holds for a module the academy has since lost (or never had)
            // is hidden from the builder, so the edit cannot mention it — carry it over rather than
            // silently stripping it, so re-gaining the module needs no re-ticking. Only ever what
            // the role ALREADY had: the builder still cannot add a hidden capability.
            $hidden = array_values(array_diff($this->holdable(), $this->grantable()));
            $kept = array_values(array_intersect($before['permissions'], $hidden));
            $this->assertGrantable(array_values(array_diff($data['permissions'], $kept)));
            $data['permissions'] = array_values(array_unique([...$data['permissions'], ...$kept]));
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

    /**
     * PUT /api/roles/system/{code} — edit a shared built-in role (supervisor, accountant, …) for
     * THIS academy only: `permissions` is the whole set its holders should have here.
     *
     * Stored as the difference from the platform's role (academy_role_tunings), so what the
     * platform adds to the role later still arrives. The builder only shows what this user may
     * grant in this academy's modules; capabilities outside that view are carried over untouched
     * (an LMS capability the academy cannot see is neither granted nor stripped by the edit).
     * Adding is clamped like the custom-role builder — nobody hands out what they do not hold;
     * taking away is always allowed.
     */
    public function tune(Request $request, string $code): JsonResponse
    {
        Gate::authorize('role.manage');

        $academyId = $this->academyId();
        if (! in_array($code, PermissionCatalog::TUNABLE_ROLES, true)) {
            abort(404, 'This role cannot be edited.');
        }

        $data = $request->validate([
            'permissions'   => ['present', 'array'],
            'permissions.*' => ['string', Rule::in(PermissionCatalog::PERMISSIONS)],
        ]);
        $wanted = array_values(array_unique($data['permissions']));

        $base = PermissionResolver::forRole($code);
        $current = PermissionResolver::forRoleIn($code, $academyId);
        $visible = $this->grantable();
        $this->assertGrantable(array_values(array_diff($wanted, $current)));

        $final = array_values(array_unique([...array_diff($current, $visible), ...$wanted]));
        $added = array_values(array_diff($final, $base));
        $removed = array_values(array_diff($base, $final));
        sort($added);
        sort($removed);

        if ($added === [] && $removed === []) {
            DB::table('academy_role_tunings')->where('role', $code)->delete();
        } else {
            DB::table('academy_role_tunings')->updateOrInsert(
                ['academy_id' => $academyId, 'role' => $code],
                [
                    'added'      => $this->pgArray($added),
                    'removed'    => $this->pgArray($removed),
                    'updated_at' => now(),
                ],
            );
        }

        Audit::log('role.tune', 'role', null, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['role' => $code, 'added' => $added, 'removed' => $removed],
            before: ['role' => $code, 'permissions' => $current]);

        return response()->json(['ok' => true, 'added' => $added, 'removed' => $removed]);
    }

    /** DELETE /api/roles/system/{code} — put a built-in role back exactly as the platform ships it. */
    public function resetTuning(string $code): JsonResponse
    {
        Gate::authorize('role.manage');

        $academyId = $this->academyId();
        if (! in_array($code, PermissionCatalog::TUNABLE_ROLES, true)) {
            abort(404, 'This role cannot be edited.');
        }

        $before = PermissionResolver::tuning($code, $academyId);
        DB::table('academy_role_tunings')->where('role', $code)->delete(); // RLS: this academy's row

        if ($before !== null) {
            Audit::log('role.tune_reset', 'role', null, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['role' => $code], before: ['role' => $code] + $before);
        }

        return response()->json(['ok' => true]);
    }

    /** A Postgres text[] literal for a list of capability codes (codes are [a-z_.] only). */
    private function pgArray(array $codes): string
    {
        return '{'.implode(',', array_map(fn (string $c) => '"'.$c.'"', $codes)).'}';
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
