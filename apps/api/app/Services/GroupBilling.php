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
 *               With `month_minutes` set the month is HOURS, not the calendar: each fee buys that
 *               many hours of the group's lessons, and the next is raised when they are used
 *               ({@see billHourMonths}).
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

    /** The most hour-months one run raises for one member — a guard, never reached in practice. */
    private const MAX_HOUR_MONTHS_PER_RUN = 24;

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

    /** Does this MONTHLY group sell its month as hours rather than as the calendar month? */
    public static function byHours(object $group): bool
    {
        return $group->billing_mode === self::MONTHLY && ($group->month_minutes ?? null) !== null;
    }

    /**
     * An existing monthly group switching between calendar months and hours: the date the new rule
     * bills from — the 1st of next month, so the month already paid under the old rule is never paid
     * twice. Null when nothing switches, or nothing was billed yet (then the new rule just starts).
     *
     * @param  array<string,mixed>  $changes
     */
    public function ruleSwitchDate(object $current, array $changes): ?string
    {
        $after = (object) array_merge((array) $current, $changes);
        if ($current->billing_mode !== self::MONTHLY || $after->billing_mode !== self::MONTHLY
            || self::byHours($current) === self::byHours($after)) {
            return null;
        }

        $billed = DB::table('invoice_line_items')
            ->where('class_group_id', $current->id)
            ->where('group_charge', self::MONTHLY)
            ->exists();

        return $billed ? Carbon::now((string) $current->timezone)->startOfMonth()->addMonth()->format('Y-m-d') : null;
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
        if ($group->billing_mode !== self::MONTHLY || self::byHours($group) || ! self::priced($group) || ! self::enabledFor((string) $group->academy_id)) {
            return 0;
        }

        $monthStart = Carbon::create($year, $month, 1)->format('Y-m-d');
        $monthEnd = Carbon::create($year, $month, 1)->endOfMonth()->format('Y-m-d');

        // Switched back from hours: the hours already sold run until the new rule's first month.
        if (($group->billing_rule_from ?? null) !== null && $monthStart < Carbon::parse($group->billing_rule_from)->format('Y-m-d')) {
            return 0;
        }

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

    // ── MONTHLY by hours ─────────────────────────────────────────────────────

    /**
     * Raise every hour-month a member now owes (or only `$studentIds`'). A member's months are
     * counted in the group's hours: the first is owed when they start, and each next one once the
     * group has held as many minutes as the months already bought (plus any minutes they carried in
     * from another group). Up front — so the next month is raised by the lesson that uses the last
     * of the previous one, as long as another lesson is still to come for them; a member already
     * past what they bought (a back-dated join, sheets saved late) owes it either way. Every held
     * lesson inside a member's dates counts, absent or not: the class happened.
     *
     * Idempotent: the sheet, the nightly job and every price edit call it, and only newly used hours
     * add anything. A month once raised is never taken back — it was paid up front, like a calendar
     * month. Each line keeps the minutes it bought, so changing the hours later changes only the
     * months sold after it.
     *
     * @param  list<string>|null  $studentIds
     * @return int lines added
     */
    public function billHourMonths(object $group, ?array $studentIds = null): int
    {
        if (! self::byHours($group) || ! self::priced($group) || ! self::enabledFor((string) $group->academy_id)) {
            return 0;
        }

        $today = Carbon::now((string) $group->timezone)->format('Y-m-d');
        $from = $this->ruleFrom($group);
        if ($from !== null && $from > $today) {
            return 0; // switched over: the month already paid under the old rule runs out first
        }

        $members = $this->billableMembers($group, $studentIds)->groupBy(fn ($m) => (string) $m->student_id);
        if ($members->isEmpty()) {
            return 0;
        }

        $lessons = $this->countedLessons($group);
        $bought = $this->boughtHourMonths((string) $group->id, $members->keys()->all());
        $minutes = (int) $group->month_minutes;
        $hours = self::hoursText($minutes);

        $added = 0;
        $months = [];
        foreach ($members as $studentId => $rows) {
            $state = $this->hourState($rows, $lessons, $bought[$studentId] ?? null, $from);
            $latest = $rows->sortByDesc(fn ($m) => Carbon::parse($m->joined_on)->format('Y-m-d'))->first();
            $price = $latest->price_minor !== null ? (int) $latest->price_minor : (int) $group->price_minor;
            $paid = $state['bought_minutes'];
            $cycle = $state['months'];

            for ($i = 0; $i < self::MAX_HOUR_MONTHS_PER_RUN; $i++) {
                if (! ($state['used_minutes'] > $paid || ($state['used_minutes'] >= $paid && $state['to_come']))) {
                    break;
                }

                // Dated by the lesson that used up what was bought (the member's start, for the
                // first) — never later than today, so no bill lands in a month not yet begun.
                $on = min($today, $this->dateMinutesReached($state['held'], $paid) ?? $state['start']);
                $date = Carbon::parse($on);
                $cycle++;

                $lineId = $this->invoicing->addGroupLine((string) $group->academy_id, (string) $studentId, (string) $group->currency, (int) $date->year, (int) $date->month, [
                    'class_group_id' => (string) $group->id,
                    'group_charge' => self::MONTHLY,
                    'group_period' => $on,
                    'group_cycle' => $cycle,
                    'group_minutes' => $minutes,
                    'description' => "{$group->name} — month {$cycle} ({$hours} h)",
                    'amount_minor' => $price,
                    'session_date' => $on,
                ]);
                if ($lineId === null) {
                    break; // already raised, or nowhere open to put it — the next run tries again
                }

                $added++;
                $paid += $minutes;
                $months[$date->format('Y-m')] = [(int) $date->year, (int) $date->month];
            }
        }

        foreach ($months as [$y, $mo]) {
            $this->payroll->syncRevenueShare($group, $y, $mo);
        }

        return $added;
    }

    /**
     * Where every member of an hours group stands: how many months they have bought, and how many of
     * the minutes those bought they have used. Keyed by student id; empty for a calendar group.
     *
     * @return array<string, array{months:int, bought_minutes:int, used_minutes:int}>
     */
    public function hourMonthBalances(object $group): array
    {
        if (! self::byHours($group)) {
            return [];
        }

        $members = $this->billableMembers($group, null)->groupBy(fn ($m) => (string) $m->student_id);
        if ($members->isEmpty()) {
            return [];
        }

        $lessons = $this->countedLessons($group);
        $bought = $this->boughtHourMonths((string) $group->id, $members->keys()->all());
        $from = $this->ruleFrom($group);

        $out = [];
        foreach ($members as $studentId => $rows) {
            $state = $this->hourState($rows, $lessons, $bought[$studentId] ?? null, $from);
            $out[(string) $studentId] = [
                'months' => $state['months'],
                'bought_minutes' => $state['bought_minutes'],
                'used_minutes' => $state['used_minutes'],
            ];
        }

        return $out;
    }

    /**
     * A member moved here from another hours group with part of their month unused takes those
     * minutes with them: they count as bought here, and as gone there (so rejoining the old group
     * does not hand them out twice).
     */
    private function carryHours(string $fromGroupId, object $to, string $studentId): void
    {
        $from = DB::table('class_groups')->where('id', $fromGroupId)->first();
        if ($from === null || ! self::byHours($from)) {
            return;
        }

        $balance = $this->hourMonthBalances($from)[$studentId] ?? null;
        $left = $balance !== null ? $balance['bought_minutes'] - $balance['used_minutes'] : 0;
        if ($left <= 0) {
            return;
        }

        $out = DB::table('class_group_members')
            ->where('group_id', $from->id)->where('student_id', $studentId)
            ->orderByDesc('joined_on')->orderByDesc('created_at')
            ->value('id');
        $in = DB::table('class_group_members')
            ->where('group_id', $to->id)->where('student_id', $studentId)->where('status', 'ACTIVE')
            ->value('id');
        if ($out === null || $in === null) {
            return;
        }

        DB::table('class_group_members')->where('id', $out)->update(['carried_minutes' => DB::raw("carried_minutes - {$left}"), 'updated_at' => now()]);
        DB::table('class_group_members')->where('id', $in)->update(['carried_minutes' => DB::raw("carried_minutes + {$left}"), 'updated_at' => now()]);
    }

    /**
     * One member's hours: what they bought (months raised + minutes carried in or out), what the
     * group has held inside their dates, whether a lesson is still to come for them, and the held
     * lessons themselves (oldest first) to date each month by.
     *
     * @param  Collection<int, object>  $memberships
     * @param  Collection<int, object{date:string, minutes:int, held:bool}>  $lessons
     * @return array{months:int, bought_minutes:int, used_minutes:int, to_come:bool, start:string, held:Collection<int, object>}
     */
    private function hourState(Collection $memberships, Collection $lessons, ?object $bought, ?string $from): array
    {
        $ranges = $memberships->map(fn ($m) => [
            Carbon::parse($m->joined_on)->format('Y-m-d'),
            $m->left_on !== null ? Carbon::parse($m->left_on)->format('Y-m-d') : null,
        ])->all();
        $mine = $lessons->filter(function ($l) use ($ranges): bool {
            foreach ($ranges as [$joined, $left]) {
                if ($joined <= $l->date && ($left === null || $l->date < $left)) {
                    return true;
                }
            }

            return false;
        })->values();
        $held = $mine->where('held', true)->values();

        return [
            'months' => (int) ($bought->months ?? 0),
            'bought_minutes' => (int) ($bought->minutes ?? 0) + (int) $memberships->sum('carried_minutes'),
            'used_minutes' => (int) $held->sum('minutes'),
            'to_come' => $mine->contains(fn ($l) => ! $l->held),
            'start' => max($from ?? '', (string) min(array_column($ranges, 0))),
            'held' => $held,
        ];
    }

    /**
     * The group's lessons an hours month is counted in — held and still to come, never cancelled,
     * from the date the hours rule took over — oldest first.
     *
     * @return Collection<int, object{date:string, minutes:int, held:bool}>
     */
    private function countedLessons(object $group): Collection
    {
        $from = $this->ruleFrom($group);
        $solo = isset($group->solo_billed_minutes) && $group->solo_billed_minutes !== null ? (int) $group->solo_billed_minutes : null;
        $ranges = $solo === null ? collect() : DB::table('class_group_members')
            ->where('group_id', $group->id)
            ->get(['joined_on', 'left_on'])
            ->map(fn ($m) => [Carbon::parse($m->joined_on)->format('Y-m-d'), $m->left_on !== null ? Carbon::parse($m->left_on)->format('Y-m-d') : null]);

        return DB::table('class_group_lessons')
            ->where('group_id', $group->id)
            ->where('status', '!=', 'CANCELLED')
            ->when($from !== null, fn ($q) => $q->where('occurrence_local_date', '>=', $from))
            ->orderBy('occurrence_local_date')
            ->orderBy('scheduled_at_utc')
            ->get(['occurrence_local_date', 'duration_minutes', 'status'])
            ->map(function ($l) use ($solo, $ranges) {
                $date = Carbon::parse($l->occurrence_local_date)->format('Y-m-d');
                // The solo rule: a lesson with exactly one member on its roster counts at the solo
                // length against their hours. The roster is the memberships covering that date —
                // the same half-open range the sheet expects a student on.
                $onRoster = $solo === null ? 0 : $ranges->filter(fn ($r) => $r[0] <= $date && ($r[1] === null || $date < $r[1]))->count();

                return (object) [
                    'date' => $date,
                    'minutes' => $solo !== null && $onRoster === 1 ? $solo : (int) $l->duration_minutes,
                    'held' => $l->status === 'HELD',
                ];
            });
    }

    /**
     * Each member's hour-months raised so far: how many, and the minutes they bought.
     *
     * @param  list<string>  $studentIds
     * @return array<string, object{months:int, minutes:int}>
     */
    private function boughtHourMonths(string $groupId, array $studentIds): array
    {
        return DB::table('invoice_line_items')
            ->where('class_group_id', $groupId)
            ->whereNotNull('group_cycle')
            ->whereIn('student_id', $studentIds)
            ->groupBy('student_id')
            ->selectRaw('student_id, max(group_cycle) as months, sum(group_minutes) as minutes')
            ->get()
            ->keyBy(fn ($r) => (string) $r->student_id)
            ->all();
    }

    /**
     * The date of the held lesson at which a member's used minutes reached `$minutes`; null when
     * nothing was bought yet (the first month is dated by their start instead) or not reached.
     *
     * @param  Collection<int, object{date:string, minutes:int}>  $held
     */
    private function dateMinutesReached(Collection $held, int $minutes): ?string
    {
        if ($minutes <= 0) {
            return null;
        }

        $sum = 0;
        foreach ($held as $l) {
            $sum += $l->minutes;
            if ($sum >= $minutes) {
                return $l->date;
            }
        }

        return null;
    }

    private function ruleFrom(object $group): ?string
    {
        return ($group->billing_rule_from ?? null) !== null ? Carbon::parse($group->billing_rule_from)->format('Y-m-d') : null;
    }

    /** 480 → "8", 450 → "7.5" — for the line's description. */
    private static function hoursText(int $minutes): string
    {
        return rtrim(rtrim(number_format($minutes / 60, 2, '.', ''), '0'), '.');
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

        // An hours group: a held lesson uses up its members' hours, and the one that uses the last
        // of someone's month raises their next.
        if ($lesson->status === 'HELD' && self::byHours($group)) {
            $this->billHourMonths($group);
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
     * back-dated join owes the months it covers) — or, by hours, their first hour-month (a member
     * moved from another hours group brings their unused minutes); COURSE raises the fee.
     * PER_LESSON waits for sheets.
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

        if (self::byHours($group)) {
            if ($movedFromGroup !== null) {
                foreach ($studentIds as $studentId) {
                    $this->carryHours($movedFromGroup, $group, $studentId);
                }
            }
            $this->billHourMonths($group, $studentIds);

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

        if (self::byHours($group)) {
            $this->billHourMonths($group);

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
            ->get(['m.student_id', 'm.joined_on', 'm.left_on', 'm.status', 'm.price_minor', 'm.carried_minutes']);
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
