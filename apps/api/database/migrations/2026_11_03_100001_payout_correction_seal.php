<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A sealed salary statement can be corrected in place (Alrayan, 2026-11-03: October's lessons were
 * corrected after the 3rd and the difference landed on November). The guard still refuses every other
 * write: only `Payroll::correcting` lifts the seal, for the one statement named in the
 * transaction-local `app.correcting_payout_id`. Coalesced, or a connection that never set it would
 * make the whole test NULL and skip the raise.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create or replace function forbid_finalized_payout_mutation() returns trigger
            language plpgsql as $$
            begin
              if old.finalized_at is not null then
                if coalesce(current_setting('app.correcting_payout_id', true), '') = old.id::text then
                  return new;
                end if;
                if new.finalized_at is distinct from old.finalized_at then
                  raise exception 'finalized payout is immutable';
                end if;
                if new.total_minor <> old.total_minor
                   or new.currency <> old.currency
                   or new.base_minor <> old.base_minor
                   or new.rewards_minor <> old.rewards_minor
                   or new.deductions_minor <> old.deductions_minor then
                  raise exception 'cannot modify totals of a finalized payout';
                end if;
              end if;
              return new;
            end;
            $$;
        SQL);
    }

    public function down(): void
    {
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
                   or new.base_minor <> old.base_minor
                   or new.rewards_minor <> old.rewards_minor
                   or new.deductions_minor <> old.deductions_minor then
                  raise exception 'cannot modify totals of a finalized payout';
                end if;
              end if;
              return new;
            end;
            $$;
        SQL);
    }
};
