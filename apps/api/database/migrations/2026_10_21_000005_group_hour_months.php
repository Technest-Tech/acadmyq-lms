<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Group classes — a MONTHLY group may sell its month as HOURS ("600 a month, 8 hours"). With
 * `month_minutes` set, a member's month is not the calendar month: their fee buys that many hours
 * of the group's lessons, and the next fee is raised when the group has held them (absent or not —
 * the class happened). Empty = the calendar month, exactly as before, so every existing group keeps
 * billing the way it does today.
 *
 *   class_groups.month_minutes         the hours one month buys, in minutes (480 = 8 h)
 *   class_groups.billing_rule_from     set when an existing group switches between calendar months
 *                                      and hour-months: the new rule counts from this date (the 1st
 *                                      of the next month), so the month already paid under the old
 *                                      rule is never paid twice
 *   class_group_members.carried_minutes hours (in minutes) a member brought with them, moved from
 *                                      another hours group with some of their month unused — and,
 *                                      negative, what they took away when they left
 *   invoice_line_items.group_cycle      which of the member's months this line is (1, 2, 3 …)
 *   invoice_line_items.group_minutes    the minutes that month bought — a snapshot, like the price,
 *                                      so changing the hours later never re-reads what was sold
 *
 * An hour-month line is still group_charge 'MONTHLY' (it is the monthly fee on every screen); its
 * idempotency key is (group, student, cycle) instead of (group, student, period), so the calendar
 * index skips it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups
              add column month_minutes     integer,
              add column billing_rule_from date,
              add constraint class_groups_month_minutes_chk check (month_minutes is null or month_minutes between 1 and 60000);

            alter table class_group_members
              add column carried_minutes integer not null default 0;

            alter table invoice_line_items
              add column group_cycle   integer,
              add column group_minutes integer,
              add constraint invoice_line_items_group_cycle_chk check (
                (group_cycle is null) = (group_minutes is null)
                and (group_cycle is null or (group_charge = 'MONTHLY' and group_cycle >= 1 and group_minutes > 0))
              );

            drop index if exists invoice_line_items_group_period_uidx;
            create unique index invoice_line_items_group_period_uidx
              on invoice_line_items (class_group_id, student_id, group_charge, group_period)
              where class_group_id is not null and class_group_lesson_id is null and group_cycle is null;
            -- One line per (member, group, hour-month).
            create unique index invoice_line_items_group_cycle_uidx
              on invoice_line_items (class_group_id, student_id, group_cycle)
              where group_cycle is not null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists invoice_line_items_group_cycle_uidx;
            drop index if exists invoice_line_items_group_period_uidx;
            delete from invoice_line_items where group_cycle is not null;
            create unique index invoice_line_items_group_period_uidx
              on invoice_line_items (class_group_id, student_id, group_charge, group_period)
              where class_group_id is not null and class_group_lesson_id is null;

            alter table invoice_line_items
              drop constraint if exists invoice_line_items_group_cycle_chk,
              drop column if exists group_minutes,
              drop column if exists group_cycle;

            alter table class_group_members drop column if exists carried_minutes;

            alter table class_groups
              drop constraint if exists class_groups_month_minutes_chk,
              drop column if exists billing_rule_from,
              drop column if exists month_minutes;
        SQL);
    }
};
