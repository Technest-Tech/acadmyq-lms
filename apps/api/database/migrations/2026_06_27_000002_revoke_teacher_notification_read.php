<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The Notifications page is OWNER-only. A TEACHER was originally granted `notification.read`
 * (to see their own cancellation-request decisions and report reminders), but that surfaced
 * the whole Notifications page on the teacher dashboard, which is wrong — a teacher raises a
 * cancellation REQUEST and the owner decides it; teachers have no notification feed.
 *
 * PermissionCatalog no longer lists `notification.read` under TEACHER, but PermissionSeeder is
 * additive (it never deletes), so already-seeded databases keep the stale grant until it is
 * removed explicitly. This migration deletes that single role_permissions row. The catalog
 * tables are platform-global (RLS `catalog_select using (true)`), so no tenant context is
 * needed — mirrors PermissionSeeder's discipline.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('role_permissions')
            ->where('role', 'TEACHER')
            ->whereIn('permission_id', function ($q) {
                $q->select('id')->from('permissions')->where('code', 'notification.read');
            })
            ->delete();
    }

    public function down(): void
    {
        $permId = DB::table('permissions')->where('code', 'notification.read')->value('id');
        if ($permId !== null) {
            DB::table('role_permissions')->updateOrInsert(
                ['role' => 'TEACHER', 'permission_id' => $permId],
                [],
            );
        }
    }
};
