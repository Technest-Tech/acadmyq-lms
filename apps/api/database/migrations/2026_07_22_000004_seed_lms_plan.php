<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Seed the LMS module's first sellable plan so the Super-Admin clients hub can enable the module per
 * academy the moment this deploys (the subscriptions card offers the plans of each module). One tier
 * to start — `features.capabilities: ["lms"]` is what the entitlement union grants; limits are left
 * empty (uncapped) and the price is a placeholder the Super Admin edits in /admin/plans (plans are
 * DATA: repricing, capping storage, or adding LMS tiers is a catalog edit, never a deploy).
 *
 * Idempotent on `code` and ADDITIVE, under the transaction-local SUPER_ADMIN context (the plans
 * catalog is super-admin-write under RLS). Mirrors seed_crm_plan.
 */
return new class extends Migration
{
    private const CODE = 'LMS_BASIC';

    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        if (DB::table('plans')->where('code', self::CODE)->exists()) {
            return;
        }

        DB::table('plans')->insert([
            'id' => (string) Str::uuid(),
            'code' => self::CODE,
            'name' => 'LMS',
            'module' => 'LMS',
            'price_minor' => 49900, // 499 EGP/month placeholder — edit in /admin/plans
            'currency' => 'EGP',
            'features' => json_encode(['capabilities' => ['lms'], 'limits' => (object) []]),
            'is_active' => true,
        ]);
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        // Only remove the seed if nothing ever subscribed to it.
        $planId = DB::table('plans')->where('code', self::CODE)->value('id');
        if ($planId === null) {
            return;
        }
        if (DB::table('module_subscriptions')->where('plan_id', $planId)->exists()) {
            return;
        }

        DB::table('plans')->where('id', $planId)->delete();
    }
};
