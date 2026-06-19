<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Resolves a role's capability codes (Sprint 2 §5.1).
 *
 * Authorization is data, not code: the set returned here is whatever the tables say right
 * now, so granting/revoking a capability — or introducing a whole new role — is a row
 * change with zero code change (Master Spec §4 design note).
 *
 * A role code may name either a SYSTEM role (platform `role_permissions` catalog) or a
 * per-academy CUSTOM role (`academy_role_permissions`). Both are unified behind the BYPASSRLS
 * `app.role_capabilities()` function: custom-role grants live in a tenant-scoped table, yet
 * this resolver runs while building the AuthContext — before the tenant GUCs are set — so it
 * needs the same SECURITY DEFINER escape hatch the auth lookups use (§7). System-role reads
 * still work with no context for the same reason they always did.
 */
final class PermissionResolver
{
    /**
     * The capability codes granted to a role (system or custom), sorted.
     *
     * @return list<string>
     */
    public static function forRole(string $role): array
    {
        return array_map(
            static fn (object $row): string => $row->code,
            DB::select('select code from app.role_capabilities(?) order by code', [$role]),
        );
    }
}
