<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register `session.delete` and grant it to the SYSTEM roles that can already undo attendance, so
 * already-seeded databases pick it up without a full reseed (PermissionCatalog carries it for
 * fresh installs).
 *
 * Deleting a lesson reverses its money through the same path an undo does, so it goes to the same
 * people: ACADEMY_OWNER, SUPERVISOR and MANAGER. Never the TEACHER.
 *
 * The catalog tables are Super-Admin-write under RLS, so the writes run inside a Super-Admin
 * context — the same discipline as PermissionSeeder.
 */
return new class extends Migration
{
    private const CODE = 'session.delete';

    private const ROLES = ['ACADEMY_OWNER', 'SUPERVISOR', 'MANAGER'];

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

            // An academy's own custom roles: whoever was trusted to undo attendance may delete.
            $sourceId = DB::table('permissions')->where('code', 'session.revert_attendance')->value('id');
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
                DB::table('role_permissions')->where('permission_id', $permissionId)->delete();
                DB::table('permissions')->where('id', $permissionId)->delete();
            }
        } finally {
            TenantContext::clear();
        }
    }
};
