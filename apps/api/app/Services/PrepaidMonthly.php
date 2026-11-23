<?php

declare(strict_types=1);

namespace App\Services;

use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;
use App\Support\Audit;
use App\Support\StudentStatus;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Prepaid monthly billing — the academy's choice in Settings → طريقة التحصيل (asked by انا مسلم,
 * 2026-11-22; built for every academy, OFF unless an academy picks it).
 *
 * "After the lessons" (the default) is the engine as it always was: each charged lesson adds a line
 * to its month's bill. "Monthly, in advance" turns that around for a MONTHLY student (a PER_HOUR /
 * PER_MONTH / PER_SESSION subscription — never a package or a free student):
 *
 *   • From the issue day (27th by default) the NEXT month is billed in full: one FEE line, the monthly
 *     price as the student's profile reads it (lessons × the price of one lesson).
 *   • On that same bill, every lesson of the months already paid for that ended NOT charged — a
 *     cancellation or an excused absence the office chose not to charge, which is the question the
 *     office already answers when it cancels — comes off at the price of that one lesson.
 *   • Attendance adds nothing for these students in those months ({@see coversLesson()}), so a
 *     lesson is never billed twice and a five-week month costs the month.
 *
 * Each run RECONCILES instead of remembering: for every lesson of the regime it works out what the
 * bills should say about it (nothing, a deduction, or — in a month nobody paid for, e.g. a student
 * who joined mid-month — a charge) and compares that with what the bills already say. So a lesson
 * marked after the bill went out, or corrected from "not charged" to "charged", lands on the next
 * bill as a deduction or as the deduction taken back — never by changing a bill already sent.
 *
 * Teacher pay is not touched anywhere here.
 */
final class PrepaidMonthly
{
    public const MODE_AFTER = 'AFTER_LESSONS';

    public const MODE_PREPAID = 'PREPAID_MONTHLY';

    public const FEE = 'FEE';

    public const LESSON = 'LESSON';

    /** The subscriptions a "monthly student" is on. FREE never bills; PER_PACKAGE has its own clock. */
    public const BASES = ['PER_HOUR', 'PER_MONTH', 'PER_SESSION'];

    /** Why a student gets no fee this month (preview). */
    public const SKIP_NO_PRICE = 'NO_PRICE';

    public const SKIP_NO_TIMETABLE = 'NO_TIMETABLE';

