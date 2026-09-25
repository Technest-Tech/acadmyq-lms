<?php

declare(strict_types=1);

use App\Support\FeatureCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Five more per-client switches (supervision, packages, teacher_quality, financial_statistics,
 * report_card — FeatureCatalog::MODULE_CAPABILITIES['MANAGEMENT']). Every MANAGEMENT client gets
 * them on deploy, because a module grants everything it owns (05-MODULES-NOT-PACKAGES §3); this
 * migration only gives each one its platform kill-switch row, the way the original flags
 * migration did for the keys that existed then. Idempotent: a key that already has a row is
 * left alone, so the loop can cover the whole catalog.
 */
return new class extends Migration
{
    public function up(): void
    {
        // feature_flags is Super-Admin-write under RLS; local=true scopes this to the migration's
        // transaction, like every other catalog-seeding migration here.
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        $existing = DB::table('feature_flags')->pluck('key')->all();

        foreach (FeatureCatalog::CAPABILITIES as $key => $label) {
            if (in_array($key, $existing, true)) {
                continue;
            }

            DB::table('feature_flags')->insert([
                'id' => (string) Str::uuid(),
                'key' => $key,
                'description' => $label,
                'enabled' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        DB::table('feature_flags')->whereIn('key', [
            'supervision', 'packages', 'teacher_quality', 'financial_statistics', 'report_card',
        ])->delete();
    }
};
