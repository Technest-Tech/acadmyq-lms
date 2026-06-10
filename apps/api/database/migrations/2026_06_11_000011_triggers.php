<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Cross-cutting triggers (§7.5, §7.7):
 *   - set_updated_at(): maintain updated_at on every table that has the column.
 *   - closed-invoice immutability (R-INV-3): a CLOSED/PAID/… invoice may not be edited,
 *     except the one allowed move CLOSED → PAID/PARTIALLY_PAID/VOID; totals are frozen
 *     once the invoice leaves OPEN.
 *   - no line items may be added to a non-OPEN invoice.
 */
return new class extends Migration
{
    public function up(): void
    {
        // --- updated_at maintenance, attached to every table that has the column ---
        DB::unprepared(<<<'SQL'
            create or replace function set_updated_at() returns trigger
            language plpgsql as $$
            begin
              new.updated_at = now();
              return new;
            end;
            $$;

            do $$
            declare r record;
            begin
              for r in
                select table_name from information_schema.columns
                where table_schema = 'public' and column_name = 'updated_at'
              loop
                execute format('drop trigger if exists trg_set_updated_at on %I', r.table_name);
                execute format(
                  'create trigger trg_set_updated_at before update on %I '
                  'for each row execute function set_updated_at()', r.table_name);
              end loop;
            end $$;
        SQL);

        // --- closed-invoice immutability (R-INV-3) ---------------------------
        DB::unprepared(<<<'SQL'
            create or replace function forbid_closed_invoice_mutation() returns trigger
            language plpgsql as $$
            begin
              -- Once non-OPEN, the only permitted status move is CLOSED → PAID/PARTIALLY_PAID/VOID.
              if old.status in ('CLOSED','PAID','PARTIALLY_PAID','VOID')
                 and new.status is distinct from old.status
                 and not (old.status = 'CLOSED' and new.status in ('PAID','PARTIALLY_PAID','VOID')) then
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

            create trigger trg_invoice_immutable before update on invoices
              for each row execute function forbid_closed_invoice_mutation();
        SQL);

        // --- line items only on OPEN invoices --------------------------------
        DB::unprepared(<<<'SQL'
            create or replace function forbid_line_on_closed_invoice() returns trigger
            language plpgsql as $$
            declare s invoice_status;
            begin
              select status into s from invoices where id = new.invoice_id;
              if s is distinct from 'OPEN' then
                raise exception 'cannot add line item to non-open invoice';
              end if;
              return new;
            end;
            $$;

            create trigger trg_line_open_only before insert on invoice_line_items
              for each row execute function forbid_line_on_closed_invoice();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop trigger if exists trg_line_open_only on invoice_line_items;
            drop function if exists forbid_line_on_closed_invoice();
            drop trigger if exists trg_invoice_immutable on invoices;
            drop function if exists forbid_closed_invoice_mutation();

            do $$
            declare r record;
            begin
              for r in
                select table_name from information_schema.columns
                where table_schema = 'public' and column_name = 'updated_at'
              loop
                execute format('drop trigger if exists trg_set_updated_at on %I', r.table_name);
              end loop;
            end $$;
            drop function if exists set_updated_at();
        SQL);
    }
};
