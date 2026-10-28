<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A balance adjustment (تسوية رصيد, docs/groups/01-ACCOUNTING.md "One account, its own page"): the
 * desk enters what an account actually holds, and the difference from the books is recorded with a
 * reason — like a day's count, but the day stays open. Voided, never deleted.
 *
 * balance(account, day) gains + every live adjustment dated on or before it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table cash_adjustments (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id),
              cash_account_id  uuid not null references cash_accounts(id),
              adjusted_on      date not null,
              expected_minor   bigint not null,
              actual_minor     bigint not null,
              amount_minor     bigint not null,
              reason           text not null,
              created_by       uuid references users(id),
              created_at       timestamptz not null default now(),
              voided_at        timestamptz,
              voided_by        uuid references users(id),
              void_reason      text,
              constraint cash_adjustments_amount_chk check (amount_minor <> 0 and amount_minor = actual_minor - expected_minor),
              constraint cash_adjustments_void_chk check ((voided_at is null) = (void_reason is null))
            );
            create index cash_adjustments_account_idx on cash_adjustments (cash_account_id, adjusted_on);

            alter table cash_adjustments enable row level security;
            alter table cash_adjustments force row level security;
            create policy tenant_isolation on cash_adjustments
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('drop table if exists cash_adjustments;');
    }
};
