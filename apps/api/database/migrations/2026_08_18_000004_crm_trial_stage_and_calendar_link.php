<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The CRM pipeline becomes the one place a prospect is worked, from first contact to first
 * invoice — so it grows the two stages that were previously separate screens:
 *
 *   NEW → CONTACTED → INTERESTED → TRIAL → SUBSCRIBED   (+ LOST from anywhere)
 *
 *  • TRIAL is a stage with a booking behind it: moving a lead here books a real `trials` row
 *    (teacher + instant + duration), which is why `trials.lead_id` now exists — one lead can
 *    hold several trials over its life (a no-show gets a second chance), and the newest live
 *    one is what the board card shows. The link is also what puts the trial on the academy
 *    calendar: the calendar feed reads `trials` directly, so a booked trial appears there
 *    without anyone materialising a `sessions` row for a person who is not yet a student.
 *  • SUBSCRIBED replaces WON. "Won" was a sales word that said nothing about the system:
 *    a lead reaches this stage only by becoming a real student row (converted_student_id),
 *    which is what makes them appear on the Students page. Renaming the value keeps the
 *    vocabulary honest — the stage now means exactly "they are a student now".
 *
 * `trials_identity_chk` gains a third identity path. A trial has always needed to say WHO it
 * is for — an existing student, or a lead with name + WhatsApp captured inline. A CRM lead IS
 * that identity (it carries its own contact record), so `lead_id` alone satisfies the check;
 * a CRM lead without a phone number can therefore still be given a trial.
 *
 * Two new timeline types (TRIAL_BOOKED / TRIAL_OUTCOME) let the trial's whole life show up on
 * the lead's activity feed, so the CRM answers "what happened with this person?" on its own.
 *
 * Raw DDL (DB::unprepared) because a Postgres CHECK has no Blueprint API — the house style for
 * every enum-via-constraint migration since Sprint 1.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1 — unlock the vocabulary before rewriting any value (DDL is not RLS-filtered).
        DB::unprepared(<<<'SQL'
            alter table crm_leads drop constraint if exists crm_leads_status_check;
            alter table crm_leads drop constraint if exists crm_leads_status_chk;
        SQL);

        // 2 — WON → SUBSCRIBED on existing rows, including the two places a status STRING is
        //     stored rather than referenced: the lead's own column, and the from/to pair inside
        //     a STATUS_CHANGE timeline entry (a stale 'WON' there would render as a missing
        //     label). Both tables carry FORCE ROW LEVEL SECURITY, which is what subjects the
        //     owning role to the tenant policy — so a plain UPDATE here would quietly match zero
        //     rows (no academy GUC is set during a migration). Lifting FORCE for the length of
        //     the rewrite hands the table owner back its ordinary owner exemption; the migration
        //     runs in a transaction, so a failure rolls the exemption back with everything else.
        DB::unprepared(<<<'SQL'
            alter table crm_leads no force row level security;
            alter table crm_lead_activities no force row level security;

            update crm_leads set status = 'SUBSCRIBED' where status = 'WON';

            update crm_lead_activities set meta = jsonb_set(meta, '{from}', '"SUBSCRIBED"')
              where meta ->> 'from' = 'WON';
            update crm_lead_activities set meta = jsonb_set(meta, '{to}', '"SUBSCRIBED"')
              where meta ->> 'to' = 'WON';

            alter table crm_leads force row level security;
            alter table crm_lead_activities force row level security;
        SQL);

        // 3 — the widened pipeline + timeline vocabularies, and the trial↔lead link.
        DB::unprepared(<<<'SQL'
            alter table crm_leads
              add constraint crm_leads_status_chk
              check (status in ('NEW','CONTACTED','INTERESTED','TRIAL','SUBSCRIBED','LOST'));

            alter table crm_lead_activities drop constraint if exists crm_lead_activities_type_check;
            alter table crm_lead_activities
              add constraint crm_lead_activities_type_chk
              check (type in ('CREATED','NOTE','STATUS_CHANGE','FOLLOW_UP_SET','TRIAL_BOOKED','TRIAL_OUTCOME','CONVERTED'));

            -- The lead a trial was booked for. `set null` so deleting a lead never deletes the
            -- teaching record: the trial happened, and it still belongs on the calendar and in
            -- the trials statistics.
            alter table trials
              add column if not exists lead_id uuid references crm_leads(id) on delete set null;
            create index if not exists trials_lead_idx on trials (lead_id) where lead_id is not null;

            alter table trials drop constraint if exists trials_identity_chk;
            alter table trials add constraint trials_identity_chk check (
              student_id is not null
              or lead_id is not null
              or (lead_name is not null and lead_whatsapp is not null)
            );
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table crm_leads drop constraint if exists crm_leads_status_chk;
            alter table crm_lead_activities drop constraint if exists crm_lead_activities_type_chk;

            drop index if exists trials_lead_idx;
            alter table trials drop constraint if exists trials_identity_chk;
        SQL);

        // A trial that only ever had a lead identity would violate the narrower check, so give
        // it the lead's contact details before the column disappears (same FORCE lift as up()).
        DB::unprepared(<<<'SQL'
            alter table trials no force row level security;
            alter table crm_leads no force row level security;
            alter table crm_lead_activities no force row level security;

            update trials t
               set lead_name = coalesce(t.lead_name, l.full_name),
                   lead_whatsapp = coalesce(t.lead_whatsapp, l.whatsapp_phone, 'unknown')
              from crm_leads l
             where l.id = t.lead_id
               and t.student_id is null;

            update crm_leads set status = 'WON' where status = 'SUBSCRIBED';
            -- TRIAL has no pre-existing counterpart; INTERESTED is the stage it grew out of.
            update crm_leads set status = 'INTERESTED' where status = 'TRIAL';

            update crm_lead_activities set meta = jsonb_set(meta, '{from}', '"WON"')
              where meta ->> 'from' = 'SUBSCRIBED';
            update crm_lead_activities set meta = jsonb_set(meta, '{to}', '"WON"')
              where meta ->> 'to' = 'SUBSCRIBED';
            update crm_lead_activities set type = 'NOTE'
              where type in ('TRIAL_BOOKED','TRIAL_OUTCOME');

            alter table trials force row level security;
            alter table crm_leads force row level security;
            alter table crm_lead_activities force row level security;
        SQL);

        DB::unprepared(<<<'SQL'
            alter table trials drop column if exists lead_id;
            alter table trials add constraint trials_identity_chk check (
              student_id is not null
              or (lead_name is not null and lead_whatsapp is not null)
            );

            alter table crm_leads
              add constraint crm_leads_status_check
              check (status in ('NEW','CONTACTED','INTERESTED','WON','LOST'));
            alter table crm_lead_activities
              add constraint crm_lead_activities_type_check
              check (type in ('CREATED','NOTE','STATUS_CHANGE','FOLLOW_UP_SET','CONVERTED'));
        SQL);
    }
};
