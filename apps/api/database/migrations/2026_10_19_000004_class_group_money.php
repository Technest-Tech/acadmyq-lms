<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Group classes, phase 2 — the money (docs/groups §Money).
 *
 * WHAT THE STUDENT PAYS is set on the group (`billing_mode` + `price_minor` + `currency`), with an
 * optional per-member override (`class_group_members.price_minor`, e.g. a sibling discount). A group
 * with no price bills nothing — that is how every phase-1 group arrives here, so nothing is billed
 * retroactively by this migration.
 *
 *   MONTHLY     one line per member per month, up front (pro-rated by lessons in the join month)
 *   PER_LESSON  one line per member per HELD lesson they came to (absences by `charge_absent`)
 *   COURSE      one line per member on joining — the whole level
 *
 * Group lines go on the SAME invoices as private lessons (the payer's AUTO invoice for the month),
 * as session-less lines that carry their group links instead. The partial unique indexes below are
 * the idempotency guarantee: a member can never be billed twice for the same month, the same
 * lesson, or the same course enrolment — the database refuses it, like `(invoice_id, session_id)`.
 *
 * WHAT THE TEACHER EARNS is ONE payout line per held lesson, never one per student — the reason the
 * group lesson is not a sessions row. `teacher_pay_mode` null = the teacher's own rate, as for a
 * private lesson of that length (a FIXED-salary teacher earns 0 per lesson). REVENUE_SHARE pays a
 * share of what the group billed in the month, as one monthly line per group.
 *
 * Amounts are integer minor units; the share is in basis points (5000 = 50 %).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups
              add column billing_mode       text not null default 'MONTHLY',
              add column price_minor        bigint,
              add column currency           char(3),
              add column charge_absent      boolean not null default false,
              add column prorate_join       boolean not null default true,
              add column teacher_pay_mode   text,
              add column teacher_pay_minor  bigint,
              add column teacher_share_bp   integer,
              add constraint class_groups_billing_mode_chk check (billing_mode in ('MONTHLY','PER_LESSON','COURSE')),
              add constraint class_groups_price_chk check (price_minor is null or (price_minor >= 0 and currency is not null)),
              add constraint class_groups_teacher_pay_mode_chk
                check (teacher_pay_mode is null or teacher_pay_mode in ('PER_LESSON','PER_HOUR','PER_STUDENT','REVENUE_SHARE')),
              add constraint class_groups_teacher_pay_chk check (teacher_pay_minor is null or teacher_pay_minor >= 0),
              add constraint class_groups_teacher_share_chk check (teacher_share_bp is null or teacher_share_bp between 0 and 10000);

            alter table class_group_members
              add column price_minor bigint,
              add constraint class_group_members_price_chk check (price_minor is null or price_minor >= 0);
        SQL);

        // ── Student side: group links on invoice lines ─────────────────────────
        DB::unprepared(<<<'SQL'
            alter table invoice_line_items
              add column class_group_id        uuid references class_groups(id),
              add column class_group_lesson_id uuid references class_group_lessons(id),
              add column group_charge          text,
              add column group_period          date,
              add constraint invoice_line_items_group_charge_chk
                check (group_charge is null or group_charge in ('MONTHLY','LESSON','COURSE')),
              add constraint invoice_line_items_group_shape_chk
                check ((class_group_id is null) = (group_charge is null));

            -- One line per (member, lesson) …
            create unique index invoice_line_items_group_lesson_uidx
              on invoice_line_items (class_group_lesson_id, student_id) where class_group_lesson_id is not null;
            -- … and one per (member, group, month) / (member, group, enrolment date).
            create unique index invoice_line_items_group_period_uidx
              on invoice_line_items (class_group_id, student_id, group_charge, group_period)
              where class_group_id is not null and class_group_lesson_id is null;
            create index invoice_line_items_group_idx on invoice_line_items (class_group_id) where class_group_id is not null;
        SQL);

        // ── Teacher side: a payout line may belong to a group lesson instead of a session ──
        DB::unprepared(<<<'SQL'
            alter table payout_line_items
              alter column session_id drop not null,
              add column class_group_lesson_id uuid references class_group_lessons(id),
              add column class_group_id        uuid references class_groups(id),
              add column group_period          date,
              add column description           text,
              add constraint payout_line_items_anchor_chk
                check (session_id is not null or class_group_lesson_id is not null or class_group_id is not null);

            -- ONE line per group lesson, whichever statement it sits on.
            create unique index payout_line_items_group_lesson_uidx
              on payout_line_items (class_group_lesson_id) where class_group_lesson_id is not null;
            -- ONE revenue-share line per group per month.
            create unique index payout_line_items_group_share_uidx
              on payout_line_items (class_group_id, group_period)
              where class_group_id is not null and class_group_lesson_id is null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists payout_line_items_group_share_uidx;
            drop index if exists payout_line_items_group_lesson_uidx;
            delete from payout_line_items where session_id is null;
            alter table payout_line_items
              drop constraint if exists payout_line_items_anchor_chk,
              drop column if exists description,
              drop column if exists group_period,
              drop column if exists class_group_id,
              drop column if exists class_group_lesson_id,
              alter column session_id set not null;

            drop index if exists invoice_line_items_group_idx;
            drop index if exists invoice_line_items_group_period_uidx;
            drop index if exists invoice_line_items_group_lesson_uidx;
            alter table invoice_line_items
              drop constraint if exists invoice_line_items_group_shape_chk,
              drop constraint if exists invoice_line_items_group_charge_chk,
              drop column if exists group_period,
              drop column if exists group_charge,
              drop column if exists class_group_lesson_id,
              drop column if exists class_group_id;

            alter table class_group_members
              drop constraint if exists class_group_members_price_chk,
              drop column if exists price_minor;

            alter table class_groups
              drop constraint if exists class_groups_teacher_share_chk,
              drop constraint if exists class_groups_teacher_pay_chk,
              drop constraint if exists class_groups_teacher_pay_mode_chk,
              drop constraint if exists class_groups_price_chk,
              drop constraint if exists class_groups_billing_mode_chk,
              drop column if exists teacher_share_bp,
              drop column if exists teacher_pay_minor,
              drop column if exists teacher_pay_mode,
              drop column if exists prorate_join,
              drop column if exists charge_absent,
              drop column if exists currency,
              drop column if exists price_minor,
              drop column if exists billing_mode;
        SQL);
    }
};
