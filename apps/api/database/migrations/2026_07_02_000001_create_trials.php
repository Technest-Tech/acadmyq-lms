<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Free trials (Free-Trials module). A trial is a single, one-off taster session an academy
 * books against an available teacher. Unlike a `session` it may exist for a person who is NOT
 * yet a student: a lightweight LEAD (name + WhatsApp, optional email) captured inline. Either
 * `student_id` (an existing learner) OR the lead fields must be present — the CHECK enforces it.
 *
 * The trial is self-contained (it never materialises a `sessions` row) because a lead has no
 * `student_id` and the sessions table requires one; keeping both trial paths in one table avoids
 * an inconsistent special-case. Conflict detection therefore scans BOTH sessions and trials.
 *
 * Lifecycle (`status`): SCHEDULED → COMPLETED | NO_SHOW | CANCELLED, and COMPLETED → CONVERTED
 * once the lead is turned into a real student (`converted_student_id` records the link).
 *
 * RLS: standard tenant isolation, mirroring the Sprint 0 policy on every academy-scoped table —
 * created here because the static policy migration (000010) predates this table.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table trials (
              id                   uuid primary key default uuid_generate_v7(),
              academy_id           uuid not null references academies(id),
              teacher_id           uuid not null references teachers(id),
              -- Existing learner path (mutually exclusive with the lead fields below).
              student_id           uuid references students(id),
              -- Prospect/lead path: minimal contact captured before they are a student.
              lead_name            text,
              lead_whatsapp        text,                              -- E.164, normalised in the controller
              lead_email           text,
              -- The booking. Local time is expressed in `timezone`; the instant is stored in UTC.
              timezone             text not null,
              scheduled_at_utc     timestamptz not null,
              duration_minutes     smallint not null default 30,
              status               text not null default 'SCHEDULED',
              outcome_notes        text,
              -- Set when a lead trial is turned into a real student (R: convert flow).
              converted_student_id uuid references students(id),
              deleted_at           timestamptz,
              created_at           timestamptz not null default now(),
              updated_at           timestamptz not null default now(),
              constraint trials_status_chk check (status in
                ('SCHEDULED','COMPLETED','NO_SHOW','CANCELLED','CONVERTED')),
              constraint trials_duration_chk check (duration_minutes between 1 and 600),
              -- Exactly one identity: an existing student, or a lead with at least name + WhatsApp.
              constraint trials_identity_chk check (
                student_id is not null
                or (lead_name is not null and lead_whatsapp is not null)
              )
            );
            create index trials_calendar_idx on trials (academy_id, scheduled_at_utc);
            create index trials_status_idx on trials (academy_id, status);
            create index trials_teacher_idx on trials (academy_id, teacher_id, scheduled_at_utc);

            -- Standard tenant policy: academy_id = app.current_academy_id() on read AND write.
            -- FORCE so the app role (table owner) is not exempt (mirrors §7 / migration 000010).
            alter table trials enable row level security;
            alter table trials force row level security;
            create policy tenant_isolation on trials
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on trials;
            drop table if exists trials;
        SQL);
    }
};
