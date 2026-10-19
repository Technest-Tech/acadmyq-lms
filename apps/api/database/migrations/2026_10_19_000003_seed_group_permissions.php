<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Group classes (docs/groups):
 *   - `group.read`    see the groups, their members and their lessons. A TEACHER holds it too,
 *                     row-scoped in the controller to the groups they teach.
 *   - `group.manage`  create / edit / archive groups, add and remove members, change the weekly
 *                     times, cancel / move / add a lesson.
 *
 * Marking the sheet rides the existing `session.mark_attendance`, and un-marking it the existing
 * `session.revert_attendance` — the same people who mark a private lesson mark a group one. Not
 * money (a group's price will be gated by `student.set_price`), so the SUPERVISOR gets both.
 *
 * Idempotent and ADDITIVE (updateOrInsert, never deletes), run under a transaction-local
 * SUPER_ADMIN context because the catalog tables are super-admin-write under RLS.
 */
return new class extends Migration
{
    /** @var array<string, list<string>> */
    private const GRANTS = [
        'group.read' => ['ACADEMY_OWNER', 'SUPERVISOR', 'TEACHER'],
        'group.manage' => ['ACADEMY_OWNER', 'SUPERVISOR'],
    ];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (self::GRANTS as $code => $roles) {
            DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);

            $permId = DB::table('permissions')->where('code', $code)->value('id');
            if ($permId === null) {
                continue;
            }

            foreach ($roles as $role) {
                DB::table('role_permissions')->updateOrInsert(
                    ['role' => $role, 'permission_id' => $permId],
                    [],
                );
            }
        }
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (self::GRANTS as $code => $roles) {
            $permId = DB::table('permissions')->where('code', $code)->value('id');
            if ($permId === null) {
                continue;
            }

            DB::table('role_permissions')
                ->where('permission_id', $permId)
                ->whereIn('role', $roles)
                ->delete();
            DB::table('permissions')->where('id', $permId)->delete();
        }
    }
};
