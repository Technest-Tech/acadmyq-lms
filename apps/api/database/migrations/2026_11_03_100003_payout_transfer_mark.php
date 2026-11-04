<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * "Transferred": the office's own tick that a teacher's salary for this month went out, by InstaPay or
 * wallet, so nothing moved through the treasury and no expense records it. A note and not a payment:
 * it moves no money and leaves the statement correctable, which is why `transferred_minor` keeps what
 * was sent, so a later correction can show the difference. The seal guard only watches the money
 * columns, so a sealed statement can still take the tick.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table payouts
              add column transferred_at timestamptz,
              add column transferred_by uuid references users(id) on delete set null,
              add column transferred_minor bigint,
              add constraint payouts_transfer_pair_ck
                check ((transferred_at is null) = (transferred_minor is null));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table payouts
              drop constraint if exists payouts_transfer_pair_ck,
              drop column if exists transferred_at,
              drop column if exists transferred_by,
              drop column if exists transferred_minor;
        SQL);
    }
};
