<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Payroll (§6.7). One payout per teacher per period; one line item per attended
 * session (R-PAY-2), idempotent per session.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table payouts (
              id           uuid primary key default uuid_generate_v7(),
              academy_id   uuid not null references academies(id),
              teacher_id   uuid not null references teachers(id),
              period_year  smallint not null,
              period_month smallint not null,
              total_minor  bigint not null default 0,
              currency     char(3) not null,
              finalized_at timestamptz,
              created_at   timestamptz not null default now(),
              updated_at   timestamptz not null default now(),
              constraint payouts_period_month_chk check (period_month between 1 and 12),
              unique (academy_id, teacher_id, period_year, period_month)
            );
            create index payouts_academy_idx on payouts (academy_id);

            create table payout_line_items (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              payout_id   uuid not null references payouts(id) on delete cascade,
              session_id  uuid not null references sessions(id),
              amount_minor bigint not null,                        -- snapshot of teacher rate
              currency    char(3) not null,
              created_at  timestamptz not null default now(),
              unique (payout_id, session_id)                       -- idempotency
            );
            create index payout_line_items_academy_idx on payout_line_items (academy_id);
            create index payout_line_items_payout_idx on payout_line_items (payout_id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists payout_line_items;
            drop table if exists payouts;
        SQL);
    }
};
