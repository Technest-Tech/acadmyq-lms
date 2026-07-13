<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Grant the new `session.create` capability, which backs the Attendance page's "add a class"
 * action — a one-off lesson the weekly timetable never produced (a make-up class, or one that
 * happened before the timetable existed and so was never generated).
 *
 * It exists as its own capability rather than reusing `schedule.manage` because a TEACHER needs
 * it: `schedule.manage` would also hand them the power to rewrite a student's weekly timetable,
 * which they must not have. `session.create` mints exactly one ad-hoc occurrence, and
 * SessionController confines a TEACHER to their own roster with themselves as the teacher.
 *
 * Same shape as the RBAC catalog sync that precedes it: idempotent + ADDITIVE (updateOrInsert,
 * never deletes), so custom grants made through the role editor survive. The catalog tables are
 * super-admin-write under RLS, hence the SUPER_ADMIN context (transaction-local).
 */
return new class extends Migration
{
    private const ROLES = ['SUPER_ADMIN', 'ACADEMY_OWNER', 'TEACHER'];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        DB::table('permissions')->updateOrInsert(
            ['code' => 'session.create'],
            ['description' => 'session.create'],
        );

        $permId = DB::table('permissions')->where('code', 'session.create')->value('id');
        if ($permId === null) {
            return;
        }

        foreach (self::ROLES as $role) {
            DB::table('role_permissions')->updateOrInsert(
                ['role' => $role, 'permission_id' => $permId],
                [],
            );
        }
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        $permId = DB::table('permissions')->where('code', 'session.create')->value('id');
        if ($permId === null) {
            return;
        }

        DB::table('role_permissions')
            ->where('permission_id', $permId)
            ->whereIn('role', self::ROLES)
            ->delete();
        DB::table('permissions')->where('id', $permId)->delete();
    }
};
