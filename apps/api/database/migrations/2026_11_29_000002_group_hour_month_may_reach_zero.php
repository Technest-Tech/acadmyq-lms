<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * An hours month may come down to no hours at all (Lingo 2026-11-22). A student taken out of an hours
 * group before any lesson of their newest month gives the whole month back (GroupLeaveSettlement): the
 * line stays, as the record that it was raised and given back, with 0 minutes and 0 owed. The check
 * from 2026_10_21_000005 asked for at least one minute, so that removal failed with a server error.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoice_line_items
              drop constraint if exists invoice_line_items_group_cycle_chk,
              add constraint invoice_line_items_group_cycle_chk check (
                (group_cycle is null) = (group_minutes is null)
                and (group_cycle is null or (group_charge = 'MONTHLY' and group_cycle >= 1 and group_minutes >= 0))
              );
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoice_line_items
              drop constraint if exists invoice_line_items_group_cycle_chk,
              add constraint invoice_line_items_group_cycle_chk check (
                (group_cycle is null) = (group_minutes is null)
                and (group_cycle is null or (group_charge = 'MONTHLY' and group_cycle >= 1 and group_minutes > 0))
              ) not valid;
        SQL);
    }
};
