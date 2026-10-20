<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Receipts (docs/groups/01-ACCOUNTING.md): `receipt.void` — void a receipt, taking its money back
 * off the books. Recording a receipt rides the existing `invoice.mark_paid`. Money, so it is listed
 * in PermissionCatalog::FINANCIAL and the SUPERVISOR never gets it.
 *
 * Every custom role that may already mark invoices paid inherits it: until today undoing a payment
 * was simply re-marking the invoice, which those roles could do.
 *
 * Idempotent and ADDITIVE, under a transaction-local SUPER_ADMIN context (catalog tables are
 * super-admin-write under RLS).
 */
return new class extends Migration
{
    private const CODE = 'receipt.void';

    private const ROLES = ['ACADEMY_OWNER', 'MANAGER', 'ACCOUNTANT'];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        DB::table('permissions')->updateOrInsert(['code' => self::CODE], ['description' => self::CODE]);
        $permId = DB::table('permissions')->where('code', self::CODE)->value('id');
        if ($permId === null) {
            return;
        }

        $knownRoles = DB::table('pg_enum as e')
            ->join('pg_type as t', 't.oid', '=', 'e.enumtypid')
            ->where('t.typname', 'app_role')
            ->pluck('e.enumlabel')
            ->all();
        foreach (self::ROLES as $role) {
            if (in_array($role, $knownRoles, true)) {
                DB::table('role_permissions')->updateOrInsert(['role' => $role, 'permission_id' => $permId], []);
            }
        }

        $markPaid = DB::table('permissions')->where('code', 'invoice.mark_paid')->value('id');
        if ($markPaid === null) {
            return;
        }
        foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);
            foreach (DB::table('academy_role_permissions')->where('permission_id', $markPaid)->distinct()->pluck('role_id') as $roleId) {
                DB::table('academy_role_permissions')->updateOrInsert(
                    ['role_id' => $roleId, 'permission_id' => $permId],
                    ['academy_id' => $academyId],
                );
            }
        }
        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        $permId = DB::table('permissions')->where('code', self::CODE)->value('id');
        if ($permId === null) {
            return;
        }
        foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);
            DB::table('academy_role_permissions')->where('permission_id', $permId)->delete();
        }
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::table('role_permissions')->where('permission_id', $permId)->delete();
        DB::table('permissions')->where('id', $permId)->delete();
    }
};
