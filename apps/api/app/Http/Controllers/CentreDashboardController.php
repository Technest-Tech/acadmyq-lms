<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\CentreSubscriptionRows;
use App\Services\CourseTerm;
use Carbon\CarbonImmutable;
use App\Support\GroupRoster;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * GET /api/dashboard/centre — the numbers a learning centre's home screen opens on, in one call:
 * today's classes (group and private) and how many still have no sheet, this week's attendance,
 * the groups running and their free seats, and the lesson subscriptions about to run out.
 *
 * Money stays with the accounting overview (GET /accounting/overview) and payroll with the
 * profit summary — this endpoint never repeats a figure another screen owns. Behind
 * `entitled:centre`: a Quran academy has no centre dashboard and never calls it.
 *
 * Every comparison is computed against the same count 30 days ago, and is null when there was
 * nothing to compare with: the dashboard shows no percentage rather than an invented one.
 */
final class CentreDashboardController extends Controller
{
    use InteractsWithScheduling;

    /** A subscription counts as "ending soon" within this many days of its end date. */
    private const ENDING_SOON_DAYS = 7;

    /** "Compared to last month" means this many days back, so it reads the same on the 1st as on the 30th. */
    private const COMPARE_DAYS = 30;

    private const LATEST_GROUPS = 3;

    private const ACTIVITY_ROWS = 4;

    public function __construct(private readonly CourseTerm $terms, private readonly CentreSubscriptionRows $subscriptions) {}

    public function show(): JsonResponse
    {
        Gate::any(['group.read', 'session.read']) ?: abort(403);

        $academyId = $this->currentAcademyId();
        $tz = $this->academyTimezone($academyId);
        $now = CarbonImmutable::now($tz);
        $today = $now->toDateString();
        $weekFrom = $now->startOfWeek(CarbonImmutable::SATURDAY)->toDateString();
        $weekTo = $now->endOfWeek(CarbonImmutable::FRIDAY)->toDateString();
        $nowUtc = $now->utc()->format('Y-m-d H:i:sP');
        $then = $now->subDays(self::COMPARE_DAYS);
        $thenDate = $then->toDateString();
        $thenUtc = $then->utc()->format('Y-m-d H:i:sP');

        // ── Today: every class on the academy's calendar day, and the ones with no outcome yet ──
        $groupToday = DB::table('class_group_lessons as l')
            ->join('class_groups as g', 'g.id', '=', 'l.group_id')
            ->where('l.status', '<>', 'CANCELLED')
            // A class nobody is enrolled in yet is not on today's attendance.
            ->whereRaw(GroupRoster::hasStudentsSql('l'))
            ->whereRaw('(l.scheduled_at_utc at time zone g.timezone)::date = ?::date', [$today])
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where l.status = 'SCHEDULED' and l.scheduled_at_utc < ?) as unmarked", [$nowUtc])
            ->first();

