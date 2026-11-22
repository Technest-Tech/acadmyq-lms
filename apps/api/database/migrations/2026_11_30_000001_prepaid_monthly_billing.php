<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Prepaid monthly billing (Settings → طريقة التحصيل), asked by انا مسلم 2026-11-22 and built for
 * every academy as a choice: "after the lessons" (the default, unchanged) or "monthly, in advance".
 *
 * In advance: on the issue day (27th by default) each monthly student's NEXT month is billed in full,
 * less the lessons of this month that ended "not charged" (a cancellation or excused absence the
 * office chose not to charge). Attendance stops adding lesson lines for those students. Purely
 * additive: every existing row reads as "after the lessons", and every existing line has no
 * prepaid fields.
 *
 *   • academy_settings.billing_mode       — AFTER_LESSONS | PREPAID_MONTHLY
 *   • academy_settings.prepaid_issue_day  — day of the month the next month is billed (1–28)
 *   • academy_settings.prepaid_due_day    — the bill's pay-by day in the month it pays for (1–28)
 *   • academy_settings.prepaid_from       — first month of the in-advance regime (first of month)
 *   • academy_settings.prepaid_first_fee  — first month the system bills in advance; a month between
 *                                           the two was collected outside the system in full
 *   • academy_settings.prepaid_whatsapp   — send each new bill to the payer on WhatsApp
 *   • invoice_line_items.prepaid_charge   — FEE (a month's subscription) | LESSON (one lesson's
 *                                           deduction, its reversal, or a lesson outside a paid month)
 *   • invoice_line_items.prepaid_period   — the month the line belongs to (first of month)
 *   • invoice_line_items.prepaid_session_id — the lesson a LESSON line is about. Not session_id on
 *                                           purpose: every lesson-line reader (repricing, un-billing,
 *                                           the month quota) must keep ignoring these lines.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academy_settings
              add column if not exists billing_mode      text     not null default 'AFTER_LESSONS',
              add column if not exists prepaid_issue_day smallint not null default 27,
              add column if not exists prepaid_due_day   smallint not null default 5,
              add column if not exists prepaid_from      date,
              add column if not exists prepaid_first_fee date,
              add column if not exists prepaid_whatsapp  boolean  not null default false;

            alter table academy_settings
              add constraint academy_settings_billing_mode_chk check (billing_mode in ('AFTER_LESSONS', 'PREPAID_MONTHLY')),
              add constraint academy_settings_prepaid_days_chk check (prepaid_issue_day between 1 and 28 and prepaid_due_day between 1 and 28);

            alter table invoice_line_items
              add column if not exists prepaid_charge     text,
              add column if not exists prepaid_period     date,
              add column if not exists prepaid_session_id uuid references sessions(id) on delete set null;

            alter table invoice_line_items
              add constraint invoice_line_items_prepaid_chk
                check ((prepaid_charge is null and prepaid_period is null and prepaid_session_id is null)
                    or (prepaid_charge in ('FEE', 'LESSON') and prepaid_period is not null));

            create index if not exists invoice_line_items_prepaid_idx
              on invoice_line_items (student_id, prepaid_period) where prepaid_charge is not null;
            create index if not exists invoice_line_items_prepaid_session_idx
              on invoice_line_items (prepaid_session_id) where prepaid_session_id is not null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists invoice_line_items_prepaid_session_idx;
            drop index if exists invoice_line_items_prepaid_idx;
            alter table invoice_line_items
              drop constraint if exists invoice_line_items_prepaid_chk,
              drop column if exists prepaid_session_id,
              drop column if exists prepaid_period,
              drop column if exists prepaid_charge;
            alter table academy_settings
              drop constraint if exists academy_settings_prepaid_days_chk,
              drop constraint if exists academy_settings_billing_mode_chk,
              drop column if exists prepaid_whatsapp,
              drop column if exists prepaid_first_fee,
              drop column if exists prepaid_from,
              drop column if exists prepaid_due_day,
              drop column if exists prepaid_issue_day,
              drop column if exists billing_mode;
        SQL);
    }
};
