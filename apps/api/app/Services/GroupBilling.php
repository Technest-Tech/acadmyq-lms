<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Entitlement;
use App\Support\StudentStatus;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What group-class members pay (docs/groups §Money) — the student side. Every charge is a
 * session-less line on the payer's ordinary AUTO invoice ({@see Invoicing::addGroupLine}), keyed by
 * its group links so it can never be raised twice. Three modes, set per group:
 *
 *   MONTHLY     up front: one line per member per month the membership touches. The month a member
 *               JOINS is pro-rated by lessons (`prorate_join`): 3 of the month's 8 lessons left ⇒
 *               3/8 of the price. Leaving mid-month refunds nothing — it was paid up front.
 *   PER_LESSON  one line per member per HELD lesson they came to; an unexcused absence is charged
 *               only when the group says so (`charge_absent`); an excused one never.
 *   COURSE      one line per enrolment, for the whole level.
 *
 * A member's own `price_minor` beats the group's. A group with no price bills nothing. Trial
 * students are never billed (as Invoicing). None of this runs for an academy without `invoicing`.
 * Prices are snapshots: changing one never rewrites a line already raised.
 *
 * Runs inside the caller's tenant transaction.
 */
final class GroupBilling
{
    public const MONTHLY = 'MONTHLY';

    public const PER_LESSON = 'PER_LESSON';

    public const COURSE = 'COURSE';

    /** The furthest back a back-dated join is billed, in months. */
    private const MAX_BACKFILL_MONTHS = 12;

    public function __construct(
        private readonly Invoicing $invoicing,
        private readonly GroupPayroll $payroll,
    ) {}

    public static function enabledFor(string $academyId): bool
    {
        return in_array('invoicing', Entitlement::resolve($academyId)['capabilities'], true);
    }

    /** Is this group set up to bill at all? */
    public static function priced(object $group): bool
    {
        return $group->price_minor !== null && $group->currency !== null;
    }

    // ── MONTHLY ──────────────────────────────────────────────────────────────

    /**
     * Raise this month's line for every member the month touches (or only `$studentIds`). Idempotent:
     * the nightly job calls it every day and only a new member or a new month adds anything.
     * `$skipBilledInGroup`: a member moved here from that group already paid this month there.
     *
     * @param  list<string>|null  $studentIds
     * @return int lines added
     */
    public function billMonth(object $group, int $year, int $month, ?array $studentIds = null, ?string $skipBilledInGroup = null): int
    {
        if ($group->billing_mode !== self::MONTHLY || ! self::priced($group) || ! self::enabledFor((string) $group->academy_id)) {
            return 0;
        }

        $monthStart = Carbon::create($year, $month, 1)->format('Y-m-d');
        $monthEnd = Carbon::create($year, $month, 1)->endOfMonth()->format('Y-m-d');

        // Only months the group itself runs in.
        $groupStart = Carbon::parse($group->start_date)->format('Y-m-d');
        $groupEnd = $group->end_date !== null ? Carbon::parse($group->end_date)->format('Y-m-d') : null;
        if ($groupStart > $monthEnd || ($groupEnd !== null && $groupEnd < $monthStart)) {
            return 0;
        }

        // The month's lessons are the pro-rating unit; a month with none bills nothing (yet).
        $lessonDates = DB::table('class_group_lessons')
            ->where('group_id', $group->id)
            ->where('status', '!=', 'CANCELLED')
            ->whereBetween('occurrence_local_date', [$monthStart, $monthEnd])
            ->pluck('occurrence_local_date')
            ->map(fn ($d) => Carbon::parse($d)->format('Y-m-d'))
            ->all();
        if ($lessonDates === []) {
            return 0;
        }

        $members = $this->billableMembers($group, $studentIds)
            ->filter(fn ($m) => Carbon::parse($m->joined_on)->format('Y-m-d') <= $monthEnd
                && ($m->left_on === null || Carbon::parse($m->left_on)->format('Y-m-d') > $monthStart));

        $added = 0;
        $label = Carbon::create($year, $month, 1)->locale('en')->translatedFormat('F Y');

        foreach ($members as $m) {
            if ($skipBilledInGroup !== null && $this->hasMonthlyLine($skipBilledInGroup, (string) $m->student_id, $monthStart)) {
                continue;
            }

            $price = $m->price_minor !== null ? (int) $m->price_minor : (int) $group->price_minor;
            $joined = Carbon::parse($m->joined_on)->format('Y-m-d');
            $description = "{$group->name} — {$label}";

            if ($group->prorate_join && $joined > $monthStart && $joined > $groupStart) {
                $remaining = count(array_filter($lessonDates, fn ($d) => $d >= $joined));
                $total = count($lessonDates);
                if ($remaining < $total) {
                    $price = (int) round($price * $remaining / $total);
                    $description .= " ({$remaining}/{$total})";
                }
            }

            $lineId = $this->invoicing->addGroupLine((string) $group->academy_id, (string) $m->student_id, (string) $group->currency, $year, $month, [
                'class_group_id' => (string) $group->id,
                'group_charge' => self::MONTHLY,
                'group_period' => $monthStart,
                'description' => $description,
                'amount_minor' => $price,
                'session_date' => $monthStart,
            ]);
            if ($lineId !== null) {
                $added++;
            }
        }

        if ($added > 0) {
            $this->payroll->syncRevenueShare($group, $year, $month);
        }

        return $added;
    }

