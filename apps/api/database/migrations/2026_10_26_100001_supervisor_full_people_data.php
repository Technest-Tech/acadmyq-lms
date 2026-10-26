<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The built-in SUPERVISOR enrols people end to end: a student with their price and package, a
 * family, a teacher with their pay and their first sign-in (PermissionCatalog::roleMap()).
 *
 *  1. Register `teacher.create_login` — a teacher's FIRST login, split off user.invite +
 *     role.assign — and grant it to ACADEMY_OWNER, MANAGER and SUPERVISOR. Custom roles that
 *     could already mint a teacher login (they hold both of those) keep that power through it.
 *  2. Grant SUPERVISOR the money fields of the people it enrols: student.set_price,
 *     package.read, package.manage, teacher.set_pay.
 *
 * Custom roles started from the supervisor preset are snapshots the owner chose, so they are left
 * as they are (the Lingo role already carries the student half).
 *
 * The catalog tables are Super-Admin-write under RLS, so the writes run inside a Super-Admin
 * context — the same discipline as PermissionSeeder.
 */
return new class extends Migration
{
    private const LOGIN = 'teacher.create_login';

    private const LOGIN_ROLES = ['ACADEMY_OWNER', 'MANAGER', 'SUPERVISOR'];

    private const SUPERVISOR_MONEY = ['student.set_price', 'package.read', 'package.manage', 'teacher.set_pay'];

    public function up(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            DB::table('permissions')->updateOrInsert(['code' => self::LOGIN], ['description' => self::LOGIN]);
            $loginId = DB::table('permissions')->where('code', self::LOGIN)->value('id');

            foreach (self::LOGIN_ROLES as $role) {
                DB::table('role_permissions')->updateOrInsert(['role' => $role, 'permission_id' => $loginId], []);
            }

            foreach (self::SUPERVISOR_MONEY as $code) {
                $id = DB::table('permissions')->where('code', $code)->value('id');
                if ($id !== null) {
                    DB::table('role_permissions')->updateOrInsert(['role' => 'SUPERVISOR', 'permission_id' => $id], []);
                }
            }

            $inviteId = DB::table('permissions')->where('code', 'user.invite')->value('id');
            $assignId = DB::table('permissions')->where('code', 'role.assign')->value('id');
            if ($inviteId !== null && $assignId !== null) {
                foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
                    DB::statement("select set_config('app.current_academy_id', ?, false)", [(string) $academyId]);
                    $roleIds = DB::table('academy_role_permissions')
                        ->whereIn('permission_id', [$inviteId, $assignId])
                        ->groupBy('role_id')
                        ->havingRaw('count(distinct permission_id) = 2')
                        ->pluck('role_id');
                    foreach ($roleIds as $roleId) {
                        DB::table('academy_role_permissions')->updateOrInsert(
                            ['role_id' => $roleId, 'permission_id' => $loginId],
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
            $moneyIds = DB::table('permissions')->whereIn('code', self::SUPERVISOR_MONEY)->pluck('id');
            DB::table('role_permissions')->where('role', 'SUPERVISOR')->whereIn('permission_id', $moneyIds)->delete();

            $loginId = DB::table('permissions')->where('code', self::LOGIN)->value('id');
            if ($loginId !== null) {
                foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
                    DB::statement("select set_config('app.current_academy_id', ?, false)", [(string) $academyId]);
                    DB::table('academy_role_permissions')->where('permission_id', $loginId)->delete();
                }
                DB::statement("select set_config('app.current_academy_id', '', false)");
                DB::table('role_permissions')->where('permission_id', $loginId)->delete();
                DB::table('permissions')->where('id', $loginId)->delete();
            }
        } finally {
            TenantContext::clear();
        }
    }
};
