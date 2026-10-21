<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The treasury (الخزينة, docs/groups/01-ACCOUNTING.md) — where the academy's money actually IS.
 *
 *   cash_accounts         the places money sits: the cash drawer, the InstaPay account, a wallet,
 *                         the bank. Each has an opening balance on the day it starts being kept.
 *   cash_account_methods  which account a receipt of a given method (and currency) lands in —
 *                         cash → the drawer, InstaPay → the InstaPay account, …
 *   receipts.cash_account_id  set when a receipt is recorded; an older receipt with none follows
 *                         the method mapping
 *   expense_categories / expenses   money OUT: rent, salaries, books, printing, ads, utilities … —
 *                         each from one account, numbered (E-000001), voided never deleted. A
 *                         teacher's salary paid out is an expense tied to their payout statement.
 *   cash_transfers        money moved between accounts (cash banked) — neither in nor out
 *   cash_closings         the day's count of an account: what the books say vs what was counted;
 *                         the difference (short / over) is kept and becomes part of the balance
 *
 * balance(account, day) = opening + receipts in − expenses out ± transfers + closing differences,
 * counting only movements dated on or after the account's opening day.
 *
 * Only an academy with `accounting` ever writes here.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table cash_accounts (
              id                     uuid primary key default uuid_generate_v7(),
              academy_id             uuid not null references academies(id),
              name                   text not null,
              kind                   text not null,
              currency               char(3) not null,
              opening_balance_minor  bigint not null default 0,
              opening_on             date not null,
              is_active              boolean not null default true,
              sort_order             integer not null default 0,
              created_at             timestamptz not null default now(),
              updated_at             timestamptz not null default now(),
              constraint cash_accounts_kind_chk check (kind in ('CASH','BANK','WALLET','INSTAPAY','CARD','OTHER')),
              constraint cash_accounts_name_chk check (length(trim(name)) > 0)
            );
            create index cash_accounts_academy_idx on cash_accounts (academy_id);

            create table cash_account_methods (
              academy_id      uuid not null references academies(id),
              method          text not null,
              currency        char(3) not null,
              cash_account_id uuid not null references cash_accounts(id),
              primary key (academy_id, method, currency)
            );

            alter table receipts add column cash_account_id uuid references cash_accounts(id);
            create index receipts_cash_account_idx on receipts (cash_account_id) where cash_account_id is not null;

            create table expense_categories (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              key         text,
              name        text not null,
              is_active   boolean not null default true,
              sort_order  integer not null default 0,
              created_at  timestamptz not null default now()
            );
            create unique index expense_categories_key_uidx on expense_categories (academy_id, key) where key is not null;

            create table expenses (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id),
              number           text not null,
              spent_on         date not null,
              category_id      uuid not null references expense_categories(id),
              amount_minor     bigint not null,
              currency         char(3) not null,
              cash_account_id  uuid not null references cash_accounts(id),
              payee            text,
              description      text,
              attachment_path  text,
              payout_id        uuid references payouts(id),
              created_by       uuid references users(id),
              created_at       timestamptz not null default now(),
              voided_at        timestamptz,
              voided_by        uuid references users(id),
              void_reason      text,
              constraint expenses_amount_chk check (amount_minor > 0),
              constraint expenses_void_chk check ((voided_at is null) = (void_reason is null))
            );
            create unique index expenses_number_uidx on expenses (academy_id, number);
            create index expenses_spent_idx on expenses (academy_id, spent_on desc);
            create index expenses_account_idx on expenses (cash_account_id);
            create index expenses_payout_idx on expenses (payout_id) where payout_id is not null;

            create table cash_transfers (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id),
              from_account_id  uuid not null references cash_accounts(id),
              to_account_id    uuid not null references cash_accounts(id),
              amount_minor     bigint not null,
              transferred_on   date not null,
              note             text,
              created_by       uuid references users(id),
              created_at       timestamptz not null default now(),
              voided_at        timestamptz,
              voided_by        uuid references users(id),
              void_reason      text,
              constraint cash_transfers_amount_chk check (amount_minor > 0),
              constraint cash_transfers_accounts_chk check (from_account_id <> to_account_id),
              constraint cash_transfers_void_chk check ((voided_at is null) = (void_reason is null))
            );
            create index cash_transfers_academy_idx on cash_transfers (academy_id, transferred_on desc);

            create table cash_closings (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id),
              cash_account_id   uuid not null references cash_accounts(id),
              day               date not null,
              expected_minor    bigint not null,
              counted_minor     bigint not null,
              difference_minor  bigint not null,
              note              text,
              closed_by         uuid references users(id),
              created_at        timestamptz not null default now(),
              unique (cash_account_id, day)
            );
            create index cash_closings_academy_idx on cash_closings (academy_id, day desc);
        SQL);

        foreach (['cash_accounts', 'cash_account_methods', 'expense_categories', 'expenses', 'cash_transfers', 'cash_closings'] as $table) {
            DB::unprepared(<<<SQL
                alter table {$table} enable row level security;
                alter table {$table} force row level security;
                create policy tenant_isolation on {$table}
                  using (academy_id = app.current_academy_id())
                  with check (academy_id = app.current_academy_id());
            SQL);
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists cash_closings;
            drop table if exists cash_transfers;
            drop table if exists expenses;
            drop table if exists expense_categories;
            alter table receipts drop column if exists cash_account_id;
            drop table if exists cash_account_methods;
            drop table if exists cash_accounts;
        SQL);
    }
};