        // A private lesson's statuses are the session_status enum: cancelled or moved ones are not
        // a class on today's list.
        $privateToday = DB::table('sessions as se')
            ->whereNotIn('se.status', ['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT', 'RESCHEDULED'])
            ->whereNull('se.hidden_at')
            ->whereRaw('(se.scheduled_at_utc at time zone ?)::date = ?::date', [$tz, $today])
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where se.status = 'SCHEDULED' and se.scheduled_at_utc < ?) as unmarked", [$nowUtc])
            ->first();

        // ── This week: the sheets that were marked, and who was on them ──────────────────────
        $week = DB::table('class_group_attendance as a')
            ->join('class_group_lessons as l', 'l.id', '=', 'a.lesson_id')
            ->where('l.status', 'HELD')
            ->whereBetween('l.occurrence_local_date', [$weekFrom, $weekTo])
            ->selectRaw("count(*) filter (where a.status in ('PRESENT','LATE')) as present")
            ->selectRaw("count(*) filter (where a.status in ('ABSENT','EXCUSED')) as absent")
            ->selectRaw('count(distinct l.id) as held')
            ->first();
        $marked = (int) $week->present + (int) $week->absent;

        // ── Groups: running now, their active members, and the seats still open ───────────────
        $groups = DB::table('class_groups as g')
            ->where('g.status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('g.start_date')->orWhere('g.start_date', '<=', $today))
            ->where(fn ($q) => $q->whereNull('g.end_date')->orWhere('g.end_date', '>=', $today))
            ->selectRaw('count(*) as running')
            ->selectRaw('coalesce(sum(g.capacity), 0) as capacity')
            ->selectRaw('coalesce(sum((select count(*) from class_group_members m where m.group_id = g.id and m.status = \'ACTIVE\')), 0) as members')
            ->selectRaw('coalesce(sum(greatest(g.capacity - (select count(*) from class_group_members m where m.group_id = g.id and m.status = \'ACTIVE\'), 0)) filter (where g.capacity is not null), 0) as free_seats')
            ->first();

        // The same "running" test on the day we compare with. A group archived since then was running.
        $groupsThen = DB::table('class_groups as g')
            ->where('g.created_at', '<', $thenUtc)
            ->where(fn ($q) => $q->whereNull('g.archived_at')->orWhere('g.archived_at', '>=', $thenUtc))
            ->where(fn ($q) => $q->whereNull('g.start_date')->orWhere('g.start_date', '<=', $thenDate))
            ->where(fn ($q) => $q->whereNull('g.end_date')->orWhere('g.end_date', '>=', $thenDate))
            ->count();

        // ── Subscriptions (centre_subscriptions, docs/centre-profile/01-*): open, about to run out
        // (two lessons or fewer left), finished with no next block sold, and students taught
        // outside any block. The old keys keep their names so the home screen needs no change.
        $subs = $this->subscriptions->summary();

        $subsThen = DB::table('centre_subscriptions as cs')
            ->where('cs.created_at', '<', $thenUtc)
            ->where(fn ($q) => $q->whereNull('cs.finished_at')->orWhere('cs.finished_at', '>=', $thenUtc))
            ->where(fn ($q) => $q->whereNull('cs.closed_at')->orWhere('cs.closed_at', '>=', $thenUtc))
            ->count();

        $terms = $this->terms->dashboardCounts();

        return response()->json([
            'today' => [
                'date' => $today,
                'group_lessons' => (int) $groupToday->total,
                'group_unmarked' => (int) $groupToday->unmarked,
                'private_lessons' => (int) $privateToday->total,
                'private_unmarked' => (int) $privateToday->unmarked,
            ],
            'week' => [
                'from' => $weekFrom,
                'to' => $weekTo,
                'held' => (int) $week->held,
                'present' => (int) $week->present,
                'absent' => (int) $week->absent,
                'attendance_rate' => $marked > 0 ? round((int) $week->present / $marked, 3) : null,
            ],
            'groups' => [
                'running' => (int) $groups->running,
                'members' => (int) $groups->members,
                'capacity' => (int) $groups->capacity,
                'free_seats' => (int) $groups->free_seats,
                // Course terms (docs/centre-profile, Phase 2 §2): about to end, and names waiting for a seat.
                'ending_soon' => $terms['ending_soon'],
                'waiting' => $terms['waiting'],
                'delta_pct' => $this->deltaPct((int) $groups->running, $groupsThen),
            ],
            'subscriptions' => [
                'open' => $subs['open'],
                'ending' => $subs['ending'],
                'ending_soon' => $subs['ending'],
                'ending_soon_days' => self::ENDING_SOON_DAYS,
                'finished_unrenewed' => $subs['finished_unrenewed'],
                'outside' => $subs['outside_students'],
                'delta_pct' => $this->deltaPct($subs['open'], $subsThen),
            ],
            'students' => Gate::allows('student.read') ? $this->students($now, $thenUtc) : null,
            'latest_groups' => Gate::allows('group.read') ? $this->latestGroups($today) : [],
            'activity' => $this->activity(),
        ]);
    }

    /**
     * GET /api/dashboard/centre/trend — money in and lessons held, month by month, for the home
     * screen's chart. `months` is 3, 6 or 12; every month in the range is present, a quiet one at
     * zero, so the line never skips a month. Receipts are on the cash basis the accounting overview
     * uses (dated when received, voided ones out), and only reach a reader of invoices.
     */
    public function trend(Request $request): JsonResponse
    {
        Gate::any(['group.read', 'session.read']) ?: abort(403);

        $tz = $this->academyTimezone($this->currentAcademyId());
        $wanted = (int) $request->query('months', '6');
        $count = in_array($wanted, [3, 6, 12], true) ? $wanted : 6;

        $first = CarbonImmutable::now($tz)->startOfMonth()->subMonths($count - 1);
        $from = $first->toDateString();
        $months = [];
        for ($i = 0; $i < $count; $i++) {
            $months[] = $first->addMonths($i)->format('Y-m');
        }

        $collected = null;
        if (Gate::allows('invoice.read')) {
            $byCurrency = [];
            foreach (DB::table('receipts as r')
                ->whereNull('r.voided_at')
                ->where('r.received_on', '>=', $from)
                ->selectRaw("r.currency, to_char(r.received_on, 'YYYY-MM') as month, sum(r.amount_minor) as total")
                ->groupBy('r.currency', 'month')
                ->get() as $row) {
                $byCurrency[(string) $row->currency][(string) $row->month] = (int) $row->total;
            }
            $collected = [];
            foreach ($byCurrency as $currency => $totals) {
                $collected[] = [
                    'currency' => $currency,
                    'by_month' => array_map(fn (string $m) => ['month' => $m, 'amount_minor' => $totals[$m] ?? 0], $months),
                ];
            }
        }

        $lessons = array_fill_keys($months, 0);
        foreach (DB::table('class_group_lessons as l')
            ->where('l.status', 'HELD')
            ->where('l.occurrence_local_date', '>=', $from)
            ->selectRaw("to_char(l.occurrence_local_date, 'YYYY-MM') as month, count(*) as total")
            ->groupBy('month')
            ->get() as $row) {
            if (isset($lessons[$row->month])) {
                $lessons[$row->month] += (int) $row->total;
            }
        }
        foreach (DB::table('sessions as se')
            ->whereIn('se.status', ['ATTENDED', 'FREE'])
            ->whereNull('se.hidden_at')
            ->whereRaw('(se.scheduled_at_utc at time zone ?)::date >= ?::date', [$tz, $from])
            ->selectRaw("to_char(se.scheduled_at_utc at time zone ?, 'YYYY-MM') as month, count(*) as total", [$tz])
            ->groupBy('month')
            ->get() as $row) {
            if (isset($lessons[$row->month])) {
                $lessons[$row->month] += (int) $row->total;
            }
        }

        return response()->json([
            'months' => $months,
            'collected' => $collected,
            'lessons' => array_map(fn (string $m) => ['month' => $m, 'count' => $lessons[$m]], $months),
        ]);
    }

    /**
     * Who is on the books. The four slices add up to `total`, so the ring never overlaps: a new
     * student is one who joined in the last 30 days and is not also counted among the active.
     *
     * @return array<string, int|null>
     */
    private function students(CarbonImmutable $now, string $thenUtc): array
    {
        $row = DB::table('students as s')
            ->whereNull('s.deleted_at')
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where s.status = 'REGULAR' and s.created_at < ?) as active", [$thenUtc])
            ->selectRaw("count(*) filter (where s.status = 'REGULAR' and s.created_at >= ?) as new_recent", [$thenUtc])
            ->selectRaw("count(*) filter (where s.status in ('TRIAL','TRIAL_BOOKED')) as trial")
            ->selectRaw("count(*) filter (where s.status in ('GRADUATED','WITHDRAWN')) as inactive")
            ->first();

        // On the books then: joined before that day, and not removed before it.
        $totalThen = DB::table('students as s')
            ->where('s.created_at', '<', $thenUtc)
            ->where(fn ($q) => $q->whereNull('s.deleted_at')->orWhere('s.deleted_at', '>=', $thenUtc))
            ->count();

        return [
            'total' => (int) $row->total,
            'active' => (int) $row->active,
            'new_recent' => (int) $row->new_recent,
            'trial' => (int) $row->trial,
            'inactive' => (int) $row->inactive,
            'delta_pct' => $this->deltaPct((int) $row->total, $totalThen),
        ];
    }

    /** @return list<array{id: string, name: string, level: string|null, members: int, capacity: int|null}> */
    private function latestGroups(string $today): array
    {
        return DB::table('class_groups as g')
            ->where('g.status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('g.end_date')->orWhere('g.end_date', '>=', $today))
            ->orderByDesc('g.created_at')
            ->limit(self::LATEST_GROUPS)
            ->select(['g.id', 'g.name', 'g.level', 'g.capacity'])
            ->selectRaw("(select count(*) from class_group_members m where m.group_id = g.id and m.status = 'ACTIVE') as members")
            ->get()
            ->map(fn ($g) => [
                'id' => (string) $g->id,
                'name' => (string) $g->name,
                'level' => $g->level !== null ? (string) $g->level : null,
                'members' => (int) $g->members,
                'capacity' => $g->capacity !== null ? (int) $g->capacity : null,
            ])
            ->all();
    }

    /**
     * What just happened at the centre: the newest students, groups, subscriptions and receipts,
     * merged by time. Each source is read only for someone allowed to read it, so a front desk
     * without money never sees a receipt go by here.
     *
     * @return list<array{type: string, name: string|null, amount_minor: int|null, currency: string|null, at: string}>
     */
    private function activity(): array
    {
        $rows = [];
        $take = self::ACTIVITY_ROWS;

        if (Gate::allows('student.read')) {
            foreach (DB::table('students as s')->whereNull('s.deleted_at')->orderByDesc('s.created_at')->limit($take)->get(['s.full_name', 's.created_at']) as $r) {
                $rows[] = $this->activityRow('student', $r->full_name, $r->created_at);
            }
        }
        if (Gate::allows('group.read')) {
            foreach (DB::table('class_groups as g')->orderByDesc('g.created_at')->limit($take)->get(['g.name', 'g.created_at']) as $r) {
                $rows[] = $this->activityRow('group', $r->name, $r->created_at);
            }
        }
        if (Gate::allows('package.read')) {
            foreach (DB::table('lesson_packages as p')
                ->leftJoin('students as s', 's.id', '=', 'p.student_id')
                ->orderByDesc('p.created_at')->limit($take)
                ->get(['s.full_name', 'p.created_at']) as $r) {
                $rows[] = $this->activityRow('subscription', $r->full_name, $r->created_at);
            }
            foreach (DB::table('centre_subscriptions as cs')
                ->leftJoin('students as s', 's.id', '=', 'cs.student_id')
                ->orderByDesc('cs.created_at')->limit($take)
                ->get(['s.full_name', 'cs.created_at']) as $r) {
                $rows[] = $this->activityRow('subscription', $r->full_name, $r->created_at);
            }
        }
        if (Gate::allows('invoice.read')) {
            foreach (DB::table('receipts as r')
                ->leftJoin('students as s', 's.id', '=', 'r.student_id')
                ->whereNull('r.voided_at')
                ->orderByDesc('r.created_at')->limit($take)
                ->get(['r.payer_name', 's.full_name', 'r.amount_minor', 'r.currency', 'r.created_at']) as $r) {
                $rows[] = $this->activityRow('receipt', $r->payer_name ?? $r->full_name, $r->created_at, (int) $r->amount_minor, (string) $r->currency);
            }
        }

        usort($rows, fn (array $a, array $b) => strcmp($b['at'], $a['at']));

        return array_slice($rows, 0, $take);
    }

    /** @return array{type: string, name: string|null, amount_minor: int|null, currency: string|null, at: string} */
    private function activityRow(string $type, mixed $name, mixed $at, ?int $amountMinor = null, ?string $currency = null): array
    {
        return [
            'type' => $type,
            'name' => $name !== null ? (string) $name : null,
            'amount_minor' => $amountMinor,
            'currency' => $currency,
            'at' => CarbonImmutable::parse((string) $at)->utc()->toIso8601String(),
        ];
    }

    /** Null when there was nothing to compare with: no percentage beats an invented one. */
    private function deltaPct(int $now, int $then): ?int
    {
        return $then > 0 ? (int) round(($now - $then) / $then * 100) : null;
    }
}
