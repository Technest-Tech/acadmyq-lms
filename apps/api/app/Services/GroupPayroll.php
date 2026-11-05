<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Entitlement;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * What a group class pays its teacher (docs/groups §Money) — the teacher side. The one rule that
 * matters: ONE payout line per held lesson, never one per student. The line sits on the statement of
 * whoever took the lesson (a substitute included), for the lesson's month, and is re-priced or
 * removed as its sheet changes. A sealed statement is corrected in place ({@see Payroll::correcting()}),
 * like a private lesson; one paid from the treasury stays as paid: a lesson newly held goes on the
 * teacher's next open statement, and changing or undoing one already on it is refused.
 *
 * `teacher_pay_mode` on the group:
 *   null           the teacher's own rule, as for a private lesson of that length (Payroll::lessonPayMinor;
 *                  a FIXED-salary teacher earns 0 per lesson — the salary is the pay)
 *   PER_LESSON     a fixed amount per lesson
 *   PER_HOUR       an hourly rate × the lesson's length
 *   PER_STUDENT    an amount × the students who came (present + late)
 *   REVENUE_SHARE  a share (basis points) of what the group BILLED in the month, or of what it
 *                  COLLECTED where `teacher_share_basis` says so — one monthly line,
 *                  kept in step every time a group charge is raised or taken back; the lessons
 *                  themselves still show on the statement, at 0.
 *
 * Nothing here runs for an academy without `payroll`.
 */
final class GroupPayroll
{
    public function __construct(private readonly Payroll $payroll) {}

    public static function enabledFor(string $academyId): bool
    {
        return in_array('payroll', Entitlement::resolve($academyId)['capabilities'], true);
    }

    /** Make the lesson's payout line match it: priced while HELD, gone otherwise. */
    public function syncLessonPay(object $lesson): void
    {
        $group = DB::table('class_groups')->where('id', $lesson->group_id)->first();
        if ($group === null || ! self::enabledFor((string) $group->academy_id)) {
            return;
        }

        $line = DB::table('payout_line_items')->where('class_group_lesson_id', $lesson->id)->first();

        if ($lesson->status !== 'HELD') {
            if ($line !== null) {
                $this->payroll->correcting((string) $line->payout_id, fn () => $this->payroll->removeGroupLine($line));
            }

            return;
        }

        $teacher = DB::table('teachers')->where('id', $lesson->teacher_id)->first();
        if ($teacher === null) {
            return;
        }

        $came = DB::table('class_group_attendance')->where('lesson_id', $lesson->id)->whereIn('status', ClassGroups::ATTENDED_STATUSES)->count();
        $marked = DB::table('class_group_attendance')->where('lesson_id', $lesson->id)->count();
        $period = $this->periodOf((string) $group->academy_id, (string) $lesson->scheduled_at_utc);

        // Both statements a line can touch: where it is now (the lesson changed hands, or months) and
        // where it belongs. A sheet saved after the 3rd must not be refused for the month being sealed.
        $statement = $this->payroll->ensureOpenPayoutFor((string) $group->academy_id, (string) $teacher->id, $period['year'], $period['month']);
        $this->payroll->correcting($line !== null ? (string) $line->payout_id : null, fn () => $this->payroll->correcting($statement, fn () => $this->payroll->upsertGroupLine(
            (string) $group->academy_id,
            (string) $teacher->id,
            $period['year'],
            $period['month'],
            ['class_group_lesson_id' => (string) $lesson->id],
            $this->lessonAmount($group, $teacher, (int) $lesson->duration_minutes, $came),
            "{$group->name} — {$came}/{$marked}",
            $period['date'],
        )));
    }

    /**
     * What one held lesson of this group pays this teacher.
     */
    public function lessonAmount(object $group, object $teacher, int $durationMinutes, int $came): int
    {
        $rate = (int) ($group->teacher_pay_minor ?? 0);

        return match ($group->teacher_pay_mode) {
            'PER_LESSON' => $rate,
            'PER_HOUR' => (int) round($rate * $durationMinutes / 60),
            'PER_STUDENT' => $rate * $came,
            'REVENUE_SHARE' => 0,
            default => $this->teacherOwnPay($group, $teacher, $durationMinutes, $came),
        };
    }

    /**
     * No pay mode on the group: the teacher's own terms (Payroll::lessonPayMinor). A teacher paid
     * PER STUDENT earns their per-student rate for each student who came — the group's own
     * PER_STUDENT mode read through the teacher's rate — where a private lesson has one student.
     * An hourly teacher earns the hour; a fixed-salary one earns nothing per lesson, as before. A
     * centre's rule: every other academy keeps its pay exactly as it was.
     */
    private function teacherOwnPay(object $group, object $teacher, int $durationMinutes, int $came): int
    {
        $perStudent = ($teacher->pay_type ?? Payroll::PAY_HOURLY) === Payroll::PAY_PER_STUDENT
            && Entitlement::hasCapability((string) $group->academy_id, 'centre');

        return $this->payroll->lessonPayMinor($teacher, null, $durationMinutes) * ($perStudent ? $came : 1);
    }