    // ── COURSE ───────────────────────────────────────────────────────────────

    /**
     * Raise the course fee for each open membership that has none for its enrolment date.
     *
     * @param  list<string>|null  $studentIds
     */
    public function billCourse(object $group, ?array $studentIds = null): int
    {
        if ($group->billing_mode !== self::COURSE || ! self::priced($group) || ! self::enabledFor((string) $group->academy_id)) {
            return 0;
        }

        $added = 0;
        $months = [];
        foreach ($this->billableMembers($group, $studentIds)->where('status', 'ACTIVE') as $m) {
            $joined = Carbon::parse($m->joined_on);
            $lineId = $this->invoicing->addGroupLine((string) $group->academy_id, (string) $m->student_id, (string) $group->currency, (int) $joined->year, (int) $joined->month, [
                'class_group_id' => (string) $group->id,
                'group_charge' => self::COURSE,
                'group_period' => $joined->format('Y-m-d'),
                'description' => "{$group->name} — course fee",
                'amount_minor' => $m->price_minor !== null ? (int) $m->price_minor : (int) $group->price_minor,
                'session_date' => $joined->format('Y-m-d'),
            ]);
            if ($lineId !== null) {
                $added++;
                $months[$joined->format('Y-m')] = [(int) $joined->year, (int) $joined->month];
            }
        }

        foreach ($months as [$y, $mo]) {
            $this->payroll->syncRevenueShare($group, $y, $mo);
        }

        return $added;
    }

    // ── PER_LESSON ───────────────────────────────────────────────────────────

    /**
     * Bring a lesson's charges in line with its sheet: a line for everyone who came (and for the
     * unexcused absent when the group charges them), none for anyone else. A lesson that is no
     * longer HELD (reverted) loses its lines — refused once their invoice has closed, which rolls
     * the whole sheet change back, exactly as un-billing a private lesson is refused.
     *
     * A group that has since moved off PER_LESSON leaves a held lesson's old lines alone.
     */
    public function syncLessonCharges(object $lesson): void
    {
        $group = DB::table('class_groups')->where('id', $lesson->group_id)->first();
        if ($group === null) {
            return;
        }

        $existing = DB::table('invoice_line_items')->where('class_group_lesson_id', $lesson->id)->get()->keyBy(fn ($l) => (string) $l->student_id);

        $perLesson = $group->billing_mode === self::PER_LESSON && self::priced($group) && self::enabledFor((string) $group->academy_id);
        if ($lesson->status === 'HELD' && ! $perLesson) {
            return;
        }

        $wanted = [];
        if ($lesson->status === 'HELD') {
            $billable = $group->charge_absent ? ['PRESENT', 'LATE', 'ABSENT'] : ['PRESENT', 'LATE'];
            $rows = DB::table('class_group_attendance as a')
                ->join('students as st', 'st.id', '=', 'a.student_id')
                ->leftJoin('class_group_members as m', function ($j) use ($lesson): void {
                    $j->on('m.student_id', '=', 'a.student_id')->where('m.group_id', '=', $lesson->group_id);
                })
                ->where('a.lesson_id', $lesson->id)
                ->whereIn('a.status', $billable)
                ->whereNotIn('st.status', [StudentStatus::TRIAL, StudentStatus::TRIAL_BOOKED])
                ->orderByDesc('m.joined_on')
                ->get(['a.student_id', 'm.price_minor']);
            foreach ($rows as $r) {
                // Several memberships (left and rejoined): the latest one's price stands.
                $wanted[(string) $r->student_id] ??= $r->price_minor !== null ? (int) $r->price_minor : (int) $group->price_minor;
            }
        }

        $touched = false;
        foreach ($existing as $studentId => $line) {
            if (! array_key_exists($studentId, $wanted)) {
                $this->invoicing->removeGroupLine($line);
                $touched = true;
            }
        }

        $date = Carbon::parse($lesson->occurrence_local_date);
        foreach ($wanted as $studentId => $amount) {
            if ($existing->has($studentId)) {
                continue; // a snapshot: an existing charge keeps its price
            }
            $this->invoicing->addGroupLine((string) $group->academy_id, $studentId, (string) $group->currency, (int) $date->year, (int) $date->month, [
                'class_group_id' => (string) $group->id,
                'class_group_lesson_id' => (string) $lesson->id,
                'group_charge' => 'LESSON',
                'group_period' => $date->format('Y-m-d'),
                'description' => "{$group->name} — lesson {$date->format('Y-m-d')}",
                'amount_minor' => $amount,
                'session_date' => $date->format('Y-m-d'),
            ]);
            $touched = true;
        }

        if ($touched) {
            $this->payroll->syncRevenueShare($group, (int) $date->year, (int) $date->month);
        }
    }

