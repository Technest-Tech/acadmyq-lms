<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Data fix: remove the MEET-exclusive `video.only` capability from full-feature plans.
 *
 * When the Meet Plan shipped it added `video.only` to FeatureCatalog::CAPABILITIES. The FREE/PRO
 * plans were seeded with "all capabilities" (array_keys(CAPABILITIES)), which then silently swept
 * in `video.only` — and that capability flips an academy into the video-only workspace (the web
 * shell collapses the nav to just the Video Classroom). So every FREE/PRO academy wrongly became
 * video-only. The seeders now use FeatureCatalog::bundledCapabilities() (catalog minus the
 * Meet-exclusive keys); this migration repairs ALREADY-SEEDED databases (incl. production).
 *
 * Targets only CONTAMINATED plans: a plan that carries `video.only` AND at least one non-video
 * capability is a full plan that should never have been video-only. A genuine video-only plan
 * (MEET, or any custom plan whose capabilities are video.* only) is left untouched.
 *
 * The `plans` catalog is super-admin-write under RLS, so the update runs inside a SUPER_ADMIN
 * context (set_config local=true → scoped to this migration's transaction). Idempotent: re-running
 * is a no-op once clean.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (DB::table('plans')->get(['id', 'features']) as $plan) {
            $features = json_decode($plan->features ?? '{}', true) ?: [];
            $caps = $features['capabilities'] ?? [];

            $hasVideoOnly = in_array('video.only', $caps, true);
            $hasNonVideoCap = count(array_filter(
                $caps,
                static fn (string $c): bool => ! str_starts_with($c, 'video.'),
            )) > 0;

            // Only repair a FULL plan that was contaminated — never a real video-only plan.
            if ($hasVideoOnly && $hasNonVideoCap) {
                $features['capabilities'] = array_values(array_filter(
                    $caps,
                    static fn (string $c): bool => $c !== 'video.only',
                ));

                DB::table('plans')->where('id', $plan->id)->update([
                    'features' => json_encode($features),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        // Irreversible by design: re-adding `video.only` to full plans would re-introduce the bug.
    }
};
