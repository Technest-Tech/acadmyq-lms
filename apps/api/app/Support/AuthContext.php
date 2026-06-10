<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The resolved authority for one request (Sprint 2 §4.3): who the user is, which academy
 * the request operates within, their role, and the capability codes that role grants.
 *
 * Built once per request by TenantContextMiddleware (from the Sanctum-authenticated user +
 * the permission tables), bound into the container, and consumed by:
 *   - Tenancy::withContext() → writes the three RLS GUCs from userId/academyId/role.
 *   - The Gate::before callback (AuthServiceProvider) → answers $user->can($code).
 *
 * Identity (userId) comes from the Sanctum session; authority (role/academyId/permissions)
 * is resolved from our tables on every request, so a revoked role takes effect immediately
 * (§3.7), never at next login.
 */
final class AuthContext
{
    /** @param  list<string>  $permissions */
    public function __construct(
        public readonly string $userId,
        public readonly ?string $academyId,
        public readonly string $role,
        public readonly array $permissions,
    ) {}

    /** Does this request's role grant the given capability code? */
    public function can(string $permission): bool
    {
        return in_array($permission, $this->permissions, true);
    }
}