    private const MONTHS_AR = [1 => 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

    public function __construct(private readonly Invoicing $invoicing) {}

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------

    /**
     * The academy's billing settings, defaults when it has no row. Read inside the tenant context.
     *
     * @return array{mode: string, issue_day: int, due_day: int, from: ?string, first_fee: ?string, whatsapp: bool}
     */
    public static function settings(string $academyId): array
    {
        // The whole row, not named columns: attendance asks this on every mark, and during a deploy the
        // new code runs minutes before its migration — a missing column then reads as the default
        // ("after the lessons") instead of failing every academy's attendance.
        $row = DB::table('academy_settings')->where('academy_id', $academyId)->first();

        return [
            'mode' => (string) ($row->billing_mode ?? self::MODE_AFTER),
            'issue_day' => (int) ($row->prepaid_issue_day ?? 27),
            'due_day' => (int) ($row->prepaid_due_day ?? 5),
            'from' => isset($row->prepaid_from) ? substr((string) $row->prepaid_from, 0, 10) : null,
            'first_fee' => isset($row->prepaid_first_fee) ? substr((string) $row->prepaid_first_fee, 0, 10) : null,
            'whatsapp' => (bool) ($row->prepaid_whatsapp ?? false),
        ];
    }

    public static function isOn(string $academyId): bool
    {
        return self::settings($academyId)['mode'] === self::MODE_PREPAID;
    }

    // -------------------------------------------------------------------------
    // The attendance side: which lessons the per-lesson engine must leave alone
    // -------------------------------------------------------------------------

    /**
     * Is this lesson paid for by a monthly fee (so attendance adds and removes no line for it)?
     *
     * While the academy bills in advance: a monthly student's lesson in any month of the regime.
     * Whatever the mode now, also a lesson whose month already carries the student's fee, or that a
     * run already put on a bill — so switching back to "after the lessons" never bills twice a month
     * that was paid in advance. Lessons before the regime are left to the engine exactly as before.
     */
    public function coversLesson(object $session): bool
    {
        $academyId = (string) $session->academy_id;
        $settings = self::settings($academyId);
        if ($settings['from'] === null) {
            return false; // never billed in advance — the common case, one cheap read
        }

        $studentId = (string) $session->student_id;
        $month = $this->lessonMonth($academyId, (string) $session->scheduled_at_utc);

        if ($month >= $settings['from'] && $this->monthlySubscription($studentId, activeOnly: false) !== null) {
            // A month collected outside the system when the academy switched (between the regime's
            // start and the first month it billed itself) — every monthly student paid it.
            if ($settings['first_fee'] !== null && $month < $settings['first_fee']) {
                return true;
            }
            // Billing in advance now: only a student the run bills a month for. One with no price to
            // bill or no timetable keeps being billed lesson by lesson, as before.
            if ($settings['mode'] === self::MODE_PREPAID && $this->billsMonthly($studentId)) {
                return true;
            }
        }

        return $this->feeMonths($studentId)->contains($month)
            || DB::table('invoice_line_items as li')
                ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
                ->where('li.prepaid_session_id', (string) $session->id)
                ->where('i.status', '<>', 'VOID')
                ->exists();
    }

    // -------------------------------------------------------------------------
    // Prices
    // -------------------------------------------------------------------------

    /**
     * Up to how far (minor units) a month worked out from an hourly or per-lesson price may sit from a
     * whole amount and still be that whole amount. The desk types an hourly rate it got by dividing
     * the agreed month ("100 for 12 half-hours" = 16.67 an hour), so the month comes back as 100.08;
     * the rounding of a rate and of each lesson can drift it by at most ~0.16 a month. A real price
     * with halves or quarters (62.50) is further than this from a whole number and is left alone.
     */
    private const WHOLE_SNAP_MINOR = 20;

    /**
     * The month's price as agreed with the family. A monthly price (PER_MONTH) is that price, exactly.
     * One worked out from an hourly or a lesson price is lessons × the price of one lesson (the way the
     * form reads it back), then put back on the whole amount it was divided from when it lands within
     * a rounding's drift of one ({@see WHOLE_SNAP_MINOR}) — a parent agreed to 100, never to 99.96.
     * Null when the subscription does not say enough to price a month, or prices it at nothing.
     */
    public static function monthlyFee(object $sub): ?int
    {
        $price = (int) $sub->price_minor;
        $perMonth = (int) ($sub->sessions_per_month ?? 0);

        if ((string) $sub->price_basis === 'PER_MONTH') {
            return $price > 0 ? $price : null;
        }

        $fee = match ((string) $sub->price_basis) {
            // Legacy rows have no lesson length: sessions_per_month was hours, i.e. 60-minute lessons.
            'PER_HOUR' => $perMonth > 0 ? $perMonth * (int) round($price * (int) ($sub->lesson_minutes ?? 60) / 60) : 0,
            'PER_SESSION' => $perMonth > 0 ? $perMonth * $price : 0,
            default => 0,
        };
        if ($fee <= 0) {
            return null;
        }

        $whole = (int) (round($fee / 100) * 100);

        return $whole > 0 && abs($fee - $whole) <= self::WHOLE_SNAP_MINOR ? $whole : $fee;
    }

    /**
     * What one lesson is worth on this subscription — the month's price divided by its lessons, the
     * way the academy works it out ("100 a month, two lessons off = 25"). Whenever the month counts
     * lessons (a monthly price, or a lesson length on the profile) it is exactly that, so a lesson is
     * worth the same whatever length it was saved with (a typo on a timetable slot must not take a
     * fortune off the bill). A legacy hourly row counted hours, so its lesson is priced by its own
     * minutes. Null when it cannot be told.
     */
    public static function lessonValue(object $sub, int $minutes): ?int
    {
        $perMonth = (int) ($sub->sessions_per_month ?? 0);
        $basis = (string) $sub->price_basis;
        $countsLessons = $basis === 'PER_MONTH' || $basis === 'PER_SESSION' || $sub->lesson_minutes !== null;

        if ($countsLessons && $perMonth > 0 && in_array($basis, self::BASES, true)) {
            $fee = self::monthlyFee($sub);
            $value = $fee !== null ? (int) round($fee / $perMonth) : 0;
        } else {
            $value = match ($basis) {
                'PER_HOUR' => (int) round((int) $sub->price_minor * $minutes / 60),
                'PER_SESSION' => (int) $sub->price_minor,
                default => 0,
            };
        }

        return $value > 0 ? $value : null;
    }

    // -------------------------------------------------------------------------
    // Issuing
    // -------------------------------------------------------------------------

    /** The month a run on `$today` bills: the next one, from the issue day on; null before it. */
    public function periodDue(string $academyId, ?CarbonImmutable $today = null): ?string
    {
        $settings = self::settings($academyId);
        if ($settings['mode'] !== self::MODE_PREPAID || $settings['first_fee'] === null) {
            return null;
        }

        $today ??= CarbonImmutable::now($this->timezone($academyId));
        if ($today->day < $settings['issue_day']) {
            return null;
        }

        $period = $today->startOfMonth()->addMonthNoOverflow()->format('Y-m-d');

        return $period >= $settings['first_fee'] ? $period : null;
    }

    /**
     * What a run for `$period` would bill, written nowhere — the Settings preview.
     *
     * @return array{period: string, students: list<array<string,mixed>>}
     */
    public function preview(string $academyId, string $period): array
    {
        $out = [];
        foreach ($this->candidateStudents() as $studentId) {
            $plan = $this->plan($academyId, $studentId, $period);
            if ($plan !== null) {
                $out[] = $plan;
            }
        }

        return ['period' => $period, 'students' => $out];
    }

    /**
     * Bill `$period` in advance for every monthly student who has not had it yet. Idempotent: a
     * student whose fee for the month is already on a live bill is skipped, so the daily job can run
     * from the issue day to the month's end and a student added on the 29th still gets the month.
     *
     * @return array{period: string, students: int, invoices: list<string>, errors: int}
     */
    public function issue(string $academyId, string $period, ?string $actorUserId = null, string $actorRole = 'SUPER_ADMIN'): array
    {
        $invoices = [];
        $students = 0;
        $errors = 0;

        foreach ($this->candidateStudents() as $studentId) {
            try {
                $invoiceId = DB::transaction(fn () => $this->issueFor($academyId, $studentId, $period, $actorUserId, $actorRole));
            } catch (\Throwable $e) {
                // One student's trouble must not stop the month for everyone else. It is logged and
                // retried by tomorrow's run (the plan is worked out again from scratch).
                report($e);
                $errors++;

                continue;
            }
            if ($invoiceId !== null) {
                $students++;
                $invoices[$invoiceId] = true;
            }
        }

        return ['period' => $period, 'students' => $students, 'invoices' => array_keys($invoices), 'errors' => $errors];
    }

    /** One student's run, inside the caller's transaction. Returns the bill written to, or null. */
    private function issueFor(string $academyId, string $studentId, string $period, ?string $actorUserId, string $actorRole): ?string
    {
        // Serialises two runs over the same student (the job and the Settings button).
        DB::table('students')->where('id', $studentId)->lockForUpdate()->first(['id']);

        $plan = $this->plan($academyId, $studentId, $period);
        if ($plan === null || $plan['lines'] === []) {
            return null;
        }

        $academy = DB::table('academies')->where('id', $academyId)->first();
        [$guardianId, $payerStudentId] = $this->invoicing->payerOf($academy, $studentId);
        $p = CarbonImmutable::parse($period);
        $invoiceId = $this->invoicing->openInvoiceFor($academy, $guardianId, $payerStudentId, (int) $p->year, (int) $p->month, (string) $plan['currency']);

        $sum = 0;
        foreach ($plan['lines'] as $line) {
            DB::table('invoice_line_items')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'invoice_id' => $invoiceId,
                'session_id' => null,
                'student_id' => $studentId,
                'description' => mb_substr((string) $line['description'], 0, 500),
                'amount_minor' => (int) $line['amount_minor'],
                'list_amount_minor' => $line['list_amount_minor'] ?? null,
                'discount_minor' => (int) ($line['discount_minor'] ?? 0),
                'discount_label' => $line['discount_label'] ?? null,
                'currency' => (string) $plan['currency'],
                'session_date' => null,
                'prepaid_charge' => (string) $line['charge'],
                'prepaid_period' => (string) $line['period'],
                'prepaid_session_id' => $line['session_id'] ?? null,
                'created_at' => now(),
            ]);
            $sum += (int) $line['amount_minor'];
        }

