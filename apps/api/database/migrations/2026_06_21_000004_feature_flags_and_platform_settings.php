<?php

declare(strict_types=1);

use App\Support\FeatureCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Admin panel — Phase 6 (feature flags + platform settings).
 *
 *  - `feature_flags` — a platform-wide kill-switch layer OVER plan gating. A flag keyed by a
 *    capability, when disabled, removes that capability from every academy's resolved
 *    entitlement even if their plan grants it (App\Support\Entitlement::resolve). Shared-read
 *    catalog (owners must read it during resolution), Super-Admin write — same RLS shape as
 *    `plans`/`add_ons`.
 *  - `platform_settings` — global key/value config (SMTP, etc.). Super-Admin read AND write
 *    (values may hold secrets), so its select policy is `is_super_admin()`, not `true`.
 *
 * Seeds one flag (enabled) per known gated capability so the kill-switch is immediately useful.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table feature_flags (
              id          uuid primary key default uuid_generate_v7(),
              key         text not null unique,
              description text,
              enabled     boolean not null default true,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );
        SQL);

        // Seed a flag per known gated capability BEFORE enabling RLS — an unrestricted insert
        // that needs no tenant context (and so never touches a session GUC, which must never
        // leak across this connection — every other write in this codebase is tx-local).
        foreach (FeatureCatalog::CAPABILITIES as $key => $label) {
            DB::table('feature_flags')->insert([
                'id' => (string) Str::uuid(),
                'key' => $key,
                'description' => $label,
                'enabled' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::unprepared(<<<'SQL'
            -- Shared-read catalog, Super-Admin write (identical to plans/add_ons).
            alter table feature_flags enable row level security;
            alter table feature_flags force row level security;
            create policy catalog_select on feature_flags for select using (true);
            create policy catalog_mutate on feature_flags for all
              using (app.is_super_admin()) with check (app.is_super_admin());

            create table platform_settings (
              key        text primary key,
              value      jsonb not null default '{}'::jsonb,
              updated_at timestamptz not null default now()
            );

            -- Super-Admin read AND write: settings may hold secrets, so SELECT is gated too.
            alter table platform_settings enable row level security;
            alter table platform_settings force row level security;
            create policy settings_select on platform_settings for select
              using (app.is_super_admin());
            create policy settings_mutate on platform_settings for all
              using (app.is_super_admin()) with check (app.is_super_admin());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists feature_flags;
            drop table if exists platform_settings;
        SQL);
    }
};
