<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Notifications & teacher-cancellation approvals (Sprint 9 — Notifications page).
 *
 * Two purpose-built, tenant-scoped tables drive the two tabs of the Notifications page:
 *
 *  - `session_cancellation_requests` (tab "Classes"): a TEACHER no longer cancels a class
 *    directly — they raise a PENDING request (the session stays SCHEDULED) that the OWNER
 *    must approve (→ CANCELLED_BY_*) or reject. One PENDING request per session at a time.
 *
 *  - `notifications` (tab "Reports"): in-app alerts the hourly FlagOverdueReportsJob writes
 *    when a session ended ≥2h ago with no report — REPORT_OVERDUE to the owner(s) and a
 *    REPORT_REMINDER to the teacher. Idempotent: one alert of a given type per session.
 *
 * Both tables carry academy_id and get the identical standard tenant policy
 * (academy_id = app.current_academy_id()) under FORCE RLS — tenant isolation is a database
 * guarantee, not an app convention (§7), matching every other tenant table.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- Teacher cancellation requests awaiting the owner's decision (tab "Classes").
            create table session_cancellation_requests (
              id                   uuid primary key default uuid_generate_v7(),
              academy_id           uuid not null references academies(id),
              session_id           uuid not null references sessions(id),
              teacher_id           uuid not null references teachers(id),
              requested_by_user_id uuid references users(id),
              cancel_type          text not null,                 -- 'teacher' | 'student'
              reason               text,
              status               text not null default 'PENDING', -- PENDING | APPROVED | REJECTED
              decided_by_user_id   uuid references users(id),
              decided_at           timestamptz,
              decision_note        text,
              seen_by_teacher_at   timestamptz,                   -- teacher has viewed the decision
              created_at           timestamptz not null default now(),
              updated_at           timestamptz not null default now(),
              constraint scr_cancel_type_chk check (cancel_type in ('teacher','student')),
              constraint scr_status_chk check (status in ('PENDING','APPROVED','REJECTED'))
            );
            create index scr_academy_status_idx on session_cancellation_requests (academy_id, status);
            create index scr_teacher_idx on session_cancellation_requests (academy_id, teacher_id);
            -- At most one PENDING request per session (the request endpoint also guards this).
            create unique index scr_one_pending_per_session
              on session_cancellation_requests (session_id) where status = 'PENDING';

            -- In-app alerts written by the overdue-reports job (tab "Reports").
            create table notifications (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id),
              type              text not null,                    -- REPORT_OVERDUE | REPORT_REMINDER
              category          text not null,                    -- 'REPORTS'
              audience_role     app_role,                         -- ACADEMY_OWNER broadcast; null when user-targeted
              recipient_user_id uuid references users(id),        -- a specific teacher login
              session_id        uuid references sessions(id),
              data              jsonb not null default '{}'::jsonb,
              read_at           timestamptz,
              created_at        timestamptz not null default now()
            );
            create index notifications_academy_idx on notifications (academy_id, created_at desc);
            create index notifications_recipient_idx on notifications (academy_id, recipient_user_id);
            -- Idempotent re-runs: one alert of a given type per session.
            create unique index notifications_session_type_idx
              on notifications (session_id, type) where session_id is not null;

            -- Standard tenant policy (FORCE RLS) on both tables — identical to every other
            -- tenant-scoped table (§7). The app connects as the table owner, so FORCE is essential.
            alter table session_cancellation_requests enable row level security;
            alter table session_cancellation_requests force row level security;
            create policy tenant_isolation on session_cancellation_requests
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table notifications enable row level security;
            alter table notifications force row level security;
            create policy tenant_isolation on notifications
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on notifications;
            drop policy if exists tenant_isolation on session_cancellation_requests;
            drop table if exists notifications;
            drop table if exists session_cancellation_requests;
        SQL);
    }
};
