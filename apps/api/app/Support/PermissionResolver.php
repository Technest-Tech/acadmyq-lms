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

    /**
     * The capability codes a role holds INSIDE one academy: {@see forRole()} with the academy's own
     * edits to a shared built-in role applied (academy_role_tunings) — what it added, minus what it
     * took away. Stored as a difference, so a capability the platform adds to the role later still
     * arrives unless the academy removed that very one. Additions are clamped to the academy-scoped
     * catalog here too, so a bad row can never mint a platform capability. Reads through the
     * BYPASSRLS function: the request middleware calls this before the tenant context exists.
     *
     * @return list<string>
     */
    public static function forRoleIn(string $role, ?string $academyId): array
    {
        $base = self::forRole($role);
        if ($academyId === null || ! in_array($role, PermissionCatalog::TUNABLE_ROLES, true)) {
            return $base;
        }

        $tuning = self::tuning($role, $academyId);
        if ($tuning === null) {
            return $base;
        }

        $added = array_intersect($tuning['added'], PermissionCatalog::roleMap()['ACADEMY_OWNER']);
        $codes = array_values(array_diff(array_unique([...$base, ...$added]), $tuning['removed']));
        sort($codes);

        return $codes;
    }

    /**
     * An academy's edit to a built-in role, or null when it left the role as shipped.
     *
     * @return array{added: list<string>, removed: list<string>}|null
     */
    public static function tuning(string $role, string $academyId): ?array
    {
        $json = DB::selectOne('select app.auth_role_tuning(?::uuid, ?) as t', [$academyId, $role])?->t;
        if ($json === null) {
            return null;
        }
        $row = (array) json_decode((string) $json, true);

        return [
            'added' => array_values(array_map('strval', (array) ($row['added'] ?? []))),
            'removed' => array_values(array_map('strval', (array) ($row['removed'] ?? []))),
        ];
    }

    /**
     * Is this role code assignable and usable right now? System roles always are; a per-academy
     * custom role only while the academy keeps it active. Checked at login and on every request,
     * so a role switched off on the Roles page locks its holders out with a clear message instead
     * of resolving them to an empty capability set. Reads through the BYPASSRLS function because
     * both callers run before a tenant context exists.
     */
    public static function isActive(string $role): bool
    {
        return (bool) (DB::selectOne('select app.auth_role_active(?) as active', [$role])->active ?? false);
    }

    /** A custom (academy-built) role code, as opposed to a platform system role. */
    public static function isCustom(string $role): bool
    {
        return str_starts_with($role, 'CR_');
    }
}
