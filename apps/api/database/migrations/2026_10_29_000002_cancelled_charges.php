<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A charge the academy lets go (إلغاء المستحق, a curriculum centre, 2026-10-29). Group months and a
 * private subscription's bill are raised ahead of the lessons; a family suspended for good (or a
 * child who stops) should not owe them, yet the charge stayed on the account.
 *
 * Cancelling takes what is still unpaid off the line: `amount_minor` drops to what was already
 * paid toward it (nothing paid = zero), the bill's totals follow, and the line stays — so the
 * nightly billing never raises it again — with how much was let go, when, by whom and why. Only
 * a line on an OPEN bill, and only where the books are kept by receipts.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoice_line_items
              add column cancelled_minor bigint not null default 0,
              add column cancelled_at    timestamptz,
              add column cancelled_by    uuid references users(id),
              add column cancel_reason   text,
              add constraint invoice_line_items_cancelled_chk check (cancelled_minor >= 0 and ((cancelled_minor = 0) = (cancelled_at is null)));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoice_line_items
              drop constraint if exists invoice_line_items_cancelled_chk,
              drop column if exists cancel_reason,
              drop column if exists cancelled_by,
              drop column if exists cancelled_at,
              drop column if exists cancelled_minor;
        SQL);
    }
};
