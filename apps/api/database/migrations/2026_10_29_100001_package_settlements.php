<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A prepaid subscription that ends before it is used up (a curriculum centre, 2026-10-29): the
 * family paid 8 lessons, took 3, and stopped. What they paid for the 5 they never had used to
 * vanish with the closed block. Now the block is settled (App\Services\PackageSettlement):
 *
 *   CREDIT  its bill comes down to what was used; what was paid beyond that is the family's credit
 *   REFUND  the same, and that credit is paid back out of a treasury account (an expense under
 *           "رد مبالغ للأسر", drawn on the receipts that held it)
 *   KEEP    the academy keeps it — the decision and why, recorded
 *
 * lesson_packages.settlement is PENDING from the moment such a block closes with lessons left on
 * a bill that charges more than they used, until someone decides; then the mode, how much, who,
 * when, why.
 *
 * Two ledger rules learn about it:
 *   - receipt_refunds: money of a receipt paid back. A receipt's credit is now its amount minus
 *     what is allocated minus what was refunded (an expense voided gives it back).
 *   - a settled bill may come DOWN while closed: only inside a settlement, which names the one
 *     invoice in `app.settling_invoice_id` for its own transaction. Every other rule stays.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages
              add column settlement         text,
              add column settled_minor      bigint,
              add column settled_at         timestamptz,
              add column settled_by         uuid references users(id),
              add column settle_note        text,
              add column settle_expense_id  uuid references expenses(id),
              add constraint lesson_packages_settlement_chk check (settlement in ('PENDING','CREDIT','REFUND','KEEP')),
              add constraint lesson_packages_settled_chk check ((settled_at is null) = (settlement is null or settlement = 'PENDING'));
            create index lesson_packages_settlement_idx on lesson_packages (academy_id) where settlement = 'PENDING';

            create table receipt_refunds (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              receipt_id    uuid not null references receipts(id),
              expense_id    uuid not null references expenses(id),
              amount_minor  bigint not null,
              created_at    timestamptz not null default now(),
              constraint receipt_refunds_amount_chk check (amount_minor > 0),
              unique (receipt_id, expense_id)
            );
            create index receipt_refunds_receipt_idx on receipt_refunds (receipt_id);
            create index receipt_refunds_expense_idx on receipt_refunds (expense_id);

            alter table receipt_refunds enable row level security;
            alter table receipt_refunds force row level security;
            create policy tenant_isolation on receipt_refunds
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            -- What a receipt has paid back (its refund's expense not voided).
            create or replace function app.receipt_refunded(p_receipt uuid) returns bigint
            language sql stable as $$
              select coalesce(sum(rr.amount_minor), 0)::bigint
                from receipt_refunds rr
                join expenses e on e.id = rr.expense_id
               where rr.receipt_id = p_receipt and e.voided_at is null;
            $$;

            -- A refund may never pay back more than the receipt holds unspent.
            create or replace function app.ledger_refund_changed() returns trigger
            language plpgsql as $$
            declare
              v_receipt record;
              v_spent   bigint;
            begin
              select amount_minor, voided_at into v_receipt from receipts where id = new.receipt_id;
              if v_receipt.voided_at is not null then
                raise exception 'a voided receipt cannot be refunded';
              end if;
              select coalesce(sum(amount_minor), 0) + app.receipt_refunded(new.receipt_id) into v_spent
                from receipt_allocations where receipt_id = new.receipt_id;
              if v_spent > v_receipt.amount_minor then
                raise exception 'refunds and allocations exceed the receipt (% > %)', v_spent, v_receipt.amount_minor;
              end if;
              return null;
            end;
            $$;

            create trigger trg_receipt_refund_changed
              after insert or update on receipt_refunds
              for each row execute function app.ledger_refund_changed();
        SQL);

        $this->allocationGuard(withRefunds: true);
        $this->invoiceFreeze(withSettlement: true);
    }

    public function down(): void
    {
        $this->invoiceFreeze(withSettlement: false);
        $this->allocationGuard(withRefunds: false);

        DB::unprepared(<<<'SQL'
            drop trigger if exists trg_receipt_refund_changed on receipt_refunds;
            drop function if exists app.ledger_refund_changed();
            drop function if exists app.receipt_refunded(uuid);
            drop table if exists receipt_refunds;
            drop index if exists lesson_packages_settlement_idx;
            alter table lesson_packages
              drop constraint if exists lesson_packages_settled_chk,
              drop constraint if exists lesson_packages_settlement_chk,
              drop column if exists settle_expense_id,
              drop column if exists settle_note,
              drop column if exists settled_by,
              drop column if exists settled_at,
              drop column if exists settled_minor,
              drop column if exists settlement;
        SQL);
    }

    /** An allocation may never cover more than its line, nor spend more than its receipt holds — refunds counted. */
    private function allocationGuard(bool $withRefunds): void
    {
        $refunded = $withRefunds ? ' + app.receipt_refunded(new.receipt_id)' : '';

        DB::unprepared(<<<SQL
            create or replace function app.ledger_allocation_changed() returns trigger
            language plpgsql as \$\$
            declare
              v_line_amount bigint;
              v_line_sum    bigint;
              v_receipt     record;
              v_spent       bigint;
            begin
              if tg_op in ('INSERT', 'UPDATE') then
                select amount_minor into v_line_amount from invoice_line_items where id = new.invoice_line_id;
                select coalesce(sum(amount_minor), 0) into v_line_sum
                  from receipt_allocations where invoice_line_id = new.invoice_line_id;
                if v_line_sum > coalesce(v_line_amount, 0) then
                  raise exception 'allocation exceeds the invoice line (% > %)', v_line_sum, v_line_amount;
                end if;

                select amount_minor, voided_at into v_receipt from receipts where id = new.receipt_id;
                if v_receipt.voided_at is not null then
                  raise exception 'a voided receipt cannot be allocated';
                end if;
                select coalesce(sum(amount_minor), 0){$refunded} into v_spent
                  from receipt_allocations where receipt_id = new.receipt_id;
                if v_spent > v_receipt.amount_minor then
                  raise exception 'allocations exceed the receipt (% > %)', v_spent, v_receipt.amount_minor;
                end if;

                perform app.ledger_refresh_invoice(new.invoice_id);
              end if;
              if tg_op in ('DELETE', 'UPDATE') then
                perform app.ledger_refresh_invoice(old.invoice_id);
              end if;
              return null;
            end;
            \$\$;
        SQL);
    }

    /** The immutability rule — with, or without, a settlement's one bill allowed to come down. */
    private function invoiceFreeze(bool $withSettlement): void
    {
        $settling = $withSettlement
            // coalesce: on a connection that never set it, current_setting() is NULL — and a NULL here
            // would make the whole condition NULL, which plpgsql reads as false: no freeze at all.
            ? "and not (coalesce(current_setting('app.settling_invoice_id', true), '') = old.id::text
                          and new.currency = old.currency
                          and new.total_minor <= old.total_minor
                          and new.subtotal_minor <= old.subtotal_minor)"
            : '';

        DB::unprepared(<<<SQL
            create or replace function forbid_closed_invoice_mutation() returns trigger
            language plpgsql as \$\$
            begin
              -- VOID is terminal.
              if old.status = 'VOID' and new.status is distinct from old.status then
                raise exception 'closed invoice is immutable';
              end if;
              -- A closed invoice never reopens. One that was never closed (paid while its month ran)
              -- may go back to OPEN when its payment is taken back.
              if old.status <> 'OPEN' and new.status = 'OPEN' and old.closed_at is not null then
                raise exception 'closed invoice is immutable';
              end if;
              -- Financial fields are frozen the moment the invoice leaves OPEN — except a prepaid
              -- subscription's bill brought down to what was used (PackageSettlement).
              if old.status <> 'OPEN'
                 and (new.subtotal_minor <> old.subtotal_minor
                      or new.total_minor <> old.total_minor
                      or new.currency <> old.currency)
                 {$settling} then
                raise exception 'cannot modify totals of a non-open invoice';
              end if;
              return new;
            end;
            \$\$;
        SQL);
    }
};
