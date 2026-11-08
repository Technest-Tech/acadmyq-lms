<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Pay a monthly group one month or two at a time (lingo, 2026-11-08: "many book some subjects on
 * the two-month offer and others not").
 *
 *   class_groups.two_month_price_minor   the offer: what two months cost together (null = 2 × price)
 *   class_group_members.months_per_charge 1 or 2: how many months each of this member's charges buys
 *   invoice_line_items.group_months      how many months a MONTHLY group line covers (null = 1)
 *
 * Additive only: every existing member stays on one month, every existing line covers one.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups add column if not exists two_month_price_minor bigint;
            alter table class_groups drop constraint if exists class_groups_two_month_price_chk;
            alter table class_groups add constraint class_groups_two_month_price_chk
              check (two_month_price_minor is null or two_month_price_minor >= 0);

            alter table class_group_members add column if not exists months_per_charge smallint not null default 1;
            alter table class_group_members drop constraint if exists class_group_members_months_chk;
            alter table class_group_members add constraint class_group_members_months_chk
              check (months_per_charge in (1, 2));

            alter table invoice_line_items add column if not exists group_months smallint;
            alter table invoice_line_items drop constraint if exists invoice_line_items_group_months_chk;
            alter table invoice_line_items add constraint invoice_line_items_group_months_chk
              check (group_months is null or group_months in (1, 2));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoice_line_items drop constraint if exists invoice_line_items_group_months_chk;
            alter table invoice_line_items drop column if exists group_months;
            alter table class_group_members drop constraint if exists class_group_members_months_chk;
            alter table class_group_members drop column if exists months_per_charge;
            alter table class_groups drop constraint if exists class_groups_two_month_price_chk;
            alter table class_groups drop column if exists two_month_price_minor;
        SQL);
    }
};
