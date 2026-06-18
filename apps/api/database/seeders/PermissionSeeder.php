<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Support\PermissionCatalog;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Syncs the RBAC catalog (PermissionCatalog → `permissions` + `role_permissions`) into the
 * database. Idempotent and ADDITIVE: it upserts every catalog permission and every default
 * role→capability grant, but never deletes — so custom grants made via the role editor
 * (Phase 7) survive a re-run.
 *
 * Run this after adding a permission to PermissionCatalog so live sessions pick it up:
 *   php artisan db:seed --class=Database\\Seeders\\PermissionSeeder
 *
 * The `permissions`/`role_permissions` catalog tables are Super-Admin-write under RLS, so the
 * writes run inside a Super-Admin context (same discipline as DemoAcademySeeder).
 */
class PermissionSeeder extends Seeder
{
    public function run(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            foreach (PermissionCatalog::PERMISSIONS as $code) {
                DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
            }

            $permIds = DB::table('permissions')->pluck('id', 'code');
            foreach (PermissionCatalog::roleMap() as $role => $codes) {
                foreach ($codes as $code) {
                    DB::table('role_permissions')->updateOrInsert(
                        ['role' => $role, 'permission_id' => $permIds[$code]],
                        [],
                    );
                }
            }
        } finally {
            TenantContext::clear();
        }
    }
}
