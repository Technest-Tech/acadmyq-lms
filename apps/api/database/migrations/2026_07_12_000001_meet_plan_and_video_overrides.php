<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * "Meet Plan" — a video-conferencing-ONLY plan — plus free-form PER-ACADEMY video options.
 *
 *  1. Seeds the `MEET` plan (idempotent; skipped if a super-admin already created/edited it via the
 *     admin UI). Capabilities = ['video.conferencing', 'video.only']: it grants the video classroom
 *     AND the `video.only` marker the web shell reads to collapse the nav to video-only. Its
 *     `features.limits` carry the default meet options (max rooms/participants, recording retention,
 *     recording + monitor flags). Plans are DATA — these are just sensible defaults the admin can edit.
 *
 *  2. Adds `academies.video_overrides` (jsonb, nullable) — the per-academy meet-option override the
 *     Super Admin sets from the video oversight panel. Shape: { "limits": { maxRooms?, … } }. It wins
 *     over the academy's plan AND its video tier for the FeatureCatalog::VIDEO_LIMIT_KEYS only
 *     (App\Support\Entitlement applies it). NULL ⇒ inherit (no override). Nullable + no backfill, so
 *     no FORCE-RLS dance is needed on the tenant `academies` table.
 *
 * The `plans` catalog is super-admin-write under RLS, so the seed runs inside a SUPER_ADMIN context
 * (set_config local=true → scoped to this migration's transaction).
 */
return new class extends Migration
{
    public function up(): void
    {
        // --- per-academy video override column (nullable; no backfill) ---
        DB::unprepared('alter table academies add column video_overrides jsonb;');

        // --- seed the Meet Plan under a SUPER_ADMIN context (plans is super-admin-write) ---
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        if (! DB::table('plans')->where('code', 'MEET')->exists()) {
            DB::table('plans')->insert([
                'code' => 'MEET',
                'name' => 'Meet Plan',
                'price_minor' => 49900, // 499.00 — a placeholder the admin can edit
                'currency' => 'EGP',
                'features' => json_encode([
                    // video-only: the classroom + the marker the web shell uses to hide everything else
                    'capabilities' => ['video.conferencing', 'video.only'],
                    'limits' => [
                        'maxStudents' => null,
                        'maxTeachers' => null,
                        'maxRooms' => 25,
                        'maxRoomParticipants' => 50,
                        'recordingRetentionDays' => 90,
                        'recordingAllowed' => 1,
                        'monitorAllowed' => 1,
                    ],
                ]),
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        DB::table('plans')->where('code', 'MEET')->delete();
        DB::unprepared('alter table academies drop column if exists video_overrides;');
    }
};