    // ── Entry points the rest of the module calls ────────────────────────────

    /**
     * New members: MONTHLY bills every month from the one they joined in up to this one (a
     * back-dated join owes the months it covers); COURSE raises the fee. PER_LESSON waits for sheets.
     *
     * @param  list<string>  $studentIds
     */
    public function onMembersAdded(object $group, array $studentIds, ?string $movedFromGroup = null): void
    {
        if ($group->billing_mode === self::COURSE) {
            $this->billCourse($group, $studentIds);

            return;
        }

        if ($group->billing_mode !== self::MONTHLY) {
            return;
        }

        $earliest = DB::table('class_group_members')
            ->where('group_id', $group->id)->where('status', 'ACTIVE')
            ->whereIn('student_id', $studentIds)
            ->min('joined_on');
        if ($earliest === null) {
            return;
        }

        foreach ($this->monthsSince((string) $earliest, (string) $group->timezone) as [$y, $m]) {
            $this->billMonth($group, $y, $m, $studentIds, $movedFromGroup);
        }
    }

    /** The price or the mode changed: bill what is now owed and has not been billed (never rewrite). */
    public function onPricingChanged(object $group): void
    {
        if ($group->billing_mode === self::COURSE) {
            $this->billCourse($group);

            return;
        }

        if ($group->billing_mode === self::MONTHLY) {
            $today = Carbon::now($group->timezone);
            $this->billMonth($group, (int) $today->year, (int) $today->month);
        }
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * The group's memberships whose student can be billed: not removed, not a trial.
     *
     * @param  list<string>|null  $studentIds
     * @return Collection<int, object>
     */
    private function billableMembers(object $group, ?array $studentIds)
    {
        return DB::table('class_group_members as m')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->where('m.group_id', $group->id)
            ->whereNull('st.deleted_at')
            ->whereNotIn('st.status', [StudentStatus::TRIAL, StudentStatus::TRIAL_BOOKED])
            ->when($studentIds !== null, fn ($q) => $q->whereIn('m.student_id', $studentIds))
            ->orderBy('m.joined_on')
            ->get(['m.student_id', 'm.joined_on', 'm.left_on', 'm.status', 'm.price_minor']);
    }

    private function hasMonthlyLine(string $groupId, string $studentId, string $monthStart): bool
    {
        return DB::table('invoice_line_items')
            ->where('class_group_id', $groupId)
            ->where('student_id', $studentId)
            ->where('group_charge', self::MONTHLY)
            ->where('group_period', $monthStart)
            ->exists();
    }

    /**
     * Every [year, month] from `$from`'s month through this month, at most MAX_BACKFILL_MONTHS.
     *
     * @return list<array{0:int, 1:int}>
     */
    private function monthsSince(string $from, string $timezone): array
    {
        // Calendar months, compared as plain year/month numbers: mixing a UTC date with a Cairo
        // "now" put the 1st of the month after midnight in one and before it in the other.
        $from = Carbon::parse($from);
        $now = Carbon::now($timezone);
        $index = fn (int $y, int $m): int => $y * 12 + ($m - 1);

        $last = $index((int) $now->year, (int) $now->month);
        $first = max($index((int) $from->year, (int) $from->month), $last - (self::MAX_BACKFILL_MONTHS - 1));

        $out = [];
        for ($i = $first; $i <= $last; $i++) {
            $out[] = [intdiv($i, 12), $i % 12 + 1];
        }

        return $out;
    }
}
