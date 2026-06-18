<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * Super Admin cross-tenant user management (admin panel — Phase 4). Reads go through the
 * audited `app.admin_list_users()` / `app.admin_user_detail()` SECURITY DEFINER hatches
 * (§3.4); every WRITE (deactivate/reactivate, role assign/revoke) runs inside the target
 * user's academy context via Tenancy::withContext so the standard tenant `with check` admits
 * it — never a context-free or wrong-tenant write. All writes are audited (before/after).
 *
 * Two-layer authz: a capability Gate first (user.read_platform for reads, role.assign for
 * role changes), RLS as the database backstop.
 */
final class UserController extends Controller
{
    private const MAX_PAGE_SIZE = 100;

    private const ROLES = ['SUPER_ADMIN', 'ACADEMY_OWNER', 'TEACHER'];

    /** GET /api/admin/users — platform-wide, filterable user list. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('user.read_platform');

        $filters = $request->validate([
            'academy' => ['nullable', 'uuid'],
            'role' => ['nullable', Rule::in(self::ROLES)],
            'active' => ['nullable', 'boolean'],
            'search' => ['nullable', 'string', 'max:128'],
            'page' => ['nullable', 'integer', 'min:1'],
            'pageSize' => ['nullable', 'integer', 'min:1'],
        ]);

        $page = max(1, (int) ($filters['page'] ?? 1));
        $pageSize = max(1, min((int) ($filters['pageSize'] ?? 25), self::MAX_PAGE_SIZE));
        $offset = ($page - 1) * $pageSize;

        $json = DB::selectOne(
            'select app.admin_list_users(?::uuid, ?, ?::boolean, ?, ?, ?) as u',
            [
                $filters['academy'] ?? null,
                $filters['role'] ?? null,
                array_key_exists('active', $filters) ? (bool) $filters['active'] : null,
                $filters['search'] ?? null,
                $pageSize,
                $offset,
            ],
        )->u;

        $result = json_decode($json, true) ?: ['rows' => [], 'total' => 0];

        return response()->json([
            'rows' => $result['rows'] ?? [],
            'total' => $result['total'] ?? 0,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    /** GET /api/admin/users/{id} — one user with their roles across academies. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('user.read_platform');

        $user = $this->detail($id);
        if ($user === null) {
            abort(404, 'User not found.');
        }

        return response()->json(['user' => $user]);
    }

    /** POST /api/admin/users/{id}/deactivate — block this user's login (is_active=false). */
    public function deactivate(string $id): JsonResponse
    {
        return $this->setActive($id, false);
    }

    /** POST /api/admin/users/{id}/reactivate — restore this user's login. */
    public function reactivate(string $id): JsonResponse
    {
        return $this->setActive($id, true);
    }

    /** POST /api/admin/users/{id}/reset-password — send a fresh set-password link. */
    public function resetPassword(string $id): JsonResponse
    {
        Gate::authorize('user.read_platform');

        $user = $this->detail($id);
        if ($user === null) {
            abort(404, 'User not found.');
        }

        $ctx = app(AuthContext::class);

        try {
            Password::broker()->sendResetLink(['email' => $user['email']]);
        } catch (Throwable) {
            // Best-effort, retriable side effect (same posture as owner provisioning, §10).
        }

        Audit::log('user.reset_password', 'user', $id, $user['academy_id'], $ctx->userId, $ctx->role,
            after: ['email' => $user['email']]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/admin/users/{id}/roles — grant or revoke a role for the user in an academy. */
    public function setRole(Request $request, string $id): JsonResponse
    {
        // Platform-level user management first (an Owner has role.assign for their OWN staff,
        // but must never reach the cross-tenant path), then the finer role.assign capability.
        Gate::authorize('user.read_platform');
        Gate::authorize('role.assign');

        $user = $this->detail($id);
        if ($user === null) {
            abort(404, 'User not found.');
        }

        $data = $request->validate([
            'academy_id' => ['required', 'uuid', Rule::exists('academies', 'id')],
            'role' => ['required', Rule::in(['ACADEMY_OWNER', 'TEACHER'])],
            'grant' => ['required', 'boolean'],
        ]);

        $ctx = app(AuthContext::class);
        $academyId = $data['academy_id'];
        $role = $data['role'];
        $grant = (bool) $data['grant'];

        $this->inAcademyContext($academyId, function () use ($id, $academyId, $role, $grant, $ctx) {
            $exists = DB::table('user_roles')
                ->where('user_id', $id)->where('academy_id', $academyId)->where('role', $role)->exists();

            if ($grant && ! $exists) {
                DB::table('user_roles')->insert([
                    'id' => (string) Str::uuid(),
                    'user_id' => $id,
                    'academy_id' => $academyId,
                    'role' => $role,
                ]);
                Audit::log('role.assign', 'user_role', $id, $academyId, $ctx->userId, $ctx->role,
                    after: ['role' => $role]);
            } elseif (! $grant && $exists) {
                DB::table('user_roles')
                    ->where('user_id', $id)->where('academy_id', $academyId)->where('role', $role)->delete();
                Audit::log('role.revoke', 'user_role', $id, $academyId, $ctx->userId, $ctx->role,
                    before: ['role' => $role]);
            }
        });

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Toggle is_active inside the target user's academy context; audited. */
    private function setActive(string $id, bool $active): JsonResponse
    {
        Gate::authorize('user.read_platform');

        $user = $this->detail($id);
        if ($user === null) {
            abort(404, 'User not found.');
        }

        $ctx = app(AuthContext::class);

        // Platform users (no home academy) and self-deactivation are out of scope here:
        // there's no tenant context to admit the write, and a Super Admin must not lock itself out.
        if ($user['academy_id'] === null) {
            abort(422, 'This is a platform user and cannot be managed here.');
        }
        if ($id === $ctx->userId) {
            abort(422, 'You cannot change your own account status.');
        }

        $this->inAcademyContext($user['academy_id'], function () use ($id, $active, $user, $ctx) {
            DB::table('users')->where('id', $id)->update(['is_active' => $active, 'updated_at' => now()]);

            Audit::log($active ? 'user.reactivate' : 'user.deactivate', 'user', $id, $user['academy_id'],
                $ctx->userId, $ctx->role,
                after: ['is_active' => $active], before: ['is_active' => $user['is_active']]);
        });

        return response()->json(['ok' => true, 'isActive' => $active]);
    }

    /** Decode the audited cross-tenant detail read; null when no such user. */
    private function detail(string $id): ?array
    {
        $json = DB::selectOne('select app.admin_user_detail(?::uuid) as u', [$id])->u;

        return $json === null ? null : json_decode($json, true);
    }

    /** Run $fn inside $academyId's tenant context as the Super Admin (the audited write path). */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(
            userId: $ctx->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        );

        return Tenancy::withContext($target, $fn);
    }
}
