<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register `session.revert_attendance` and grant it to the SYSTEM roles that should hold it, so
 * already-seeded databases pick it up without a full reseed (PermissionCatalog carries it for
 * fresh installs).
 *
 *  - ACADEMY_OWNER and SUPERVISOR: undo a recorded outcome, putting the lesson back to SCHEDULED.
 *    Supervisors already mark attendance — which is the action that MOVES the money — so taking a
 *    mis-marked lesson back stays with the same people rather than escalating to the owner.
 *  - NOT the TEACHER: reverting reverses the invoice line and the payout accrual, and would be a
 *    back door around the cancellation approval the owner had just granted.
 *
 * The catalog tables are Super-Admin-write under RLS (`catalog_mutate using app.is_super_admin()`),
 * so the writes run inside a Super-Admin context — the same discipline as PermissionSeeder.
 */
return new class extends Migration
{
    private const CODE = 'session.revert_attendance';

    private const ROLES = ['ACADEMY_OWNER', 'SUPERVISOR'];

    public function up(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            DB::table('permissions')->updateOrInsert(['code' => self::CODE], ['description' => self::CODE]);
            $permissionId = DB::table('permissions')->where('code', self::CODE)->value('id');

            foreach (self::ROLES as $role) {
                DB::table('role_permissions')->updateOrInsert(
                    ['role' => $role, 'permission_id' => $permissionId],
                    [],
                );
            }
        } finally {
            TenantContext::clear();
        }
    }

    public function down(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            $permissionId = DB::table('permissions')->where('code', self::CODE)->value('id');
            if ($permissionId !== null) {
                DB::table('role_permissions')->where('permission_id', $permissionId)->delete();
                DB::table('permissions')->where('id', $permissionId)->delete();
            }
        } finally {
            TenantContext::clear();
        }
    }
};