        DB::table('invoices')->where('id', $invoiceId)->update([
            'subtotal_minor' => DB::raw('subtotal_minor + '.(int) $sum),
            'total_minor' => DB::raw('total_minor + '.(int) $sum),
            'updated_at' => now(),
        ]);
        // The pay-by date: the due day of the month paid for. A bill that already has one keeps it.
        DB::table('invoices')->where('id', $invoiceId)->whereNull('due_on')
            ->update(['due_on' => $p->setDay(self::settings($academyId)['due_day'])->format('Y-m-d')]);

        Audit::log('invoice.prepaid_issued', 'invoice', $invoiceId, $academyId, $actorUserId, $actorRole, after: [
            'student_id' => $studentId,
            'period' => $period,
            'fee_minor' => $plan['fee_minor'],
            'deducted_minor' => $plan['deducted_minor'],
            'charged_lessons_minor' => $plan['charged_minor'],
            'total_minor' => $sum,
            'currency' => $plan['currency'],
            'lines' => count($plan['lines']),
        ]);

        app(Ledger::class)->afterLinesChanged($invoiceId);

        return $invoiceId;
    }

    /**
     * Work out a student's lines for `$period`. Null when the student is not a monthly student.
     *
     * @return array{student_id: string, full_name: string, currency: string, fee_minor: ?int, deducted_minor: int, charged_minor: int, deferred: int, skip: ?string, already: bool, total_minor: int, lines: list<array<string,mixed>>}|null
     */
    public function plan(string $academyId, string $studentId, string $period): ?array
    {
        $sub = $this->monthlySubscription($studentId, activeOnly: true);
        if ($sub === null) {
            return null;
        }

        $settings = self::settings($academyId);
        $tz = $this->timezone($academyId);
        $currency = (string) $sub->currency;
        $student = DB::table('students')->where('id', $studentId)->first(['full_name']);
        $feeMonths = $this->feeMonths($studentId);

        $fee = self::monthlyFee($sub);
        $already = $feeMonths->contains($period);
        $skip = null;
        if ($fee === null) {
            $skip = self::SKIP_NO_PRICE;
        } elseif (! $this->hasTimetable($studentId)) {
            $skip = self::SKIP_NO_TIMETABLE;
        }
        // One write per student per month, all of it on the bill that carries the month's fee: once
        // the fee is out, anything later waits for next month's bill — a bill already sent never
        // changes. A student with no fee to bill gets nothing here; attendance bills them per lesson.
        $feeDue = ! $already && $skip === null && $settings['first_fee'] !== null && $period >= $settings['first_fee'];
        if (! $feeDue) {
            return [
                'student_id' => $studentId,
                'full_name' => (string) ($student->full_name ?? ''),
                'currency' => $currency,
                'fee_minor' => null,
                'deducted_minor' => 0,
                'charged_minor' => 0,
                'deferred' => 0,
                'skip' => $skip,
                'already' => $already,
                'total_minor' => 0,
                'lines' => [],
            ];
        }

        $priced = app(PayerDiscounts::class)->apply($academyId, $studentId, PayerDiscounts::SCOPE_PRIVATE, null, (int) $fee, $period);
        $feeNet = (int) $priced['amount_minor'];
        $lines = [[
            'charge' => self::FEE,
            'period' => $period,
            'description' => 'اشتراك شهر '.$this->monthLabel($period),
            'amount_minor' => $feeNet,
            'list_amount_minor' => $priced['list_amount_minor'],
            'discount_minor' => $priced['discount_minor'],
            'discount_label' => $priced['discount_label'],
        ]];

        // Every lesson of the regime up to the end of the month before `$period`.
        $credits = [];
        $charges = [];
        if ($settings['from'] !== null && $settings['from'] < $period) {
            $lessons = DB::table('sessions as se')
                ->leftJoin('session_reports as sr', 'sr.session_id', '=', 'se.id')
                ->where('se.student_id', $studentId)
                ->where('se.scheduled_at_utc', '>=', CarbonImmutable::parse($settings['from'], $tz)->utc())
                ->where('se.scheduled_at_utc', '<', CarbonImmutable::parse($period, $tz)->utc())
                ->orderBy('se.scheduled_at_utc')
                ->get([
                    'se.id', 'se.status', 'se.bill_override', 'se.duration_minutes', 'se.scheduled_at_utc', 'se.status_reason', 'se.hidden_at',
                    DB::raw("coalesce(sr.values->>'is_free_trial', '') in ('true', '1') as is_free_trial"),
                ]);

            $recorded = $this->recorded($lessons->pluck('id')->map(fn ($v) => (string) $v)->all());

            foreach ($lessons as $lesson) {
                $month = CarbonImmutable::parse((string) $lesson->scheduled_at_utc)->setTimezone($tz)->format('Y-m-01');
                $covered = ($settings['first_fee'] !== null && $month < $settings['first_fee']) || $feeMonths->contains($month);
                $value = self::lessonValue($sub, (int) $lesson->duration_minutes);
                if ($value === null) {
                    continue;
                }

                $target = $this->target($lesson, $covered);
                $had = (int) ($recorded[(string) $lesson->id] ?? 0);
                $hadState = $had < 0 ? 'CREDIT' : ($had > 0 ? 'CHARGE' : 'NONE');
                if ($target === $hadState) {
                    continue; // the bills already say the right thing (a later price change is not re-billed)
                }

                $amount = match ($target) {
                    'CREDIT' => -$value,
                    'CHARGE' => $value,
                    default => 0,
                } - $had;
                if ($amount === 0) {
                    continue;
                }

                $localDate = CarbonImmutable::parse((string) $lesson->scheduled_at_utc)->setTimezone($tz);
                $line = [
                    'charge' => self::LESSON,
                    'period' => $month,
                    'session_id' => (string) $lesson->id,
                    'description' => $this->lessonDescription($lesson, $localDate, $target, $hadState),
                    'amount_minor' => $amount,
                    'date' => $localDate->format('Y-m-d'),
                ];
                if ($amount < 0) {
                    $credits[] = $line;
                } else {
                    $charges[] = $line;
                }
            }
        }

        // Charges always go on (a lesson nobody has paid for yet). A deduction only rides on a bill
        // that carries this month's fee, and only while the bill stays above zero: a family is never
        // sent a bill that owes THEM money. What does not fit waits for the next fee.
        $running = $feeNet + array_sum(array_column($charges, 'amount_minor'));
        $deferred = 0;
        $applied = [];
        foreach ($credits as $credit) {
            if ($running + $credit['amount_minor'] >= 0) {
                $applied[] = $credit;
                $running += $credit['amount_minor'];
            } else {
                $deferred++;
            }
        }

        $lines = [...$lines, ...$charges, ...$applied];

        return [
            'student_id' => $studentId,
            'full_name' => (string) ($student->full_name ?? ''),
            'currency' => $currency,
            'fee_minor' => $feeNet,
            'deducted_minor' => -array_sum(array_column(array_filter($applied, fn ($l) => $l['amount_minor'] < 0), 'amount_minor')),
            'charged_minor' => array_sum(array_column($charges, 'amount_minor')) + array_sum(array_column(array_filter($applied, fn ($l) => $l['amount_minor'] > 0), 'amount_minor')),
            'deferred' => $deferred,
            'skip' => $skip,
            'already' => $already,
            'total_minor' => array_sum(array_column($lines, 'amount_minor')),
            'lines' => $lines,
        ];
    }

    /**
     * What the bills should say about one lesson: NONE, CREDIT (a paid month's lesson that ended not
     * charged) or CHARGE (a lesson of a month nobody paid for, delivered or charged).
     */
    private function target(object $lesson, bool $covered): string
    {
        if ($lesson->hidden_at !== null) {
            return 'NONE'; // deleted from the timetable: it never was a lesson
        }

        $status = SessionStatus::tryFrom((string) $lesson->status);
        if ($status === null || in_array($status, [SessionStatus::Scheduled, SessionStatus::Rescheduled], true)) {
            return 'NONE'; // not happened yet / moved to another lesson
        }

        $override = $lesson->bill_override === null ? null : (bool) $lesson->bill_override;
        $charged = SessionClassifier::billableToStudent($status, $override);

        if ($covered) {
            // Inside the fee whatever happened — unless it was cancelled / missed and NOT charged.
            // Attended and free lessons never come off: the month paid for them.
            $deductible = ! $charged && ! in_array($status, [SessionStatus::Attended, SessionStatus::Free], true);

            return $deductible ? 'CREDIT' : 'NONE';
        }

        return $charged && ! (bool) ($lesson->is_free_trial ?? false) ? 'CHARGE' : 'NONE';
    }

    private function lessonDescription(object $lesson, CarbonImmutable $date, string $target, string $hadState): string
    {
        $day = $date->day.' '.self::MONTHS_AR[(int) $date->month].' '.$date->year;

        if ($target === 'CREDIT') {
            $reason = trim((string) ($lesson->status_reason ?? ''));
            if ($reason === '' || str_starts_with($reason, 'Deleted')) {
                $reason = match ((string) $lesson->status) {
                    'CANCELLED_BY_STUDENT' => 'ألغاها الطالب',
                    'CANCELLED_BY_TEACHER' => 'ألغاها المعلّم',
                    'ABSENT_EXCUSED' => 'غياب بعذر',
                    default => 'غياب',
                };
            }

            return $hadState === 'CHARGE'
                ? "خصم حصة {$day} — {$reason} (كانت محسوبة)"
                : "خصم حصة {$day} — {$reason}";
        }

        if ($target === 'CHARGE') {
            return $hadState === 'CREDIT' ? "حصة {$day} — رجعت محسوبة" : "حصة {$day}";
        }

        // NONE after a deduction or a charge: the earlier line taken back.
        return $hadState === 'CREDIT'
            ? "حصة {$day} — رجوع عن الخصم (الحصة محسوبة)"
            : "حصة {$day} — رجوع عن الحساب";
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * The student's monthly subscription, or null (package, free, none). `$activeOnly` adds the
     * student side for issuing: a current REGULAR student, never a trial or someone who left.
     */
    public function monthlySubscription(string $studentId, bool $activeOnly): ?object
    {
        if ($activeOnly) {
            $student = DB::table('students')->where('id', $studentId)->first(['status', 'deleted_at']);
            if ($student === null || $student->deleted_at !== null || (string) $student->status !== StudentStatus::REGULAR) {
                return null;
            }
        }

        $sub = DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('start_date')
            ->first();

        return $sub !== null && in_array((string) $sub->price_basis, self::BASES, true) ? $sub : null;
    }

    /** @return list<string> every current student of the academy (the context's), oldest first */
    private function candidateStudents(): array
    {
        return DB::table('students')
            ->whereNull('deleted_at')
            ->where('status', StudentStatus::REGULAR)
            ->orderBy('created_at')
            ->pluck('id')
            ->map(fn ($v) => (string) $v)
            ->all();
    }

    /** Does the run bill this student a month: a monthly price it can tell, and a live timetable. */
    public function billsMonthly(string $studentId): bool
    {
        $sub = $this->monthlySubscription($studentId, activeOnly: true);

        return $sub !== null && self::monthlyFee($sub) !== null && $this->hasTimetable($studentId);
    }

    private function hasTimetable(string $studentId): bool
    {
        return DB::table('schedules')
            ->where('student_id', $studentId)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->where('paused_by_suspension', false)
            ->exists();
    }

    /** @return Collection<int, string> months ('Y-m-01') the student's fee is on a live bill for */
    private function feeMonths(string $studentId): Collection
    {
        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->where('li.student_id', $studentId)
            ->where('li.prepaid_charge', self::FEE)
            ->where('i.status', '<>', 'VOID')
            ->distinct()
            ->pluck('li.prepaid_period')
            ->map(fn ($v) => substr((string) $v, 0, 10))
            ->values();
    }

    /**
     * What the live bills already say about each lesson: this module's own lines, plus any ordinary
     * lesson line (an advance bill raised at the desk) — both are money asked for that lesson.
     *
     * @param  list<string>  $sessionIds
     * @return array<string, int>
     */
    private function recorded(array $sessionIds): array
    {
        if ($sessionIds === []) {
            return [];
        }

        $rows = DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->where('i.status', '<>', 'VOID')
            ->where(fn ($q) => $q->whereIn('li.prepaid_session_id', $sessionIds)->orWhereIn('li.session_id', $sessionIds))
            ->selectRaw('coalesce(li.prepaid_session_id, li.session_id) as sid, sum(li.amount_minor) as amount')
            ->groupByRaw('coalesce(li.prepaid_session_id, li.session_id)')
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row->sid] = (int) $row->amount;
        }

        return $out;
    }

    private function lessonMonth(string $academyId, string $scheduledAtUtc): string
    {
        return CarbonImmutable::parse($scheduledAtUtc)->setTimezone($this->timezone($academyId))->format('Y-m-01');
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
    }

    public function monthLabel(string $period): string
    {
        $p = CarbonImmutable::parse($period);

        return self::MONTHS_AR[(int) $p->month].' '.$p->year;
    }
}
