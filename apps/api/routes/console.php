<?php

declare(strict_types=1);

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
