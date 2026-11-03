<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The centre's public enrolment form (docs/centre-profile, Phase 2 §6): ONE stable link per academy
 * that a parent opens from a Facebook or WhatsApp advert and registers interest on — the child, a
 * phone, the subject wanted, the days and time that suit them. The requests land in an inbox the
 * staff work through: call back, book a placement lesson (a `trials` row), enrol.
 *
 *   enrolment_forms     one row per academy, made lazily the first time the staff open the card.
 *                       The token IS the link (`/e/{token}`), so it is long, random and replaceable;
 *                       `is_open` lets the centre pause the form without losing the link.
 *   enrolment_requests  what a visitor sent, and what became of it: NEW → CONTACTED →
 *                       PLACEMENT_BOOKED (trial_id) → ENROLLED (student_id), or CLOSED at any point.
 *                       preferred_days are weekday ints (0 = Sunday … 6 = Saturday, like
 *                       class_group_slots) and preferred_time is the academy's wall clock, never a
 *                       timestamptz — the visitor named a time of day, not an instant.
 *
 * Resolving the token is the one read before any tenant context exists, so it goes through a
 * SECURITY DEFINER hatch exactly like app.guardian_portal_lookup; everything after it runs under RLS
 * as that academy. A suspended academy resolves to nothing; a CLOSED form still resolves (the page
 * says it is closed rather than pretending the link is dead).
 */
return new class extends Migration
{
    private function role(string $key): string
    {
        $role = (string) config("database.rls.{$key}");
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $role)) {
            throw new RuntimeException("Invalid RLS role identifier for {$key}: {$role}");
        }

        return $role;
    }

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table enrolment_forms (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) unique,
              public_token     text not null unique,
              is_open          boolean not null default true,
              title            text not null default 'التسجيل في المركز',
              intro            text,
              ask_subject      boolean not null default true,
              ask_level        boolean not null default true,
              ask_schedule     boolean not null default true,
              success_message  text,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              constraint enrolment_forms_token_chk check (length(public_token) >= 24)
            );

            alter table enrolment_forms enable row level security;
            alter table enrolment_forms force row level security;
            create policy tenant_isolation on enrolment_forms
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table enrolment_requests (
              id                 uuid primary key default uuid_generate_v7(),
              academy_id         uuid not null references academies(id),
              form_id            uuid not null references enrolment_forms(id),
              student_name       text not null,
              guardian_name      text,
              phone              text not null,
              email              text,
              age                smallint,
              subject_id         uuid references specializations(id) on delete set null,
              subject_text       text,
              level_text         text,
              preferred_days     smallint[] not null default '{}',
              preferred_time     text,
              message            text,
              source             text not null default 'LINK',
              status             text not null default 'NEW',
              staff_note         text,
              handled_by         uuid references users(id),
              trial_id           uuid references trials(id) on delete set null,
              student_id         uuid references students(id) on delete set null,
              status_changed_at  timestamptz not null default now(),
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now(),
              constraint enrolment_requests_status_chk check (status in ('NEW','CONTACTED','PLACEMENT_BOOKED','ENROLLED','CLOSED')),
              constraint enrolment_requests_age_chk check (age is null or age between 1 and 120),
              constraint enrolment_requests_time_chk check (preferred_time is null or preferred_time ~ '^[0-2][0-9]:[0-5][0-9]$')
            );
            create index enrolment_requests_inbox_idx on enrolment_requests (academy_id, status, created_at desc);
            create index enrolment_requests_trial_idx on enrolment_requests (trial_id) where trial_id is not null;

            alter table enrolment_requests enable row level security;
            alter table enrolment_requests force row level security;
            create policy tenant_isolation on enrolment_requests
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            -- The public link's one pre-context read: which academy's form is this token?
            create or replace function app.enrolment_form_lookup(p_token text)
            returns table (form_id uuid, academy_id uuid)
            language sql stable security definer
            set search_path = public, pg_catalog
            as $$
              select f.id, f.academy_id
                from enrolment_forms f
                join academies a on a.id = f.academy_id
               where f.public_token = p_token
                 and a.status <> 'SUSPENDED'
               limit 1;
            $$;
        SQL);

        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        DB::unprepared("grant select on enrolment_forms, academies to {$bypass};");
        DB::unprepared("alter function app.enrolment_form_lookup(text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.enrolment_form_lookup(text) from public;');
        DB::unprepared("grant execute on function app.enrolment_form_lookup(text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.enrolment_form_lookup(text);
            drop table if exists enrolment_requests;
            drop table if exists enrolment_forms;
        SQL);
    }
};