    /**
     * Keep the group's revenue-share line for a month equal to its share of what the group billed
     * that month (or, on a group paid on COLLECTED, of what came in that month), in the teacher's
     * currency. On a group that is not on REVENUE_SHARE (any more) an open month's line is removed. A
     * finalized statement is left as it was paid.
     */
    public function syncRevenueShare(object $group, int $year, int $month): void
    {
        if (! self::enabledFor((string) $group->academy_id)) {
            return;
        }

        $monthStart = Carbon::create($year, $month, 1)->format('Y-m-d');
        $monthEnd = Carbon::create($year, $month, 1)->endOfMonth()->format('Y-m-d');
        $existing = DB::table('payout_line_items')
            ->where('class_group_id', $group->id)
            ->whereNull('class_group_lesson_id')
            ->where('group_period', $monthStart)
            ->first();

        if ($group->teacher_pay_mode !== 'REVENUE_SHARE') {
            if ($existing !== null) {
                $this->payroll->removeGroupLine($existing, quiet: true);
            }

            return;
        }

        $teacher = DB::table('teachers')->where('id', $group->teacher_id)->first();
        if ($teacher === null) {
            return;
        }

        $collected = ($group->teacher_share_basis ?? 'BILLED') === 'COLLECTED' && Ledger::keeps((string) $group->academy_id);
        $base = $collected
            ? $this->collectedIn($group, (string) $teacher->currency, $monthStart, $monthEnd)
            : (int) DB::table('invoice_line_items')
                ->where('class_group_id', $group->id)
                ->where('currency', $teacher->currency)
                ->whereBetween('group_period', [$monthStart, $monthEnd])
                ->sum('amount_minor');

        $share = (int) $group->teacher_share_bp;
        $amount = (int) round($base * $share / 10000);
        $label = Carbon::create($year, $month, 1)->locale('en')->translatedFormat('F Y');
        $percent = rtrim(rtrim(number_format($share / 100, 2, '.', ''), '0'), '.');

        $this->payroll->upsertGroupLine(
            (string) $group->academy_id,
            (string) $teacher->id,
            $year,
            $month,
            ['class_group_id' => (string) $group->id, 'group_period' => $monthStart],
            $amount,
            $collected ? "{$group->name} — {$percent}% of collected in {$label}" : "{$group->name} — {$percent}% of {$label}",
            $monthStart,
            quietWhenFinalized: true,
        );
    }

    /**
     * A payment moved: re-read the share of every group paid on what it collects. The current month
     * and the two before it are enough, and a month already finalized is left as it was paid.
     */
    public function syncCollectedShares(string $academyId): void
    {
        $groups = DB::table('class_groups')
            ->where('academy_id', $academyId)
            ->where('teacher_pay_mode', 'REVENUE_SHARE')
            ->where('teacher_share_basis', 'COLLECTED')
            ->get();
        if ($groups->isEmpty()) {
            return;
        }

        $timezone = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
        $thisMonth = Carbon::now($timezone)->startOfMonth();
        foreach ($groups as $group) {
            for ($back = 0; $back <= 2; $back++) {
                $month = $thisMonth->copy()->subMonthsNoOverflow($back);
                $this->syncRevenueShare($group, (int) $month->year, (int) $month->month);
            }
        }
    }

    /**
     * What came in on this group's lines in a month. A payment counts on the later of the day it was
     * received and the day it reached the line: a receipt dated back, or old credit spent on a new
     * charge, lands on a month still open instead of a sealed statement that could not take it.
     */
    private function collectedIn(object $group, string $currency, string $from, string $to): int
    {
        $timezone = (string) (DB::table('academies')->where('id', $group->academy_id)->value('timezone') ?: 'UTC');

        return (int) DB::table('receipt_allocations as ra')
            ->join('receipts as r', 'r.id', '=', 'ra.receipt_id')
            ->join('invoice_line_items as li', 'li.id', '=', 'ra.invoice_line_id')
            ->where('li.class_group_id', $group->id)
            ->where('li.currency', $currency)
            ->whereNull('r.voided_at')
            ->whereRaw('greatest(r.received_on, (ra.created_at at time zone ?)::date) between ? and ?', [$timezone, $from, $to])
            ->sum('ra.amount_minor');
    }

    /**
     * The payroll period a lesson belongs to — the academy-local month, as Payroll files private
     * lessons — and its local date.
     *
     * @return array{year:int, month:int, date:string}
     */
    private function periodOf(string $academyId, string $scheduledAtUtc): array
    {
        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
        $local = Carbon::parse($scheduledAtUtc)->setTimezone($tz);

        return ['year' => (int) $local->year, 'month' => (int) $local->month, 'date' => $local->format('Y-m-d')];
    }
}
