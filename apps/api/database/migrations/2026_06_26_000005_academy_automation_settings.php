<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-academy WhatsApp automation configuration (Super Admin). Holds the academy's Wasender API
 * token (stored ENCRYPTED at the app layer via Crypt::encryptString — the column is ciphertext) and
 * independent on/off toggles for each automation type:
 *   • type1_billing_enabled — monthly student billing + unpaid dunning
 *   • type2_lessons_enabled — lesson/trial reminders for students + teachers
 *
 * One row per academy. Tenant-scoped RLS keeps each academy's token isolated; the token is never
 * returned by any controller (admin GET exposes only has_token + a masked tail). The WhatsAppSender
 * seam reads the token here to switch from the wa.me deep-link fallback to real Wasender delivery.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table academy_automation_settings (
              id                      uuid primary key default uuid_generate_v7(),
              academy_id              uuid not null references academies(id) on delete cascade unique,
              wasender_token          text,
              wasender_session_status text,
              type1_billing_enabled   boolean not null default false,
              type2_lessons_enabled   boolean not null default false,
              type1_config            jsonb not null default '{}'::jsonb,
              type2_config            jsonb not null default '{}'::jsonb,
              created_at              timestamptz not null default now(),
              updated_at              timestamptz not null default now()
            );
            create index academy_automation_settings_academy_idx
              on academy_automation_settings (academy_id);

            alter table academy_automation_settings enable row level security;
            alter table academy_automation_settings force row level security;
            create policy tenant_isolation on academy_automation_settings
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on academy_automation_settings;
            drop table if exists academy_automation_settings;
        SQL);
    }
};
