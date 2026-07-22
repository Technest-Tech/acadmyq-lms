<?php

declare(strict_types=1);

use App\Jobs\AutoDeductUnreportedSessionsJob;
use App\Jobs\CloseMonthlyInvoicesJob;
use App\Jobs\CloseMonthlyPayoutsJob;
use App\Jobs\ExpireAcademyTrialsJob;
use App\Jobs\FlagOverdueReportsJob;
use App\Jobs\GenerateAcademyInvoicesJob;
use App\Jobs\LessonReminderJob;
use App\Jobs\MonthlyStudentBillingJob;
use App\Jobs\PurgeExpiredRecordingsJob;
use App\Jobs\RollSessionWindowJob;
use App\Jobs\SendAcademyBillRemindersJob;
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

/*
| Monthly payout finalize (Sprint 8). On the 3rd of each month (after the session window has
| been rolled on the 1st and invoices closed on the 2nd) finalize all OPEN teacher payouts for
| the previous calendar month across every active academy, sealing each statement immutably.
| The job sets its own per-academy tenant context and is idempotent, so re-runs are safe.
*/
Schedule::job(new CloseMonthlyPayoutsJob)->monthlyOn(3, '01:30')->name('close-monthly-payouts')->withoutOverlapping();

/*
| Hourly overdue-report sweep (Notifications "Reports" tab). For every active academy, flag
| sessions that ended ≥2h ago with no report — an in-app alert to the owner(s) plus a reminder
| to the teacher. Idempotent (unique session_id+type), so missed/duplicated runs are harmless;
| each academy's work runs in its own tenant context inside the job.
*/
Schedule::job(new FlagOverdueReportsJob)->hourly()->name('flag-overdue-reports')->withoutOverlapping();

/*
| Hourly unmarked-session deduction (Discounts & Awards page). The money half of the sweep above:
| for every academy that switched the policy ON, dock the teacher for each session still unreported
| past the academy's grace window — same predicate as the overdue flag, so the deduction only ever
| follows a warning the system was already raising. Idempotent (one AUTO_UNREPORTED adjustment per
| session, partial unique index), skips finalized statements, and runs :30 past the hour so the
| owner's alert lands before the money moves. Each academy runs in its own tenant context.
*/
Schedule::job(new AutoDeductUnreportedSessionsJob)->hourlyAt(30)->name('auto-deduct-unreported')->withoutOverlapping();

/*
| Daily free-trial expiry sweep (Platform↔Academy billing). Each morning, for every non-suspended
| academy, ensure a subscription row exists and expire any trial whose window has lapsed — pausing
| the subscription and (per config) suspending the academy until it converts. Idempotent and
| per-academy tenant-isolated, so missed/duplicated runs are harmless.
*/
Schedule::job(new ExpireAcademyTrialsJob)->dailyAt('00:15')->name('expire-academy-trials')->withoutOverlapping();

/*
| Monthly academy-bill generation (Platform↔Academy billing). On the 1st of each month, for every
| active paid subscription whose period has elapsed, issue the period's platform bill and roll the
| window forward. Idempotent (one bill per academy per period); each academy runs in its own context.
*/
Schedule::job(new GenerateAcademyInvoicesJob)->monthlyOn(1, '02:00')->name('generate-academy-invoices')->withoutOverlapping();

/*
| Daily academy-bill reminders (Platform↔Academy billing). Flips lapsed bills to OVERDUE and nudges
| the owner over WhatsApp (Wasender when a token is set, else a wa.me deep link logged for manual
| follow-up). Idempotent per bill per day via the send-log dedupe key.
*/
Schedule::job(new SendAcademyBillRemindersJob)->dailyAt('09:00')->name('academy-bill-reminders')->withoutOverlapping();

/*
| Type 1 automation — monthly student billing over WhatsApp. On the 3rd of each month (after last
| month's invoices are closed on the 2nd), for every academy with the toggle on, send last month's
| unpaid student invoices to their WhatsApp via the academy's own Wasender token (deep-link fallback
| when none). READ-ONLY over invoices; idempotent per (invoice, month).
*/
Schedule::job(new MonthlyStudentBillingJob)->monthlyOn(3, '08:00')->name('type1-student-billing')->withoutOverlapping();

/*
| Type 2 automation — lesson & trial reminders over WhatsApp. Hourly, for every academy with the
| toggle on, remind students and teachers of sessions starting within the next two hours. Idempotent
| per (session, recipient); each academy uses only its own Wasender token.
*/
Schedule::job(new LessonReminderJob)->hourly()->name('type2-lesson-reminders')->withoutOverlapping();

/*
| Daily recording-retention purge (docs/video-platform, V-REC-2). Each morning, for every active
| academy, delete COMPLETED room recordings whose retention window has lapsed so stored video does
| not grow unbounded. Idempotent and per-academy tenant-isolated, so missed/duplicated runs are safe.
*/
Schedule::job(new PurgeExpiredRecordingsJob)->dailyAt('03:30')->name('purge-expired-recordings')->withoutOverlapping();
