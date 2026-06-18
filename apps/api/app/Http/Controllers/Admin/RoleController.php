<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\PermissionCatalog;
use App\Support\PermissionResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Super Admin role ⇄ capability editor (admin panel — Phase 7), gated by `platform.manage`.
 * Authorization is data, not code: this rewrites the `role_permissions` catalog so a capability
 * re-mapping takes effect on the next session resolution (PermissionResolver), no deploy needed.
 *
 * Highest blast radius in the panel, so two guards: SUPER_ADMIN must always retain the
 * lockout-critical capabilities (you can never remove the very ability to edit roles), and every
 * change is audited with the full before/after capability lists. The catalog RLS
 * (`is_super_admin()`) is the DB backstop under the Gate.
 */
final class RoleController extends Controller
{
    private const ROLES = ['SUPER_ADMIN', 'ACADEMY_OWNER', 'TEACHER'];

    /**
     * Capabilities SUPER_ADMIN can never lose — without these the platform locks itself out of
     * its own administration (platform.manage gates this very editor).
     */
    private const LOCKOUT_CRITICAL = ['platform.manage'];

    /** GET /api/admin/roles — every role's current capabilities + the full catalog. */
    public function index(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $roles = [];
        foreach (self::ROLES as $role) {
            $roles[] = [
                'role' => $role,
                'permissions' => PermissionResolver::forRole($role),
            ];
        }

        return response()->json([
            'roles' => $roles,
            'catalog' => PermissionCatalog::PERMISSIONS,
            'lockoutCritical' => self::LOCKOUT_CRITICAL,
        ]);
    }

    /** PATCH /api/admin/roles/{role}/permissions — replace a role's capability set (audited). */
    public function setPermissions(Request $request, string $role): JsonResponse
    {
        Gate::authorize('platform.manage');

        if (! in_array($role, self::ROLES, true)) {
            abort(404, 'Role not found.');
        }

        $data = $request->validate([
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string', Rule::in(PermissionCatalog::PERMISSIONS)],
        ]);
        $codes = array_values(array_unique($data['permissions']));

        // Lockout guard: SUPER_ADMIN can never shed a lockout-critical capability.
        if ($role === 'SUPER_ADMIN') {
            $missing = array_diff(self::LOCKOUT_CRITICAL, $codes);
            if ($missing !== []) {
                throw ValidationException::withMessages([
                    'permissions' => ['SUPER_ADMIN must retain: '.implode(', ', $missing)],
                ]);
            }
        }

        $before = PermissionResolver::forRole($role);

        DB::transaction(function () use ($role, $codes) {
            $permIds = DB::table('permissions')->whereIn('code', $codes)->pluck('id', 'code');

            DB::table('role_permissions')->where('role', $role)->delete();
            foreach ($codes as $code) {
                DB::table('role_permissions')->insert([
                    'role' => $role,
                    'permission_id' => $permIds[$code],
                ]);
            }
        });

        $ctx = app(AuthContext::class);
        Audit::log('platform.role_permissions', 'role', null, null, $ctx->userId, $ctx->role,
            after: ['role' => $role, 'permissions' => $codes],
            before: ['role' => $role, 'permissions' => $before]);

        return response()->json(['ok' => true, 'permissions' => $codes]);
    }
}
