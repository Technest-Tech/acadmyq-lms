<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two things a Quran academy's desk asked for on the monthly subscription (2026-10-26):
 *
 *   lesson_minutes  How long one lesson is. The desk counts "8 lessons of 40 minutes", not
 *                   "5.33 hours", and `sessions_per_month` is an integer, so 5.33 was refused.
 *                   With a length on file `sessions_per_month` is the LESSON count; without one
 *                   (every row before this) it reads as before — N hours, i.e. N 60-minute
 *                   lessons, which is the same figure. Display only: PER_HOUR still bills each
 *                   lesson by its own duration.
 *   FREE            A student taught for nothing. Lessons, reports and the teacher's pay run as
 *                   for anyone else; no invoice is ever opened (Invoicing::onSessionBillable).
 *                   Its price is pinned at 0 so nothing can read a rate off it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table subscriptions
              add column if not exists lesson_minutes smallint;
            alter table subscriptions drop constraint if exists subscriptions_lesson_minutes_chk;
            alter table subscriptions add constraint subscriptions_lesson_minutes_chk
              check (lesson_minutes is null or lesson_minutes between 5 and 600);

            alter table subscriptions drop constraint if exists subscriptions_price_basis_chk;
            alter table subscriptions add constraint subscriptions_price_basis_chk
              check (price_basis in ('PER_SESSION','PER_MONTH','PER_HOUR','PER_PACKAGE','FREE'));
            alter table subscriptions drop constraint if exists subscriptions_free_price_chk;
            alter table subscriptions add constraint subscriptions_free_price_chk
              check (price_basis <> 'FREE' or price_minor = 0);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table subscriptions drop constraint if exists subscriptions_free_price_chk;
            update subscriptions set price_basis = 'PER_HOUR' where price_basis = 'FREE';
            alter table subscriptions drop constraint if exists subscriptions_price_basis_chk;
            alter table subscriptions add constraint subscriptions_price_basis_chk
              check (price_basis in ('PER_SESSION','PER_MONTH','PER_HOUR','PER_PACKAGE'));
            alter table subscriptions drop constraint if exists subscriptions_lesson_minutes_chk;
            alter table subscriptions drop column if exists lesson_minutes;
        SQL);
    }
};
