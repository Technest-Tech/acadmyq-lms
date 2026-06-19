<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register the Free-Trials capabilities (`trial.read`, `trial.manage`) and grant both to
 * ACADEMY_OWNER. PermissionCatalog carries them for fresh installs (PermissionSeeder); this
 * migration syncs already-seeded databases so live owner sessions pick them up without a reseed.
 *
 * The Free-Trials page is OWNER-only (same discipline as the people pages): TEACHER and the
 * platform SUPER_ADMIN are deliberately not granted these. The catalog tables are Super-Admin-write
 * under RLS (`catalog_mutate using app.is_super_admin()`), so the writes run inside a Super-Admin
 * context — the same discipline as PermissionSeeder (required under the app role's FORCE RLS).
 */
return new class extends Migration
{
    private const CODES = ['trial.read', 'trial.manage'];

    public function up(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            foreach (self::CODES as $code) {
                DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
            }

            $permIds = DB::table('permissions')->whereIn('code', self::CODES)->pluck('id', 'code');
            foreach (self::CODES as $code) {
                DB::table('role_permissions')->updateOrInsert(
                    ['role' => 'ACADEMY_OWNER', 'permission_id' => $permIds[$code]],
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
            $permIds = DB::table('permissions')->whereIn('code', self::CODES)->pluck('id');
            DB::table('role_permissions')->whereIn('permission_id', $permIds)->delete();
            DB::table('permissions')->whereIn('code', self::CODES)->delete();
        } finally {
            TenantContext::clear();
        }
    }
};
