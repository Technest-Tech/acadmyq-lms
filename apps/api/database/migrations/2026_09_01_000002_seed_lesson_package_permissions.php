<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Grant the lesson-package capabilities: `package.read` (see balances, history and the
 * attention queue) and `package.manage` (open, close, carry over, bill).
 *
 * OWNER-only by default, like every other money-adjacent capability — an owner delegates it to
 * a receptionist through a CUSTOM role built from their own capability set, so the STAFF
 * baseline stays minimal.
 *
 * Same shape as the other permission seeds: idempotent + ADDITIVE (updateOrInsert, never
 * deletes), run under the transaction-local SUPER_ADMIN context because the catalog tables are
 * super-admin-write under RLS.
 */
return new class extends Migration
{
    private const CODES = ['package.read', 'package.manage'];

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
