<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 1 (docs/superadmin-modules) — seed the WHATSAPP-module plans so WhatsApp can be a
 * first-class, independently-subscribed module.
 *
 *   - WA_BUNDLED (price 0): the internal plan the parity backfill attaches to every academy that
 *     bundles `whatsapp.automation` today (D6), so WhatsApp keeps working once it leaves the
 *     management plans. Not a sold tier.
 *   - WA_STANDARD (placeholder price): a sellable standalone WhatsApp plan the Super Admin edits.
 *
 * Plans are DATA — these are sensible defaults, idempotent (skipped if a super-admin already
 * created them). `plans` is super-admin-write under RLS → seed in a SUPER_ADMIN context.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        $now = now();
        $features = json_encode(['capabilities' => ['whatsapp.automation'], 'limits' => []]);

        if (! DB::table('plans')->where('code', 'WA_BUNDLED')->exists()) {
            DB::table('plans')->insert([
                'code' => 'WA_BUNDLED', 'name' => 'WhatsApp (Bundled)', 'module' => 'WHATSAPP',
                'price_minor' => 0, 'currency' => 'EGP', 'features' => $features,
                'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        if (! DB::table('plans')->where('code', 'WA_STANDARD')->exists()) {
            DB::table('plans')->insert([
                'code' => 'WA_STANDARD', 'name' => 'WhatsApp Automation', 'module' => 'WHATSAPP',
                'price_minor' => 29900, 'currency' => 'EGP', 'features' => $features,
                'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        DB::table('plans')->whereIn('code', ['WA_BUNDLED', 'WA_STANDARD'])->delete();
    }
};
