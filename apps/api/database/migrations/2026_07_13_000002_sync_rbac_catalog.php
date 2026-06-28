<?php

declare(strict_types=1);

use App\Support\PermissionCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sync the RBAC catalog (PermissionCatalog → `permissions` + `role_permissions`) into the database.
 *
 * Capabilities are added to PermissionCatalog in code, but the `role_permissions` rows that grant
 * them to a role only land via PermissionSeeder — which the deploy pipeline did NOT run, so the
 * video capabilities (room.read/create/join/manage, recording.view, room.monitor) never reached
 * production. Result: an ACADEMY_OWNER on a Meet academy had no room.read, so the Video Classroom
 * (its only surface) was filtered out → empty sidebar + "no access to the video classroom".
 *
 * This migration performs the same sync as PermissionSeeder, so it runs automatically via
 * `migrate --force` on deploy. Idempotent + ADDITIVE (updateOrInsert, never deletes) — custom
 * grants made through the role editor survive. The catalog tables are super-admin-write under RLS,
 * so the writes run inside a SUPER_ADMIN context (set_config local=true → this transaction only).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (PermissionCatalog::PERMISSIONS as $code) {
            DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
        }

        $permIds = DB::table('permissions')->pluck('id', 'code');
        foreach (PermissionCatalog::roleMap() as $role => $codes) {
            foreach ($codes as $code) {
                if (! isset($permIds[$code])) {
                    continue;
                }
                DB::table('role_permissions')->updateOrInsert(
                    ['role' => $role, 'permission_id' => $permIds[$code]],
                    [],
                );
            }
        }
    }

    public function down(): void
    {
        // Irreversible by design: removing granted capabilities would break live sessions.
    }
};
