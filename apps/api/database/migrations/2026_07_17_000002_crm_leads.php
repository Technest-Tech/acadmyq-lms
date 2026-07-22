<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * CRM module (entitled:crm) — the leads pipeline an academy's sales/support staff work from.
 *
 * `crm_leads` is one prospective student moving through a fixed five-step pipeline
 * (NEW → CONTACTED → INTERESTED → WON/LOST). A lead that enrols is linked to the real
 * student it became via `converted_student_id` (set null on student delete so lead history
 * outlives the student row). `follow_up_at` is a DATE, not a timestamp: staff promise
 * "call back Tuesday", not "14:32:07", and the board colours it overdue/today.
 *
 * `crm_lead_activities` is the per-lead timeline: manual NOTEs plus auto-logged lifecycle
 * events (CREATED / STATUS_CHANGE / FOLLOW_UP_SET / CONVERTED) with the acting user, so a
 * beginner can always answer "who talked to this person and what happened?".
 *
 * Both are plain tenant tables: RLS tenant_isolation only (capability checks are the
 * controller's job — same split as trials), copied verbatim from whatsapp_api_keys.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table crm_leads (
              id                   uuid primary key default uuid_generate_v7(),
              academy_id           uuid not null references academies(id) on delete cascade,
              full_name            text not null,
              whatsapp_phone       text,
              source               text not null default 'OTHER'
                check (source in ('FACEBOOK','INSTAGRAM','WHATSAPP','REFERRAL','WALK_IN','PHONE','WEBSITE','OTHER')),
              interested_in        text,
              status               text not null default 'NEW'
                check (status in ('NEW','CONTACTED','INTERESTED','WON','LOST')),
              lost_reason          text,
              follow_up_at         date,
              converted_student_id uuid references students(id) on delete set null,
              created_by           uuid,
              created_at           timestamptz not null default now(),
              updated_at           timestamptz not null default now(),
              deleted_at           timestamptz
            );
            create index crm_leads_academy_status_idx
              on crm_leads (academy_id, status, created_at desc);
            create index crm_leads_academy_follow_up_idx
              on crm_leads (academy_id, follow_up_at)
              where deleted_at is null;

            alter table crm_leads enable row level security;
            alter table crm_leads force row level security;
            create policy tenant_isolation on crm_leads
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table crm_lead_activities (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              lead_id     uuid not null references crm_leads(id) on delete cascade,
              type        text not null
                check (type in ('CREATED','NOTE','STATUS_CHANGE','FOLLOW_UP_SET','CONVERTED')),
              body        text,
              meta        jsonb,
              created_by  uuid,
              created_at  timestamptz not null default now()
            );
            create index crm_lead_activities_lead_idx
              on crm_lead_activities (lead_id, created_at desc);

            alter table crm_lead_activities enable row level security;
            alter table crm_lead_activities force row level security;
            create policy tenant_isolation on crm_lead_activities
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on crm_lead_activities;
            drop table if exists crm_lead_activities;
            drop policy if exists tenant_isolation on crm_leads;
            drop table if exists crm_leads;
        SQL);
    }
};
