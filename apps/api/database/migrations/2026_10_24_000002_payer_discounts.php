<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Discounts as visible entries (docs/groups/01-ACCOUNTING.md, F2). A family (or one child) carries
 * one or more standing discounts — a percentage or a fixed amount off each charge, with a label the
 * desk chose ("sibling", "scholarship") and who gave it. They are applied when a charge is RAISED:
 * the line keeps its list price and the discount taken, and `amount_minor` stays the net the ledger
 * has always worked with. Ending a discount stops it from that day; what it already took stays on
 * the lines it touched. Only an academy kept by receipts (`academy_ledgers`) ever applies one.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table payer_discounts (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id),
              guardian_id    uuid references guardians(id),
              student_id     uuid references students(id),          -- set = this child only; null = every child of the family
              kind           text not null,                         -- PERCENT (value = basis points) | FIXED (value = minor units per charge)
              value          integer not null,
              label          text not null,
              scope          text not null default 'ALL',           -- ALL | GROUP | PRIVATE
              class_group_id uuid references class_groups(id),      -- GROUP scope may name one group
              starts_on      date not null,
              ends_on        date,                                  -- null = standing; set = no charge on/after this day takes it
              created_by     uuid references users(id),
              ended_by       uuid references users(id),
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now(),
              constraint payer_discounts_payer_chk check (guardian_id is not null or student_id is not null),
              constraint payer_discounts_kind_chk check (kind in ('PERCENT', 'FIXED')),
              constraint payer_discounts_value_chk check (value > 0 and (kind <> 'PERCENT' or value <= 10000)),
              constraint payer_discounts_scope_chk check (scope in ('ALL', 'GROUP', 'PRIVATE')),
              constraint payer_discounts_label_chk check (length(trim(label)) > 0)
            );
            create index payer_discounts_guardian_idx on payer_discounts (guardian_id) where guardian_id is not null;
            create index payer_discounts_student_idx on payer_discounts (student_id) where student_id is not null;

            alter table payer_discounts enable row level security;
            alter table payer_discounts force row level security;
            create policy tenant_isolation on payer_discounts
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            -- What a line was before its discount, and the discount it took. amount_minor stays the net.
            alter table invoice_line_items
              add column list_amount_minor bigint,
              add column discount_minor    bigint not null default 0,
              add column discount_label    text;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoice_line_items
              drop column if exists list_amount_minor,
              drop column if exists discount_minor,
              drop column if exists discount_label;
            drop table if exists payer_discounts;
        SQL);
    }
};
