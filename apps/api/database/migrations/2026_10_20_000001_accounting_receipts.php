<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Accounting, phase F1 (docs/groups/01-ACCOUNTING.md) — money in gets a document of its own.
 *
 * Until now a payment was one number on the invoice (`amount_paid_minor`), overwritten by every
 * "mark paid". This adds the RECEIPT: a numbered record of money that changed hands (who paid, how
 * much, how, when, who took it), and its ALLOCATIONS: which invoice lines that money covers. A line
 * is then exactly PAID / PARTIAL / UNPAID, and what a receipt does not cover is the payer's credit.
 *
 * Only an academy with the `accounting` feature runs on receipts, and it is OPT-IN — off for every
 * client, new and existing, until a Super Admin switches it on. A row in `academy_ledgers` marks an
 * academy whose invoices are kept by its receipts; `app.ledger_refresh_invoice` does nothing for any
 * other academy, so an academy without the feature never has a byte computed for it. (Its own
 * tenant table, not a column on `academies`: that table is Super-Admin-write under RLS.)
 *
 * On such an academy the invoice keeps its billing lifecycle (OPEN while the month runs, CLOSED once
 * closed) and its payment columns become a cache of the allocations:
 *   amount_paid_minor = what the receipts cover on its lines
 *   status            = OPEN while running; once closed CLOSED / PARTIALLY_PAID / PAID by that sum
 * A running invoice stays OPEN however much is paid on it, so the rest of the month's lessons and
 * group charges still land on it — paying the 1st of the month no longer shuts the month.
 *
 * Also a fix for EVERY academy: the immutability trigger refused PARTIALLY_PAID → PAID, so a second
 * instalment could never complete an invoice (500 "closed invoice is immutable"). The status of a
 * non-open invoice may now move between the payment states; it still never leaves VOID and a
 * closed invoice still never reopens. Totals stay frozen exactly as before.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── The immutability rule, with the payment states free to move ──────────
        DB::unprepared(<<<'SQL'
            create or replace function forbid_closed_invoice_mutation() returns trigger
            language plpgsql as $$
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
              -- Financial fields are frozen the moment the invoice leaves OPEN.
              if old.status <> 'OPEN'
                 and (new.subtotal_minor <> old.subtotal_minor
                      or new.total_minor <> old.total_minor
                      or new.currency <> old.currency) then
                raise exception 'cannot modify totals of a non-open invoice';
              end if;
              return new;
            end;
            $$;
        SQL);

        DB::unprepared(<<<'SQL'
            -- Present = this academy's invoices are kept by its receipts (adopted).
            create table academy_ledgers (
              academy_id uuid primary key references academies(id),
              adopted_at timestamptz not null default now()
            );

            -- Per-academy document sequences (receipt numbers now; expense numbers later).
            create table academy_counters (
              academy_id uuid not null references academies(id),
              key        text not null,
              value      bigint not null default 0,
              primary key (academy_id, key)
            );

            create table receipts (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              number        text not null,
              guardian_id   uuid references guardians(id),
              student_id    uuid references students(id),
              payer_name    text,
              amount_minor  bigint not null,
              currency      char(3) not null,
              method        text not null,
              reference     text,
              proof_path    text,
              note          text,
              source        text not null default 'MANUAL',
              received_on   date not null,
              received_by   uuid references users(id),
              public_token  text not null unique,
              voided_at     timestamptz,
              voided_by     uuid references users(id),
              void_reason   text,
              created_at    timestamptz not null default now(),
              updated_at    timestamptz not null default now(),
              constraint receipts_amount_chk check (amount_minor > 0),
              constraint receipts_method_chk check (method in ('CASH','INSTAPAY','WALLET','BANK_TRANSFER','CARD','OTHER')),
              constraint receipts_source_chk check (source in ('MANUAL','GATEWAY','MIGRATED')),
              constraint receipts_payer_chk check (
                not (guardian_id is not null and student_id is not null)
                and (guardian_id is not null or student_id is not null or payer_name is not null)
              ),
              constraint receipts_void_chk check ((voided_at is null) = (void_reason is null))
            );
            create unique index receipts_number_uidx on receipts (academy_id, number);
            create index receipts_received_idx on receipts (academy_id, received_on desc, created_at desc);
            create index receipts_guardian_idx on receipts (guardian_id) where guardian_id is not null;
            create index receipts_student_idx on receipts (student_id) where student_id is not null;

            create table receipt_allocations (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id),
              receipt_id      uuid not null references receipts(id),
              invoice_line_id uuid not null references invoice_line_items(id) on delete cascade,
              invoice_id      uuid not null references invoices(id) on delete cascade,
              amount_minor    bigint not null,
              created_at      timestamptz not null default now(),
              constraint receipt_allocations_amount_chk check (amount_minor > 0),
              unique (receipt_id, invoice_line_id)
            );
            create index receipt_allocations_line_idx on receipt_allocations (invoice_line_id);
            create index receipt_allocations_invoice_idx on receipt_allocations (invoice_id);
            create index receipt_allocations_receipt_idx on receipt_allocations (receipt_id);
        SQL);

        foreach (['academy_ledgers', 'academy_counters', 'receipts', 'receipt_allocations'] as $table) {
            DB::unprepared(<<<SQL
                alter table {$table} enable row level security;
                alter table {$table} force row level security;
                create policy tenant_isolation on {$table}
                  using (academy_id = app.current_academy_id())
                  with check (academy_id = app.current_academy_id());
            SQL);
        }

        // ── The invoice cache, recomputed from the allocations ───────────────────
        DB::unprepared(<<<'SQL'
            create or replace function app.ledger_refresh_invoice(p_invoice uuid) returns void
            language plpgsql as $$
            declare
              v         record;
              v_paid    bigint;
              v_status  invoice_status;
              v_last    record;
            begin
              select i.id, i.academy_id, i.status, i.closed_at, i.total_minor, i.amount_paid_minor,
                     i.paid_at, i.payment_method, i.payment_reference, l.adopted_at
                into v
                from invoices i
                left join academy_ledgers l on l.academy_id = i.academy_id
               where i.id = p_invoice;

              -- Only an academy kept by its receipts; never a void invoice; never mid-purge.
              if not found or v.adopted_at is null or v.status = 'VOID'
                 or current_setting('app.purging_academy_id', true) = v.academy_id::text then
                return;
              end if;

              select coalesce(sum(amount_minor), 0) into v_paid
                from receipt_allocations where invoice_id = p_invoice;

              if v.status = 'OPEN' then
                v_status := 'OPEN';                       -- a running month is never shut by a payment
              elsif v_paid >= v.total_minor and v.total_minor > 0 then
                v_status := 'PAID';
              elsif v_paid > 0 then
                v_status := 'PARTIALLY_PAID';
              elsif v.closed_at is null then
                v_status := 'OPEN';                       -- paid while running, payment taken back
              else
                v_status := 'CLOSED';
              end if;

              -- The latest receipt that pays this invoice names its method / reference.
              select r.method, r.reference into v_last
                from receipt_allocations ra
                join receipts r on r.id = ra.receipt_id
               where ra.invoice_id = p_invoice
               order by r.received_on desc, r.created_at desc
               limit 1;

              update invoices
                 set amount_paid_minor = v_paid,
                     status            = v_status,
                     paid_at           = case when v_paid >= v.total_minor and v.total_minor > 0
                                              then coalesce(v.paid_at, now()) end,
                     payment_method    = case when v_last.method is null then v.payment_method
                                              when v_last.method = 'CASH' then 'CASH'::payment_method
                                              when v_last.method = 'BANK_TRANSFER' then 'BANK_TRANSFER'::payment_method
                                              when v_last.method = 'CARD' then 'GATEWAY'::payment_method
                                              else 'OTHER'::payment_method end,
                     payment_reference = coalesce(v_last.reference, v.payment_reference),
                     updated_at        = now()
               where id = p_invoice
                 and (amount_paid_minor is distinct from v_paid or status is distinct from v_status
                      or (v_last.method is not null and payment_method is null));
            end;
            $$;

            -- An allocation may never cover more than its line, nor spend more than its receipt.
            create or replace function app.ledger_allocation_changed() returns trigger
            language plpgsql as $$
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
                select coalesce(sum(amount_minor), 0) into v_spent
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
            $$;

            create trigger trg_receipt_allocation_changed
              after insert or update or delete on receipt_allocations
              for each row execute function app.ledger_allocation_changed();

            -- A line repriced below what is already allocated to it gives the excess back to its
            -- receipts (newest first); that money is the payer's credit until it is applied again.
            create or replace function app.ledger_line_repriced() returns trigger
            language plpgsql as $$
            declare
              v_excess bigint;
              r        record;
            begin
              select coalesce(sum(amount_minor), 0) - greatest(new.amount_minor, 0) into v_excess
                from receipt_allocations where invoice_line_id = new.id;
              if v_excess <= 0 then
                return null;
              end if;
              for r in
                select id, amount_minor from receipt_allocations
                 where invoice_line_id = new.id
                 order by created_at desc, id desc
              loop
                exit when v_excess <= 0;
                if r.amount_minor <= v_excess then
                  delete from receipt_allocations where id = r.id;
                  v_excess := v_excess - r.amount_minor;
                else
                  update receipt_allocations set amount_minor = amount_minor - v_excess where id = r.id;
                  v_excess := 0;
                end if;
              end loop;
              return null;
            end;
            $$;

            create trigger trg_invoice_line_repriced
              after update of amount_minor on invoice_line_items
              for each row when (new.amount_minor < old.amount_minor)
              execute function app.ledger_line_repriced();
        SQL);

        // ── The public receipt (the link a parent opens from WhatsApp) ───────────
        DB::unprepared(<<<'SQL'
            create or replace function app.public_receipt_by_token(token text)
            returns json
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
              v record;
            begin
              select r.*, a.name as academy_name, a.timezone as academy_tz,
                     coalesce(g.full_name, s.full_name, r.payer_name) as payer_display,
                     u.full_name as received_by_name
                into v
                from receipts r
                join academies a on a.id = r.academy_id
                left join guardians g on g.id = r.guardian_id
                left join students s on s.id = r.student_id
                left join users u on u.id = r.received_by
               where r.public_token = token
               limit 1;

              if not found then
                return null;
              end if;

              return json_build_object(
                'number',        v.number,
                'academy_name',  v.academy_name,
                'payer_name',    v.payer_display,
                'amount_minor',  v.amount_minor,
                'currency',      v.currency,
                'method',        v.method,
                'reference',     v.reference,
                'received_on',   v.received_on,
                'received_by',   v.received_by_name,
                'voided',        v.voided_at is not null,
                'allocations',   coalesce((
                  select json_agg(json_build_object(
                           'description',  li.description,
                           'student_name', st.full_name,
                           'amount_minor', ra.amount_minor
                         ) order by li.session_date nulls last, li.created_at)
                    from receipt_allocations ra
                    join invoice_line_items li on li.id = ra.invoice_line_id
                    left join students st on st.id = li.student_id
                   where ra.receipt_id = v.id
                ), '[]'::json)
              );
            end;
            $$;
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass) === 1) {
            DB::unprepared("grant select on receipts, receipt_allocations to {$bypass};");
            DB::unprepared("grant select on invoice_line_items, students, guardians, users to {$bypass};");
            DB::unprepared("alter function app.public_receipt_by_token(text) owner to {$bypass};");
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.public_receipt_by_token(text);
            drop trigger if exists trg_invoice_line_repriced on invoice_line_items;
            drop function if exists app.ledger_line_repriced();
            drop trigger if exists trg_receipt_allocation_changed on receipt_allocations;
            drop function if exists app.ledger_allocation_changed();
            drop function if exists app.ledger_refresh_invoice(uuid);
            drop table if exists receipt_allocations;
            drop table if exists receipts;
            drop table if exists academy_counters;
            drop table if exists academy_ledgers;

            create or replace function forbid_closed_invoice_mutation() returns trigger
            language plpgsql as $$
            begin
              if old.status in ('CLOSED','PAID','PARTIALLY_PAID','VOID')
                 and new.status is distinct from old.status
                 and not (old.status = 'CLOSED' and new.status in ('PAID','PARTIALLY_PAID','VOID')) then
                raise exception 'closed invoice is immutable';
              end if;
              if old.status <> 'OPEN'
                 and (new.subtotal_minor <> old.subtotal_minor
                      or new.total_minor <> old.total_minor
                      or new.currency <> old.currency) then
                raise exception 'cannot modify totals of a non-open invoice';
              end if;
              return new;
            end;
            $$;
        SQL);
    }
};
