<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 8+ — Payout adjustments: REWARDS (bonuses) and DEDUCTIONS, each with a required
 * reason and optional full details. These are owner-entered, per-statement money lines that
 * sit alongside the per-session payout lines and shift the net `total_minor`:
 *
 *     total_minor = sum(payout_line_items) + rewards_minor − deductions_minor
 *
 * Adjustments obey the SAME open/finalize immutability as session lines: they may be added or
 * removed only while the payout is OPEN; once `finalized_at` is set the statement (totals AND
 * the reward/deduction subtotals) is frozen, and adding/removing an adjustment is rejected by
 * DB triggers — the statement reflects money paid in the real world.
 *
 * The `down()` reverses everything (table, columns, RLS, triggers) and restores the previous
 * (Sprint-8) form of forbid_finalized_payout_mutation().
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // 1 – Reward / deduction subtotals on the payout statement.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table payouts
                add column if not exists rewards_minor    bigint not null default 0,
                add column if not exists deductions_minor bigint not null default 0;
        SQL);

        // ------------------------------------------------------------------
        // 2 – The adjustments ledger. One row per reward/deduction; amount is
        //     always POSITIVE and the `type` decides the sign applied to the total.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table payout_adjustments (
              id           uuid primary key default uuid_generate_v7(),
              academy_id   uuid not null references academies(id),
              payout_id    uuid not null references payouts(id) on delete cascade,
              type         text not null,
              amount_minor bigint not null,
              currency     char(3) not null,
              reason       text not null,
              details      text,
              created_by   uuid,
              created_at   timestamptz not null default now(),
              updated_at   timestamptz not null default now(),
              constraint payout_adjustments_type_chk   check (type in ('REWARD','DEDUCTION')),
              constraint payout_adjustments_amount_chk check (amount_minor > 0)
            );
            create index payout_adjustments_academy_idx on payout_adjustments (academy_id);
            create index payout_adjustments_payout_idx  on payout_adjustments (payout_id);

            create trigger trg_set_updated_at before update on payout_adjustments
              for each row execute function set_updated_at();
        SQL);

        // ------------------------------------------------------------------
        // 3 – RLS: identical standard tenant policy as every other tenant table.
        //     FORCE so the owning app role is subject to it too.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table payout_adjustments enable row level security;
            alter table payout_adjustments force row level security;
            create policy tenant_isolation on payout_adjustments
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ------------------------------------------------------------------
        // 4 – Extend finalized-payout immutability to the new subtotals.
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
                   or new.currency <> old.currency
                   or new.rewards_minor <> old.rewards_minor
                   or new.deductions_minor <> old.deductions_minor then
                  raise exception 'cannot modify totals of a finalized payout';
                end if;
              end if;
              return new;
            end;
            $$;
        SQL);

        // ------------------------------------------------------------------
        // 5 – No adjustment may be ADDED to / REMOVED from a finalized payout.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create or replace function forbid_adjustment_on_finalized_payout() returns trigger
            language plpgsql as $$
            declare f timestamptz;
            begin
              select finalized_at into f from payouts where id = new.payout_id;
              if f is not null then
                raise exception 'cannot add adjustment to finalized payout';
              end if;
              return new;
            end;
            $$;

            create trigger trg_adjustment_open_only before insert on payout_adjustments
              for each row execute function forbid_adjustment_on_finalized_payout();

            create or replace function forbid_adjustment_delete_on_finalized_payout() returns trigger
            language plpgsql as $$
            declare f timestamptz;
            begin
              select finalized_at into f from payouts where id = old.payout_id;
              if f is not null then
                raise exception 'cannot remove adjustment from finalized payout';
              end if;
              return old;
            end;
            $$;

            create trigger trg_adjustment_no_delete_finalized before delete on payout_adjustments
              for each row execute function forbid_adjustment_delete_on_finalized_payout();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop trigger if exists trg_adjustment_no_delete_finalized on payout_adjustments;
            drop function if exists forbid_adjustment_delete_on_finalized_payout();
            drop trigger if exists trg_adjustment_open_only on payout_adjustments;
            drop function if exists forbid_adjustment_on_finalized_payout();

            drop policy if exists tenant_isolation on payout_adjustments;
            drop table if exists payout_adjustments;

            alter table payouts
                drop column if exists rewards_minor,
                drop column if exists deductions_minor;
        SQL);

        // Restore the Sprint-8 (pre-adjustments) immutability function.
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
        SQL);
    }
};
