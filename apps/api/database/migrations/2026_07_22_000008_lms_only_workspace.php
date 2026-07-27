<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Grant the LMS_BASIC plan the `lms.only` workspace marker (docs/lms) — the LMS twin of the Meet
 * Plan's `video.only`. A client who bought ONLY the course platform has no school to manage, so the
 * web panel collapses its nav to the LMS surfaces (dashboard / courses / learners / access codes)
 * and sends `/dashboard` to the LMS home instead of the management dashboard.
 *
 * Safe for multi-module clients two ways over: `FeatureCatalog::bundledCapabilities()` excludes it
 * (so FREE/PRO never bundle it), and `Entitlement::resolveFromModules` strips it whenever LMS is not
 * the client's only granting module — so a school that ALSO buys LMS keeps its full panel.
 *
 * Idempotent + additive, under the transaction-local SUPER_ADMIN context (plans are super-admin-write
 * under RLS). Plans are DATA: this only backfills the seeded tier, and a Super Admin can add or drop
 * the capability on any plan in /admin/plans.
 */
return new class extends Migration
{
    private const CODE = 'LMS_BASIC';

    private const MARKER = 'lms.only';

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        $this->mapCapabilities(static function (array $caps): array {
            return in_array(self::MARKER, $caps, true) ? $caps : [...$caps, self::MARKER];
        });
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        $this->mapCapabilities(static function (array $caps): array {
            return array_values(array_filter($caps, static fn (string $c): bool => $c !== self::MARKER));
        });
    }

    /** Rewrite the LMS_BASIC plan's features.capabilities through $fn, leaving limits untouched. */
    private function mapCapabilities(callable $fn): void
    {
        $plan = DB::table('plans')->where('code', self::CODE)->first(['id', 'features']);
        if ($plan === null) {
            return;
        }

        $features = json_decode((string) $plan->features, true);
        if (! is_array($features)) {
            $features = [];
        }

        $caps = array_values(array_filter(
            is_array($features['capabilities'] ?? null) ? $features['capabilities'] : [],
            'is_string',
        ));
        $features['capabilities'] = $fn($caps);
        // Preserve an empty limits map as an object, matching how the plan was seeded.
        if (($features['limits'] ?? []) === []) {
            $features['limits'] = (object) [];
        }

        DB::table('plans')->where('id', $plan->id)->update(['features' => json_encode($features)]);
    }
};
