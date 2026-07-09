<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register the free-lesson approval capabilities and grant them to the SYSTEM roles so already-seeded
 * databases pick them up without a full reseed (PermissionCatalog carries them for fresh installs).
 *
 *  - ACADEMY_OWNER: `session.free` (mark free directly, via the billing popup) + `session.free_approve`
 *    (approve a teacher's free request).
 *  - TEACHER: `session.free_request` (raise a request; the owner decides the billing).
 *
 * Mirrors the cancellation-approval split. The catalog tables are Super-Admin-write under RLS
 * (`catalog_mutate using app.is_super_admin()`), so the writes run inside a Super-Admin context —
 * the same discipline as PermissionSeeder.
 */
return new class extends Migration
{
    /** permission code => roles that receive it. */
    private const GRANTS = [
        'session.free' => ['ACADEMY_OWNER'],
        'session.free_approve' => ['ACADEMY_OWNER'],
        'session.free_request' => ['TEACHER'],
    ];

    public function up(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            foreach (array_keys(self::GRANTS) as $code) {
                DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
            }

            $permIds = DB::table('permissions')->whereIn('code', array_keys(self::GRANTS))->pluck('id', 'code');
            foreach (self::GRANTS as $code => $roles) {
                foreach ($roles as $role) {
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

    public function down(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            $permIds = DB::table('permissions')->whereIn('code', array_keys(self::GRANTS))->pluck('id');
            DB::table('role_permissions')->whereIn('permission_id', $permIds)->delete();
            DB::table('permissions')->whereIn('code', array_keys(self::GRANTS))->delete();
        } finally {
            TenantContext::clear();
        }
    }
};
