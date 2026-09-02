<?php

declare(strict_types=1);

use App\Support\PermissionCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two halves of one change: the SUPERVISOR role, and the capability that makes it expressible.
 *
 * 1. `student.set_price` splits repricing off `student.update`. Until now the capability that let
 *    you fix a typo in a student's name also let you change what they pay, so "manage students but
 *    not their rates" could not be said at all. Existing roles are GRANDFATHERED — every system
 *    and custom role that already holds `student.update` is granted the new capability too, so
 *    nobody who could reprice yesterday finds the button gone this morning. The split only
 *    constrains roles created FROM here on, SUPERVISOR being the first.
 *
 * 2. SUPERVISOR is granted its catalog set: the whole academy minus invoices, payouts, profit,
 *    package billing, payment settings, student pricing, the audit trail (which prints all of the
 *    above) and the power to hand out logins and roles.
 *
 * Idempotent and ADDITIVE, like every other permission seed — re-runs change nothing and no grant
 * is ever deleted. The catalog tables are super-admin-write under RLS, and academy_role_permissions
 * is tenant-scoped, so the writes run under a transaction-local SUPER_ADMIN context and the
 * per-academy backfill sets each academy's GUC in turn.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        // --- the catalog rows for anything new in PermissionCatalog ----------
        foreach (PermissionCatalog::PERMISSIONS as $code) {
            DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
        }

        $permIds = DB::table('permissions')->pluck('id', 'code');
        $updateId = $permIds['student.update'] ?? null;
        $priceId = $permIds['student.set_price'] ?? null;

        // Who could reprice BEFORE this migration ran. Captured first, because the grants written
        // below introduce a role (SUPERVISOR) that holds `student.update` and must NOT be
        // grandfathered — grandfathering exists so nobody LOSES a capability they had, and a role
        // born in this migration never had one.
        $priorSystemHolders = $updateId === null
            ? []
            : DB::table('role_permissions')->where('permission_id', $updateId)->pluck('role')->all();

        // --- system-role grants: SUPERVISOR in full, plus the catalog's own drift ---
        foreach (PermissionCatalog::roleMap() as $role => $codes) {
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

        // --- grandfather: whoever could edit a student could already reprice them ---
        if ($updateId === null || $priceId === null) {
            return;
        }

        foreach ($priorSystemHolders as $role) {
            DB::table('role_permissions')->updateOrInsert(
                ['role' => $role, 'permission_id' => $priceId],
                [],
            );
        }

        // Then every academy's own custom roles, each inside its own tenant context so RLS lets
        // the read and the write through.
        foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);

            $roleIds = DB::table('academy_role_permissions')
                ->where('permission_id', $updateId)
                ->pluck('role_id');

            foreach ($roleIds as $roleId) {
                DB::table('academy_role_permissions')->updateOrInsert(
                    ['role_id' => $roleId, 'permission_id' => $priceId],
                    ['academy_id' => $academyId],
                );
            }
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        // Drop SUPERVISOR's grants; the enum value itself stays (PostgreSQL cannot remove one).
        DB::table('role_permissions')->where('role', 'SUPERVISOR')->delete();

        // Fold `student.set_price` back into `student.update` by removing it everywhere — the
        // controllers on the old code path gate pricing on student.update, so nothing is lost.
        $priceId = DB::table('permissions')->where('code', 'student.set_price')->value('id');
        if ($priceId === null) {
            return;
        }

        DB::table('role_permissions')->where('permission_id', $priceId)->delete();

        foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);
            DB::table('academy_role_permissions')->where('permission_id', $priceId)->delete();
        }
        DB::statement("select set_config('app.current_academy_id', '', true)");

        DB::table('permissions')->where('id', $priceId)->delete();
    }
};
