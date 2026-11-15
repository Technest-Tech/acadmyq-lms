<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two collection settings (Lingo 2026-11-15), both additive:
 *
 *   • academy_receipt_methods — which payment methods the academy takes at the desk. One row per
 *     academy; no row = every method (nothing changes for anyone who never sets it). Lingo takes
 *     bank transfer, InstaPay and wallets only, and wanted cash off the collect screen.
 *
 *   • receipts.proof_pending — a transfer recorded before the parent sent its screenshot. Proof is
 *     required for any money not in cash; until now the desk could not record such a payment at all
 *     (or typed it as cash to get past the check). Cleared when the picture is attached.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists academy_receipt_methods (
              academy_id  uuid primary key references academies(id) on delete cascade,
              methods     text[] not null,
              updated_at  timestamptz not null default now(),
              constraint academy_receipt_methods_not_empty check (cardinality(methods) > 0)
            );

            alter table academy_receipt_methods enable row level security;
            alter table academy_receipt_methods force row level security;
            drop policy if exists tenant_isolation on academy_receipt_methods;
            create policy tenant_isolation on academy_receipt_methods
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table receipts add column if not exists proof_pending boolean not null default false;

            -- OPENING: money a family already had with the academy before the system (its old credit),
            -- entered once. It pays their charges like any receipt, but it is not money in: no
            -- treasury account takes it and no "collected" figure counts it.
            alter table receipts drop constraint if exists receipts_source_chk;
            alter table receipts add constraint receipts_source_chk check (source in ('MANUAL','GATEWAY','MIGRATED','OPENING'));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            delete from receipt_allocations where receipt_id in (select id from receipts where source = 'OPENING');
            delete from receipts where source = 'OPENING';
            alter table receipts drop constraint if exists receipts_source_chk;
            alter table receipts add constraint receipts_source_chk check (source in ('MANUAL','GATEWAY','MIGRATED'));
            alter table receipts drop column if exists proof_pending;
            drop table if exists academy_receipt_methods;
        SQL);
    }
};
