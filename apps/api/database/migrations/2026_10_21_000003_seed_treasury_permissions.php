<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The treasury (docs/groups/01-ACCOUNTING.md):
 *   - `expense.manage`  record money OUT (an expense, a salary paid), set up the accounts and the
 *                       method → account mapping, and move money between accounts
 *   - `cashbox.close`   count and close a day's cash
 *
 * Money, so both are in PermissionCatalog::FINANCIAL and the SUPERVISOR never gets them. Granted to
 * the system roles that run money (owner, manager, accountant); a custom role gets them from the
 * role builder — paying money out is not inherited from anything a role held before.
 *
 * Idempotent and ADDITIVE, under a transaction-local SUPER_ADMIN context.
 */
return new class extends Migration
{
    private const CODES = ['expense.manage', 'cashbox.close'];

    private const ROLES = ['ACADEMY_OWNER', 'MANAGER', 'ACCOUNTANT'];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        $knownRoles = DB::table('pg_enum as e')->join('pg_type as t', 't.oid', '=', 'e.enumtypid')
            ->where('t.typname', 'app_role')->pluck('e.enumlabel')->all();

        foreach (self::CODES as $code) {
            DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
            $permId = DB::table('permissions')->where('code', $code)->value('id');
            foreach (self::ROLES as $role) {
                if ($permId !== null && in_array($role, $knownRoles, true)) {
                    DB::table('role_permissions')->updateOrInsert(['role' => $role, 'permission_id' => $permId], []);
                }
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
            foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);
                DB::table('academy_role_permissions')->where('permission_id', $permId)->delete();
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");
            DB::table('role_permissions')->where('permission_id', $permId)->delete();
            DB::table('permissions')->where('id', $permId)->delete();
        }
    }
};
