<?php

declare(strict_types=1);

use App\Support\PermissionCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The team & permissions rework (docs in PermissionCatalog):
 *
 * 1. Five capabilities split off broader ones so money and statistics can be withheld:
 *      teacher.set_pay           ← teacher.read / teacher.update showed and edited every rate
 *      staff.set_salary          ← staff.read / staff.update showed and edited every salary
 *      session.bill_override     ← cancelling / freeing a lesson carried "charge? pay?" with it
 *      teacher_quality.insights  ← teacher_quality.read opened the performance dashboard
 *      settings.manage           ← specialization.manage opened all of Settings
 *
 * 2. Three new shared roles get their grants: MANAGER, ACCOUNTANT, CUSTOMER_SERVICE.
 *
 * 3. SUPERVISOR loses the statistics page (supervision.stats). It never receives any of the five
 *    new capabilities — that is the fix: a supervisor stops seeing teacher rates and staff
 *    salaries, stops deciding whether a cancelled lesson is charged, and stops opening the
 *    performance dashboards and the academy's switches.
 *
 * Grandfathering — custom roles only, each by the rule that keeps what its owner meant:
 *   - teacher.set_pay, staff.set_salary → roles already holding payout.read. A role with no money
 *     capability at all was never MEANT to see a rate; it saw one through a leak, and the leak is
 *     what this closes. A role that reads the payroll already sees what teachers earn.
 *   - session.bill_override → roles holding session.cancel / free / cancel_approve / free_approve.
 *     Whoever chooses to charge late cancellations today keeps doing it; silently flipping those
 *     to "not charged" would cost the academy money nobody decided to give up.
 *   - teacher_quality.insights → roles holding teacher_quality.read (same page they open today).
 *   - settings.manage → roles holding specialization.manage (same Settings they open today).
 * The owner sees all of it in the new role builder and can untick any of it.
 *
 * Idempotent. Additive except for the one deliberate revoke in step 3.
 */
return new class extends Migration
{
    /** New capability => the capabilities whose custom-role holders inherit it. */
    private const GRANDFATHER = [
        'teacher.set_pay' => ['payout.read'],
        'staff.set_salary' => ['payout.read'],
        'session.bill_override' => ['session.cancel', 'session.free', 'session.cancel_approve', 'session.free_approve'],
        'teacher_quality.insights' => ['teacher_quality.read'],
        'settings.manage' => ['specialization.manage'],
    ];

    private const NEW_ROLES = ['MANAGER', 'ACCOUNTANT', 'CUSTOMER_SERVICE'];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        // --- 1. catalog rows ---------------------------------------------------
        foreach (PermissionCatalog::PERMISSIONS as $code) {
            DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
        }
        $permIds = DB::table('permissions')->pluck('id', 'code');

        // --- 2. system-role grants straight from the catalog (new roles + new codes) ---
        $knownRoles = DB::table('pg_enum as e')
            ->join('pg_type as t', 't.oid', '=', 'e.enumtypid')
            ->where('t.typname', 'app_role')
            ->pluck('e.enumlabel')
            ->all();

        foreach (PermissionCatalog::roleMap() as $role => $codes) {
            if (! in_array($role, $knownRoles, true)) {
                continue;
            }
            foreach ($codes as $code) {
                if (! isset($permIds[$code])) {
                    continue;
                }
                DB::table('role_permissions')->updateOrInsert(
                    ['role' => $role, 'permission_id' => $permIds[$code]],
                    [],
                );
            }
        }

        // --- 3. the supervisor stops reading the statistics -------------------
        $statIds = collect(PermissionCatalog::STATISTICS)->map(fn ($c) => $permIds[$c] ?? null)->filter()->values()->all();
        if ($statIds !== []) {
            DB::table('role_permissions')->where('role', 'SUPERVISOR')->whereIn('permission_id', $statIds)->delete();
        }

        // --- 4. grandfather each academy's own custom roles --------------------
        foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);

            foreach (self::GRANDFATHER as $newCode => $sources) {
                $newId = $permIds[$newCode] ?? null;
                $sourceIds = collect($sources)->map(fn ($c) => $permIds[$c] ?? null)->filter()->values()->all();
                if ($newId === null || $sourceIds === []) {
                    continue;
                }

                $roleIds = DB::table('academy_role_permissions')
                    ->whereIn('permission_id', $sourceIds)
                    ->distinct()
                    ->pluck('role_id');

                foreach ($roleIds as $roleId) {
                    DB::table('academy_role_permissions')->updateOrInsert(
                        ['role_id' => $roleId, 'permission_id' => $newId],
                        ['academy_id' => $academyId],
                    );
                }
            }
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        DB::table('role_permissions')->whereIn('role', self::NEW_ROLES)->delete();

        // Give the supervisor its statistics page back (teacher_quality.insights is dropped below).
        $statsId = DB::table('permissions')->where('code', 'supervision.stats')->value('id');
        if ($statsId !== null) {
            DB::table('role_permissions')->updateOrInsert(['role' => 'SUPERVISOR', 'permission_id' => $statsId], []);
        }

        $newIds = DB::table('permissions')->whereIn('code', array_keys(self::GRANDFATHER))->pluck('id')->all();
        if ($newIds === []) {
            return;
        }

        DB::table('role_permissions')->whereIn('permission_id', $newIds)->delete();
        foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);
            DB::table('academy_role_permissions')->whereIn('permission_id', $newIds)->delete();
        }
        DB::statement("select set_config('app.current_academy_id', '', true)");

        DB::table('permissions')->whereIn('id', $newIds)->delete();
    }
};
