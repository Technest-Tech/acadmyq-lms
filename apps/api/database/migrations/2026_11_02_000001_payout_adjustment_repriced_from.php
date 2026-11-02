<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A finalized statement is paid in the real world and never changes, so re-pricing one carries the
 * difference onto the teacher's open statement as a reward or deduction. `repriced_payout_id` names
 * the statement it corrects, which is what stops a second recalculation paying the difference twice.
 * The row is otherwise an ordinary hand-made adjustment: remove it and the difference is owed again.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table payout_adjustments
              add column repriced_payout_id uuid references payouts(id) on delete set null;
            create index payout_adjustments_repriced_idx on payout_adjustments (repriced_payout_id)
              where repriced_payout_id is not null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists payout_adjustments_repriced_idx;
            alter table payout_adjustments drop column if exists repriced_payout_id;
        SQL);
    }
};
