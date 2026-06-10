<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Invoicing (§6.6). Monthly invoices, per the academy's grouping config (PER_GUARDIAN
 * or PER_STUDENT). Line items snapshot the price at billing time (R-INV-3) and are
 * idempotent per session (R-BIL-1). Immutability of closed invoices is enforced by
 * triggers added in the triggers migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table invoices (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id),
              guardian_id    uuid references guardians(id),        -- set when PER_GUARDIAN
              student_id     uuid references students(id),         -- set when PER_STUDENT
              period_year    smallint not null,
              period_month   smallint not null,
              status         invoice_status not null default 'OPEN',
              currency       char(3) not null,                     -- (R-INV-7, no FX)
              subtotal_minor bigint not null default 0,
              total_minor    bigint not null default 0,
              public_token   text not null unique,                 -- unguessable, powers public page (R-INV-5)
              closed_at      timestamptz,
              paid_at        timestamptz,
              payment_method payment_method,                       -- when marked paid (R-INV-6)
              payment_reason text,                                 -- free text for OTHER/outside-system
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now(),
              constraint invoices_period_month_chk check (period_month between 1 and 12),
              -- Exactly one of guardian_id / student_id is set (R-INV-4).
              constraint invoices_exactly_one_payer_chk
                check ((guardian_id is null) <> (student_id is null))
            );
            -- One invoice per payer per month (R-INV-1).
            create unique index invoices_payer_period_uidx
              on invoices (academy_id, coalesce(guardian_id, student_id), period_year, period_month);
            create index invoices_academy_idx on invoices (academy_id);

            -- One billable session, price snapshotted (R-INV-3); idempotent per session (R-BIL-1).
            create table invoice_line_items (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              invoice_id  uuid not null references invoices(id) on delete cascade,
              session_id  uuid not null references sessions(id),
              student_id  uuid not null references students(id),   -- which child (per-guardian breakdown)
              description text not null,
              amount_minor bigint not null,                        -- snapshot at billing time
              currency    char(3) not null,
              created_at  timestamptz not null default now(),
              unique (invoice_id, session_id)
            );
            create index invoice_line_items_academy_idx on invoice_line_items (academy_id);
            create index invoice_line_items_invoice_idx on invoice_line_items (invoice_id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists invoice_line_items;
            drop table if exists invoices;
        SQL);
    }
};
