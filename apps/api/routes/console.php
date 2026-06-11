<?php

declare(strict_types=1);

use App\Jobs\CloseMonthlyInvoicesJob;
use App\Jobs\RollSessionWindowJob;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
| Monthly session roll-forward (Sprint 5 §6, §3.8). On the 1st of each month the generator
| extends every active academy's rolling window (current month → end of next month) and
| reconciles. The job is idempotent, so a missed/duplicated run is harmless; each academy's
| work runs in its own tenant context (Tenancy::withContext) inside the job.
*/
Schedule::job(new RollSessionWindowJob)->monthlyOn(1, '00:30')->name('roll-session-window')->withoutOverlapping();

/*
| Monthly invoice close (Sprint 7). On the 2nd of each month (after the session window has
| been rolled on the 1st) close all OPEN invoices for the previous calendar month across
| every active academy. The job sets its own per-academy tenant context and is idempotent,
| so re-runs for the same period are safe.
*/
Schedule::job(new CloseMonthlyInvoicesJob)->monthlyOn(2, '01:00')->name('close-monthly-invoices')->withoutOverlapping();
