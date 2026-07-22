<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Grant the teacher-quality capabilities:
 *   • `teacher_quality.read`     — see the rubric and the reports written against it.
 *   • `teacher_quality.manage`   — edit the rubric, write/delete reports, set the auto-deduction
 *                                  policy.
 *   • `teacher_quality.read_own` — a TEACHER reads the reports written about THEMSELVES.
 *
 * The first two are OWNER-only by default (same shape as crm.read/crm.manage): the point is that
 * the owner delegates quality work to a support employee through a CUSTOM role, so the STAFF
 * baseline stays minimal.
 *
 * `teacher_quality.read_own` goes to TEACHER on purpose, and is the one non-obvious grant here. A
 * quality report DOCKS PAY, so the person being docked has to be able to read it — the same
 * reasoning that already gives a teacher `payout.read_own` over their own statement. It is
 * self-scoped in the controller, never a window onto a colleague. Note this deliberately does NOT
 * touch `teacher_reports` (the free-text NOTE/INCIDENT/PRAISE log), which stays owner-private:
 * those were written under an expectation of privacy and are not a payroll document.
 *
 * Same shape as the other permission seeds: idempotent + ADDITIVE (updateOrInsert, never deletes),
 * run under the transaction-local SUPER_ADMIN context because the catalog tables are
 * super-admin-write under RLS.
 */
return new class extends Migration
{
    /** code => the system roles that get it by default. */
    private const GRANTS = [
        'teacher_quality.read'     => ['ACADEMY_OWNER'],
        'teacher_quality.manage'   => ['ACADEMY_OWNER'],
        'teacher_quality.read_own' => ['TEACHER'],
    ];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (self::GRANTS as $code => $roles) {
            DB::table('permissions')->updateOrInsert(
                ['code' => $code],
                ['description' => $code],
            );

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
