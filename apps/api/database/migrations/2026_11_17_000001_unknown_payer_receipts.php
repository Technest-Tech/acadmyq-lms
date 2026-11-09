<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Money that arrived before anyone said whose it is (lingo, 2026-11-09): a transfer lands, the
 * parent has not sent the receipt yet. The desk records it as "unknown" (`payer_unknown`, payer
 * name only, nothing paid with it) and assigns it to the family once they write — then it pays
 * their charges like any receipt. Additive.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table receipts add column if not exists payer_unknown boolean not null default false;
            create index if not exists receipts_unknown_idx on receipts (academy_id) where payer_unknown;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists receipts_unknown_idx;
            alter table receipts drop column if exists payer_unknown;
        SQL);
    }
};
