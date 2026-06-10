<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Resolves a role's capability codes from `role_permissions ⋈ permissions` (Sprint 2 §5.1).
 *
 * Authorization is data, not code: the set returned here is whatever the tables say right
 * now, so granting/revoking a capability — or introducing a whole new role — is a row
 * change with zero code change (Master Spec §4 design note). The `permissions` /
 * `role_permissions` tables are the platform catalog (RLS `catalog_select using (true)`),
 * so this read needs no tenant context and is safe to run before the GUCs are set.
 */
final class PermissionResolver
{
    /**
     * The capability codes granted to a role.
     *
     * @return list<string>
     */
    public static function forRole(string $role): array
    {
        return DB::table('role_permissions as rp')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('rp.role', $role)
            ->orderBy('p.code')
            ->pluck('p.code')
            ->all();
    }
}
