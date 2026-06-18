<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 8 — Payroll engine additions (parallel to Sprint 7's invoicing_engine).
 *
 * 1. payout_line_items : session_date (denormalised snapshot for statement ordering/display)
 * 2. payouts           : notes (optional owner annotation on a statement)
 * 3. Finalize-immutability triggers (parallel to the closed-invoice triggers, §7.5):
 *    - once a payout's `finalized_at` is set it is immutable — totals/currency are frozen
 *      and `finalized_at` can never be cleared (a finalized statement is paid in the real
 *      world; R-PAY immutability, AC-8.6).
 *    - no line item may be added to OR removed from a finalized payout (AC-8.5/8.6, TC-8.9–8.11).
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // 1 & 2 – Column additions
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table payout_line_items
                add column if not exists session_date date null;

            alter table payouts
                add column if not exists notes text null;
        SQL);

        // ------------------------------------------------------------------
        // 3a – Finalized-payout immutability (R-PAY): totals/currency frozen and
        //      finalized_at can never be unset once it is set.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create or replace function forbid_finalized_payout_mutation() returns trigger
            language plpgsql as $$
            begin
              if old.finalized_at is not null then
                if new.finalized_at is distinct from old.finalized_at then
                  raise exception 'finalized payout is immutable';
                end if;
                if new.total_minor <> old.total_minor
                   or new.currency <> old.currency then
                  raise exception 'cannot modify totals of a finalized payout';
                end if;
              end if;
              return new;
            end;
            $$;

            create trigger trg_payout_immutable before update on payouts
              for each row execute function forbid_finalized_payout_mutation();
        SQL);

        // ------------------------------------------------------------------
        // 3b – No line item may be ADDED to a finalized payout.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create or replace function forbid_line_on_finalized_payout() returns trigger
            language plpgsql as $$
            declare f timestamptz;
            begin
              select finalized_at into f from payouts where id = new.payout_id;
              if f is not null then
                raise exception 'cannot add line item to finalized payout';
              end if;
              return new;
            end;
            $$;

            create trigger trg_payout_line_open_only before insert on payout_line_items
              for each row execute function forbid_line_on_finalized_payout();
        SQL);

        // ------------------------------------------------------------------
        // 3c – No line item may be REMOVED from a finalized payout (reversal-after-finalize).
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create or replace function forbid_line_delete_on_finalized_payout() returns trigger
            language plpgsql as $$
            declare f timestamptz;
            begin
              select finalized_at into f from payouts where id = old.payout_id;
              if f is not null then
                raise exception 'cannot remove line item from finalized payout';
              end if;
              return old;
            end;
            $$;

            create trigger trg_payout_line_no_delete_finalized before delete on payout_line_items
              for each row execute function forbid_line_delete_on_finalized_payout();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop trigger if exists trg_payout_line_no_delete_finalized on payout_line_items;
            drop function if exists forbid_line_delete_on_finalized_payout();

            drop trigger if exists trg_payout_line_open_only on payout_line_items;
            drop function if exists forbid_line_on_finalized_payout();

            drop trigger if exists trg_payout_immutable on payouts;
            drop function if exists forbid_finalized_payout_mutation();

            alter table payout_line_items
                drop column if exists session_date;

            alter table payouts
                drop column if exists notes;
        SQL);
    }
};
