<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Widen the automatic-invoice uniqueness to include `currency`.
 *
 * Automatic bills are always issued to the student's PARENT (guardian) in the currency of the
 * student's active subscription. A parent whose children are billed in different currencies must
 * therefore be able to hold ONE invoice per currency for the same period — cross-currency
 * aggregation is never allowed (R-INV-7). The previous index keyed on (academy, payer, period)
 * only, which capped a parent at a single invoice per month and forced mixed-currency children
 * onto separate per-student invoices. Adding `currency` to the key lets the parent own a separate
 * invoice per currency while still preventing duplicate same-currency invoices.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists invoices_payer_period_uidx;
            create unique index invoices_payer_period_uidx
              on invoices (academy_id, coalesce(guardian_id, student_id), currency, period_year, period_month)
              where kind = 'AUTO';
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists invoices_payer_period_uidx;
            create unique index invoices_payer_period_uidx
              on invoices (academy_id, coalesce(guardian_id, student_id), period_year, period_month)
              where kind = 'AUTO';
        SQL);
    }
};
