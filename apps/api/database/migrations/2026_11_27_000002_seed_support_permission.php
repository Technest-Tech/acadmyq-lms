<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register `support.manage` — open the academy's Support page, raise a problem or a change request
 * and answer the platform team on it — and grant it to the SYSTEM roles that run the academy:
 * ACADEMY_OWNER, MANAGER and SUPERVISOR (PermissionCatalog carries it for fresh installs).
 *
 * An academy's custom roles get it where they already run the academy's settings
 * (settings.manage) — the people trusted with the academy's own switches are the ones who would
 * report that one of them is broken.
 *
 * The catalog tables are Super-Admin-write under RLS, so the writes run inside a Super-Admin
 * context — the same discipline as PermissionSeeder.
 */
return new class extends Migration
{
    private const CODE = 'support.manage';

    private const ROLES = ['ACADEMY_OWNER', 'MANAGER', 'SUPERVISOR'];

    public function up(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            DB::table('permissions')->updateOrInsert(['code' => self::CODE], ['description' => self::CODE]);
            $permissionId = DB::table('permissions')->where('code', self::CODE)->value('id');

            foreach (self::ROLES as $role) {
                DB::table('role_permissions')->updateOrInsert(
                    ['role' => $role, 'permission_id' => $permissionId],
                    [],
                );
            }

            $sourceId = DB::table('permissions')->where('code', 'settings.manage')->value('id');
            if ($sourceId !== null) {
                foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
                    DB::statement("select set_config('app.current_academy_id', ?, false)", [(string) $academyId]);
                    $roleIds = DB::table('academy_role_permissions')->where('permission_id', $sourceId)->distinct()->pluck('role_id');
                    foreach ($roleIds as $roleId) {
                        DB::table('academy_role_permissions')->updateOrInsert(
                            ['role_id' => $roleId, 'permission_id' => $permissionId],
                            ['academy_id' => $academyId],
                        );
                    }
                }
                DB::statement("select set_config('app.current_academy_id', '', false)");
            }
        } finally {
            TenantContext::clear();
        }
    }

    public function down(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            $permissionId = DB::table('permissions')->where('code', self::CODE)->value('id');
            if ($permissionId !== null) {
                // academy_role_permissions rows go with the permission (on delete cascade).
                DB::table('role_permissions')->where('permission_id', $permissionId)->delete();
                DB::table('permissions')->where('id', $permissionId)->delete();
            }
        } finally {
            TenantContext::clear();
        }
    }
};
