<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Grant the LMS capabilities (docs/lms/05-BILLING-ENTITLEMENT-PERMISSIONS):
 *   - `course.read`        see courses, lessons, learners and reports
 *   - `course.manage`      create/edit/publish/archive courses, sections, lessons, upload media
 *   - `access_code.manage` generate/deactivate/export the access codes learners redeem
 *   - `learner.read`       see learners + enrollments; block/unblock, revoke access
 *
 * OWNER-only by default, exactly like crm.read/crm.manage — the point of the module is that an owner
 * delegates it to a course-team employee through a CUSTOM role composed from the owner's own
 * capability set (role editor), so the STAFF/TEACHER baselines stay untouched.
 *
 * Same shape as seed_crm_permissions: idempotent + ADDITIVE (updateOrInsert, never deletes), run
 * under the transaction-local SUPER_ADMIN context because the catalog tables are super-admin-write
 * under RLS.
 */
return new class extends Migration
{
    private const CODES = ['course.read', 'course.manage', 'access_code.manage', 'learner.read'];

    private const ROLES = ['ACADEMY_OWNER'];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (self::CODES as $code) {
            DB::table('permissions')->updateOrInsert(
                ['code' => $code],
                ['description' => $code],
            );

            $permId = DB::table('permissions')->where('code', $code)->value('id');
            if ($permId === null) {
                continue;
            }

            foreach (self::ROLES as $role) {
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

        foreach (self::CODES as $code) {
            $permId = DB::table('permissions')->where('code', $code)->value('id');
            if ($permId === null) {
                continue;
            }

            DB::table('role_permissions')
                ->where('permission_id', $permId)
                ->whereIn('role', self::ROLES)
                ->delete();
            DB::table('permissions')->where('id', $permId)->delete();
        }
    }
};
