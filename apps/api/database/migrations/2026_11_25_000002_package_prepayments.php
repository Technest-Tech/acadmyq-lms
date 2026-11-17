<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Paying packages ahead (Ahmed 2026-11-17: "pay two months in advance for one student or more, so
 * the system doesn't bring them to Due until the period they paid is over").
 *
 * One row = the family paid for the next N blocks of one student's package, in one go. The row
 * counts them (`blocks_used` of `blocks_total`); each renewal that opens while blocks are left is
 * settled from it (App\Services\PackagePrepayments::settle), so it never shows as due.
 *
 *   • classic academies — the row IS the record of the money (method, reference, proof, date);
 *     each renewal's bill is marked paid from it.
 *   • academies on receipts — the money is a receipt (`receipt_id`); what it did not pay now is
 *     the family's credit, which the ledger applies to each renewal's bill by itself. The row
 *     still counts the blocks, for the cards.
 *
 * `cancelled_at` — the blocks still unused were taken back (a mistake, or the family left).
 * `lesson_packages.prepayment_id` — the renewal a prepayment settled; undoing that renewal (a
 * lesson taken back before it was used) hands the block back.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table package_prepayments (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id),
              student_id          uuid not null references students(id),
              -- The running block it was bought on; the renewals of its subject are what it pays.
              package_id          uuid not null references lesson_packages(id),
              teacher_id          uuid references teachers(id),
              currency            char(3) not null,
              blocks_total        integer not null,
              blocks_used         integer not null default 0,
              block_price_minor   bigint not null,
              amount_minor        bigint not null,
              payment_method      text not null,
              payment_reference   text,
              payment_proof_path  text,
              note                text,
              paid_on             date not null,
              receipt_id          uuid references receipts(id),
              created_by          uuid references users(id),
              created_at          timestamptz not null default now(),
              updated_at          timestamptz not null default now(),
              cancelled_at        timestamptz,
              cancelled_by        uuid references users(id),
              constraint package_prepayments_blocks_chk check (blocks_total > 0 and blocks_used >= 0 and blocks_used <= blocks_total),
              constraint package_prepayments_money_chk check (block_price_minor >= 0 and amount_minor >= 0)
            );
            create index package_prepayments_student_idx on package_prepayments (student_id) where cancelled_at is null;

            alter table package_prepayments enable row level security;
            alter table package_prepayments force row level security;
            create policy tenant_isolation on package_prepayments
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create trigger trg_set_updated_at before update on package_prepayments
              for each row execute function set_updated_at();

            -- The renewal a prepayment paid for: undoing that renewal gives the block back.
            alter table lesson_packages add column prepayment_id uuid references package_prepayments(id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages drop column if exists prepayment_id;
            drop table if exists package_prepayments;
        SQL);
    }
};
