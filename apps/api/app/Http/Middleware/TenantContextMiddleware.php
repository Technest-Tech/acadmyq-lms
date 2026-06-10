<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\AuthContext;
use App\Support\PermissionResolver;
use App\Support\Tenancy;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * The auth → GUC bridge (Sprint 2 §4) — the linchpin that turns "who is logged in" into
 * "what the database lets them touch". Registered on the authenticated API group, it runs
 * AFTER Sanctum's auth:sanctum, on every authenticated request:
 *
 *   1. Take the Sanctum-authenticated user. None → no context (fail closed; the auth
 *      middleware has already 401'd, but we never set context without a user).
 *   2. Inactive user (is_active = false) → 401, context never set (fail closed, §4.1 step 3).
 *   3. Resolve role + academy from user_roles (via the BYPASSRLS function, since user_roles
 *      is itself RLS-protected and no context is set yet). Super Admin's academy is the one
 *      they have "entered" (server session), else NULL.
 *   4. No resolvable role → 401 (fail closed; never default to an academy, §3.4).
 *   5. Load the role's capability set (role_permissions) and bind an AuthContext for the
 *      Gate::before callback (§5.1).
 *   6. Run the rest of the request inside ONE transaction whose three app.* GUCs are set
 *      transaction-locally (Tenancy::withContext). RLS now scopes every query; the GUCs
 *      vanish with the transaction, so nothing leaks across a pooled connection (§4.2).
 */
final class TenantContextMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null) {
            return $next($request); // fail closed: no user, no context
        }

        if (! $user->is_active) {
            abort(401, 'Inactive account.');
        }

        [$role, $academyId] = $this->resolveRoleAndAcademy($request, $user);

        if ($role === null) {
            abort(401, 'No role assigned.'); // fail closed — never default to an academy
        }

        $ctx = new AuthContext(
            userId: (string) $user->getKey(),
            academyId: $academyId,
            role: $role,
            permissions: PermissionResolver::forRole($role),
        );

        // Bind for the Gate::before callback (AuthServiceProvider) for this request.
        app()->instance(AuthContext::class, $ctx);

        return Tenancy::withContext($ctx, fn () => $next($request));
    }

    /**
     * Resolve the active role and the academy the request operates within.
     *
     * SUPER_ADMIN keeps academy_id NULL (platform view) unless they have "entered" an
     * academy, which is stored server-side in the session (§4.4). ACADEMY_OWNER / TEACHER
     * operate within the academy of their role assignment.
     *
     * @return array{0: ?string, 1: ?string} [role, academyId]
     */
    private function resolveRoleAndAcademy(Request $request, object $user): array
    {
        // user_roles is RLS-protected and no context is set yet → read via the BYPASSRLS
        // function. A user has a single active role in the MVP; if several, prefer the
        // platform role (SUPER_ADMIN) so an entered-academy super admin keeps super powers.
        $roles = DB::select('select role, academy_id from app.auth_user_roles(?::uuid)', [$user->getKey()]);

        if ($roles === []) {
            return [null, null];
        }

        $superAdmin = collect($roles)->firstWhere('role', 'SUPER_ADMIN');

        if ($superAdmin !== null) {
            $entered = $request->hasSession() ? $request->session()->get('entered_academy_id') : null;

            return ['SUPER_ADMIN', $entered ?: null];
        }

        $assignment = $roles[0];

        return [$assignment->role, $assignment->academy_id !== null ? (string) $assignment->academy_id : null];
    }
}
