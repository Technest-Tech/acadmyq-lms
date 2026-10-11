<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Booking requests on the course site (docs/lms/13) — "احجز استشارة", "احجز كورس", or whatever the
 * client calls it. ONE feature, named by the client: some sell consultations, some take course
 * bookings, some do both, so the site carries any number of FORMS, each with its own title and its
 * own handful of questions, and every submission lands in one inbox in the dashboard.
 *
 * Two decisions this schema encodes:
 *
 *  1. **A form is configured, not built.** The questions a booking actually needs are few and known
 *     — who, how to reach them, which course, which day, which kind, anything else — so a form is a
 *     set of switches over those, plus one client-defined choice list. A free-form field builder
 *     would be more power than any client has asked for, and every free-form answer is a column the
 *     inbox cannot filter on.
 *  2. **A request outlives its form.** The client renames "احجز استشارة" to "استشارة مجانية" or
 *     deletes it outright, and last month's requests must still read the way they were made — so the
 *     form's title (and the course's) is SNAPSHOT onto the request, and the foreign keys only
 *     `set null`.
 *
 * Both tables carry the standard FORCE-RLS `tenant_isolation` policy: staff read them under their
 * tenant context, the public site writes under ResolveAcademyContext's, and both are the same
 * academy. Capability checks (`booking.read` / `booking.manage`) stay the controller's job.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table booking_forms (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id) on delete cascade,
              -- The client's own name for it. It is the page title, the nav link and the default
              -- button label all at once, which is the whole point: the template has no opinion
              -- about whether this is a consultation or a course booking.
              title           text not null,
              slug            text not null,
              description     text,
              -- Blank = the template's translated default ("Send request" / "We'll be in touch").
              submit_label    text,
              success_message text,
              -- The optional questions. Name + phone are always asked: a request nobody can call
              -- back is not a request.
              ask_email       boolean not null default true,
              ask_course      boolean not null default false,
              ask_date        boolean not null default false,
              ask_message     boolean not null default true,
              -- One client-defined pick-list ("نوع الاستشارة": فردية / عائلية / شركات). Empty
              -- array = the question is not asked; non-empty = it is asked AND required.
              choice_label    text,
              choices         jsonb not null default '[]'::jsonb,
              -- Where the public site advertises it. A HIDDEN form 404s publicly but keeps its inbox.
              show_in_nav     boolean not null default true,
              show_on_home    boolean not null default true,
              status          text not null default 'ACTIVE' check (status in ('ACTIVE','HIDDEN')),
              created_by      uuid,
              created_at      timestamptz not null default now(),
              updated_at      timestamptz not null default now(),
              unique (academy_id, slug)
            );
            create index booking_forms_academy_idx on booking_forms (academy_id, status, created_at);

            alter table booking_forms enable row level security;
            alter table booking_forms force row level security;
            create policy tenant_isolation on booking_forms
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            comment on column booking_forms.choices is
              'jsonb array of short strings. Non-empty ⇒ the visitor must pick one; the pick is stored as text on the request.';
        SQL);

        DB::unprepared(<<<'SQL'
            create table booking_requests (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id) on delete cascade,
              form_id         uuid references booking_forms(id) on delete set null,
              form_title      text not null,
              -- Set when the visitor was signed in to the course site; a booking never REQUIRES an
              -- account (a sign-up wall in front of "call me back" loses the lead).
              learner_id      uuid references learners(id) on delete set null,
              full_name       text not null,
              phone           text not null,
              email           text,
              course_id       uuid references courses(id) on delete set null,
              course_title    text,
              choice          text,
              -- The visitor's wish, in the academy's wall-clock — never converted, never a
              -- timestamptz: "Tuesday at 7" means 7 where the academy is, and a timezone round-trip
              -- is exactly how a preference turns into the wrong hour (pg-naive-timestamp trap).
              preferred_date  date,
              preferred_time  text check (preferred_time is null or preferred_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
              message         text,
              status          text not null default 'NEW'
                check (status in ('NEW','CONTACTED','CONFIRMED','COMPLETED','CANCELLED')),
              staff_note      text,
              handled_by      uuid references users(id) on delete set null,
              status_changed_at timestamptz,
              created_at      timestamptz not null default now(),
              updated_at      timestamptz not null default now()
            );
            create index booking_requests_inbox_idx
              on booking_requests (academy_id, status, created_at desc);
            create index booking_requests_form_idx
              on booking_requests (academy_id, form_id, created_at desc);
            -- The double-submit guard looks a request up by form + phone.
            create index booking_requests_dupe_idx
              on booking_requests (form_id, phone, created_at desc);

            alter table booking_requests enable row level security;
            alter table booking_requests force row level security;
            create policy tenant_isolation on booking_requests
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            comment on column booking_requests.form_title is
              'Snapshot of booking_forms.title at submission — the inbox reads right after a rename or a delete.';
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists booking_requests;
            drop table if exists booking_forms;
        SQL);
    }
};
