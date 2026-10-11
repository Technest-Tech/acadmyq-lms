<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Booking requests (docs/lms/13):
 *   - `booking.read`    open the requests inbox
 *   - `booking.manage`  move a request along (contacted / confirmed / …), note it, delete spam, and
 *                       configure the forms themselves
 *
 * A pair of its own rather than riding `course.*`: the person who answers "call me back" requests
 * is a receptionist or a salesperson, and handing them the course builder to do it would be the
 * wrong delegation. Not money, so the SUPERVISOR gets it with the rest of the academy.
 *
 * Idempotent and ADDITIVE (updateOrInsert, never deletes), run under a transaction-local
 * SUPER_ADMIN context because the catalog tables are super-admin-write under RLS.
 */
return new class extends Migration
{
    private const CODES = ['booking.read', 'booking.manage'];

    private const ROLES = ['ACADEMY_OWNER', 'SUPERVISOR'];

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
