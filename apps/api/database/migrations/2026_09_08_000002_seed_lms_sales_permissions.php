<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The sales half of the LMS module (docs/lms/10):
 *   - `course_order.read`      see the sales dashboard, the order queue and the buyers
 *   - `course_order.manage`    approve / reject / refund / cancel an order, grant or pull access
 *   - `payment_method.manage`  edit the client's receiving accounts (InstaPay handle, IBAN, …)
 *
 * Split read from manage for the same reason invoices are: an academy hires someone to *watch* the
 * queue long before it trusts them to decide money. `payment_method.manage` is separate again — the
 * account numbers are where the money physically lands, so changing them is an owner-grade act even
 * where reviewing receipts is not.
 *
 * OWNER-only by default; delegated through a custom role, exactly like `course.*`. Idempotent and
 * ADDITIVE (updateOrInsert, never deletes), run under a transaction-local SUPER_ADMIN context
 * because the catalog tables are super-admin-write under RLS.
 */
return new class extends Migration
{
    private const CODES = ['course_order.read', 'course_order.manage', 'payment_method.manage'];

    private const ROLES = ['ACADEMY_OWNER'];

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (self::CODES as $code) {
            DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);

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
