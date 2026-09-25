<?php

declare(strict_types=1);

namespace App\Http\Controllers\Quality;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Http\Controllers\Scheduling\SessionJoinController;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Teacher performance (gate `teacher_quality.read`): for a period, how every teacher of the academy
 * turns up, reports and attends — measured from records the system already keeps, never typed in.
 *
 * Three clocks per lesson, all judged in SQL by ONE definition ({@see lessonsSql}) so the academy
 * table and a teacher's lesson log can never disagree:
 *
 *   • ENTER — the teacher's first press of Enter (`session_joins`), from the lesson's START. On time
 *     within `late_minutes`; late after that; missed when the lesson ended un-entered; pending while
 *     it is still on. Only measured once the teacher had a meeting link (`join_tracking_since`) —
 *     before that there was no button to press — and never on a cancelled lesson.
 *   • REPORT — the report's FIRST filing (`session_reports.created_at`), from the lesson's END. On
 *     time within `report_minutes`. Owed by the same lessons FlagOverdueReportsJob chases
 *     (SCHEDULED/ATTENDED/FREE). `created_at` rather than `filled_at`: the latter is re-stamped on
 *     every edit and bound naively (3h off on a Cairo session), while `created_at` is the DB's own
 *     clock and never moves.
 *   • ATTENDANCE — the lesson's recorded outcome. A teacher-cancelled lesson is the teacher's
 *     absence; a lesson that went ahead (attended, free, or the STUDENT was absent) is one the
 *     teacher showed up for.
 *
 * Only lessons that have started count; a RESCHEDULED row is the moved-away original and belongs to
 * nobody. Rates are over DECIDED lessons only, so this morning's lessons never drag the day down
 * before anyone could have acted.
 *
 * The score is the plain mean of the rates a teacher has data for (on-time entry, on-time report,
 * attendance) — no hidden weights, so a head of teachers can explain any number on the page.
 */
final class TeacherInsightsController extends Controller
{
    use InteractsWithScheduling;

    private const TS = 'Y-m-d\TH:i:s.uP';

    public const DEFAULT_LATE_MINUTES = 5;

    /** Matches FlagOverdueReportsJob::GRACE_HOURS — the point the system itself calls a report overdue. */
    public const DEFAULT_REPORT_MINUTES = 120;

    /** Lessons listed in one teacher's log; the teacher's totals are never capped. */
    private const LESSON_LIMIT = 1000;

    /** GET /api/teacher-insights?from=Y-m-d&to=Y-m-d[&late_minutes=&report_minutes=] */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.read');
        [$params, $window] = $this->window($request);
        $academyId = $this->currentAcademyId();

        $rows = $params['empty'] ? collect() : collect(DB::select(
            $this->lessonsSql().' '.<<<'SQL'
            select teacher_id,
              count(*)                                                                       as lessons,
              count(*) filter (where status = 'ATTENDED')                                    as attended,
              count(*) filter (where status = 'FREE')                                        as free,
              count(*) filter (where status in ('ABSENT_UNEXCUSED','ABSENT_EXCUSED'))        as student_absent,
              count(*) filter (where status = 'CANCELLED_BY_TEACHER')                        as teacher_cancelled,
              count(*) filter (where status = 'CANCELLED_BY_STUDENT')                        as student_cancelled,
              count(*) filter (where status = 'SCHEDULED' and not in_progress)               as unmarked,
              count(*) filter (where status = 'SCHEDULED' and in_progress)                   as in_progress,
              count(*) filter (where join_bucket = 'on_time')                                as join_on_time,
              count(*) filter (where join_bucket = 'late')                                   as join_late,
              count(*) filter (where join_bucket = 'missed')                                 as join_missed,
              count(*) filter (where join_bucket = 'pending')                                as join_pending,
              coalesce(sum(greatest(join_delay, 0)) filter (where join_bucket in ('on_time','late')), 0) as join_delay_sum,
              coalesce(sum(join_delay) filter (where join_bucket = 'late'), 0)               as join_late_sum,
              count(*) filter (where report_bucket = 'on_time')                              as report_on_time,
              count(*) filter (where report_bucket = 'late')                                 as report_late,
              count(*) filter (where report_bucket = 'missing')                              as report_missing,
              count(*) filter (where report_bucket = 'pending')                              as report_pending,
              coalesce(sum(greatest(report_delay, 0)) filter (where report_bucket in ('on_time','late')), 0) as report_delay_sum
            from judged
            group by teacher_id
            SQL,
            $this->bindings($academyId, $params, null),
        ))->keyBy(fn (object $r): string => (string) $r->teacher_id);

        // Every current teacher is listed — one with no lessons in the window is still on the staff
        // — plus anyone who taught in the window and has since left.
        $teachers = DB::table('teachers')
            ->where('academy_id', $academyId)
            ->where(function ($q) use ($rows): void {
                $q->where(fn ($q) => $q->whereNull('deleted_at')->where('is_active', true));
                if ($rows->isNotEmpty()) {
                    $q->orWhereIn('id', $rows->keys()->all());
                }
            })
            ->orderBy('full_name')
            ->get(['id', 'full_name', 'is_active', 'deleted_at', 'meeting_url', 'join_tracking_since']);

        $sum = array_fill_keys(self::COUNT_KEYS, 0);
        $list = [];
        foreach ($teachers as $te) {
            $counts = $this->counts($rows->get((string) $te->id));
            foreach (self::COUNT_KEYS as $k) {
                $sum[$k] += $counts[$k];
            }
            $list[] = [
                'id' => (string) $te->id,
                'name' => $te->full_name,
                'is_active' => (bool) $te->is_active && $te->deleted_at === null,
                'has_meeting_url' => $te->meeting_url !== null && $te->meeting_url !== '',
                'tracking_since' => $te->join_tracking_since !== null
                    ? CarbonImmutable::parse($te->join_tracking_since)->utc()->toIso8601String()
                    : null,
            ] + $this->present($counts);
        }

        return response()->json($window + [
            'totals' => $this->present($sum),
            'teachers' => $list,
        ]);
    }

    /** GET /api/teacher-insights/teachers/{id}?from=&to=[&late_minutes=&report_minutes=] — the lessons behind one row. */
    public function show(Request $request, string $teacherId): JsonResponse
    {
        Gate::authorize('teacher_quality.read');
        [$params, $window] = $this->window($request);
        $academyId = $this->currentAcademyId();

        $teacher = ! Str::isUuid($teacherId) ? null : DB::table('teachers')->where('id', $teacherId)
            ->first(['id', 'full_name', 'is_active', 'deleted_at', 'meeting_url', 'join_tracking_since']);
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        $lessons = $params['empty'] ? [] : DB::select(
            $this->lessonsSql(filterTeacher: true).' '.<<<'SQL'
            select j.id, j.scheduled_at_utc, j.duration_minutes, j.status, st.full_name as student_name,
                   j.join_bucket, j.first_join, j.join_delay, j.presses,
                   j.report_bucket, j.reported_at, j.report_delay
              from judged j
              left join students st on st.id = j.student_id
             order by j.scheduled_at_utc desc, j.id
             limit ?
            SQL,
            [...$this->bindings($academyId, $params, $teacherId), self::LESSON_LIMIT + 1],
        );
        $truncated = count($lessons) > self::LESSON_LIMIT;
        $lessons = array_slice($lessons, 0, self::LESSON_LIMIT);
        $tz = $window['window']['timezone'];

        return response()->json($window + [
            'teacher' => [
                'id' => (string) $teacher->id,
                'name' => $teacher->full_name,
                'is_active' => (bool) $teacher->is_active && $teacher->deleted_at === null,
                'has_meeting_url' => $teacher->meeting_url !== null && $teacher->meeting_url !== '',
                'tracking_since' => $teacher->join_tracking_since !== null
                    ? CarbonImmutable::parse($teacher->join_tracking_since)->utc()->toIso8601String()
                    : null,
            ],
            'lessons' => array_map(fn (object $l): array => [
                'id' => (string) $l->id,
                'scheduled_at_utc' => CarbonImmutable::parse($l->scheduled_at_utc)->utc()->toIso8601String(),
                'local_date' => CarbonImmutable::parse($l->scheduled_at_utc)->setTimezone($tz)->toDateString(),
                'duration_minutes' => (int) $l->duration_minutes,
                'status' => (string) $l->status,
                'student_name' => $l->student_name,
                'join_bucket' => (string) $l->join_bucket,
                'first_joined_at' => $l->first_join !== null ? CarbonImmutable::parse($l->first_join)->utc()->toIso8601String() : null,
                'join_delay_minutes' => $l->join_delay !== null ? (int) $l->join_delay : null,
                'presses' => (int) $l->presses,
                'report_bucket' => (string) $l->report_bucket,
                'reported_at' => $l->reported_at !== null ? CarbonImmutable::parse($l->reported_at)->utc()->toIso8601String() : null,
                'report_delay_minutes' => $l->report_delay !== null ? (int) $l->report_delay : null,
            ], $lessons),
            'truncated' => $truncated,
        ]);
    }

    private const COUNT_KEYS = [
        'lessons', 'attended', 'free', 'student_absent', 'teacher_cancelled', 'student_cancelled', 'unmarked', 'in_progress',
        'join_on_time', 'join_late', 'join_missed', 'join_pending', 'join_delay_sum', 'join_late_sum',
        'report_on_time', 'report_late', 'report_missing', 'report_pending', 'report_delay_sum',
    ];

    /**
     * The one definition of how a lesson is judged, as a `judged` CTE. Parameters are bound once, in
     * a `p` row, because native Postgres prepares cannot repeat a placeholder.
     *
     *   join_bucket   : not_tracked | on_time | late | missed | pending
     *   report_bucket : not_needed  | on_time | late | missing | pending
     *   *_delay       : whole minutes (negative = before the start / end)
     */
    private function lessonsSql(bool $filterTeacher = false): string
    {
        $teacher = $filterTeacher ? 'and se.teacher_id = p.teacher_id' : '';

        return <<<SQL
            with p as (
              select ?::uuid as academy_id, ?::timestamptz as from_at, ?::timestamptz as upper_at,
                     ?::timestamptz as now_at, ?::int as late_min, ?::int as report_min, ?::uuid as teacher_id
            ), lessons as (
              select se.id, se.teacher_id, se.student_id, se.status::text as status,
                     se.scheduled_at_utc, se.duration_minutes,
                     se.scheduled_at_utc + make_interval(mins => se.duration_minutes) as end_at,
                     te.join_tracking_since,
                     j.first_join, coalesce(j.presses, 0) as presses,
                     sr.created_at as reported_at,
                     p.now_at, p.late_min, p.report_min
                from sessions se
                cross join p
                join teachers te on te.id = se.teacher_id
                left join lateral (
                  select min(sj.joined_at) as first_join, count(*) as presses
                    from session_joins sj
                   where sj.session_id = se.id and sj.teacher_id = se.teacher_id
                ) j on true
                left join session_reports sr on sr.session_id = se.id
               where se.academy_id = p.academy_id
                 and se.status <> 'RESCHEDULED'
                 and se.scheduled_at_utc >= p.from_at
                 and se.scheduled_at_utc <  p.upper_at
                 {$teacher}
            ), timed as (
              select l.*,
                     l.end_at > l.now_at as in_progress,
                     case when l.first_join is not null
                          then round(extract(epoch from (l.first_join - l.scheduled_at_utc)) / 60)::int end as join_delay,
                     case when l.reported_at is not null
                          then round(extract(epoch from (l.reported_at - l.end_at)) / 60)::int end as report_delay
                from lessons l
            ), judged as (
              select t.*,
                     case
                       when t.status in ('CANCELLED_BY_TEACHER','CANCELLED_BY_STUDENT')
                         or t.join_tracking_since is null
                         or t.scheduled_at_utc < t.join_tracking_since then 'not_tracked'
                       when t.first_join is null then case when t.in_progress then 'pending' else 'missed' end
                       when t.join_delay <= t.late_min then 'on_time'
                       else 'late'
                     end as join_bucket,
                     case
                       when t.status not in ('SCHEDULED','ATTENDED','FREE') then 'not_needed'
                       when t.reported_at is null then
                         case when t.end_at + make_interval(mins => t.report_min) > t.now_at then 'pending' else 'missing' end
                       when t.report_delay <= t.report_min then 'on_time'
                       else 'late'
                     end as report_bucket
                from timed t
            )
            SQL;
    }

    /**
     * @param  array{from: CarbonImmutable, upper: CarbonImmutable, now: CarbonImmutable, late: int, report: int, empty: bool}  $params
     * @return list<mixed>
     */
    private function bindings(string $academyId, array $params, ?string $teacherId): array
    {
        // Explicit offsets: a naive Carbon bind is read in the DB session's zone (3h off in Cairo).
        return [
            $academyId,
            $params['from']->format(self::TS),
            $params['upper']->format(self::TS),
            $params['now']->format(self::TS),
            $params['late'],
            $params['report'],
            $teacherId,
        ];
    }

    /**
     * Validate the period + thresholds and resolve them to UTC instants.
     *
     * @return array{0: array{from: CarbonImmutable, upper: CarbonImmutable, now: CarbonImmutable, late: int, report: int, empty: bool}, 1: array<string, mixed>}
     */
    private function window(Request $request): array
    {
        $data = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'late_minutes' => ['sometimes', 'integer', 'min:0', 'max:240'],
            'report_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
        ]);

        $tz = $this->academyTimezone($this->currentAcademyId());
        $now = CarbonImmutable::now()->utc();
        $from = CarbonImmutable::parse($data['from'], $tz)->startOfDay()->utc();
        $to = CarbonImmutable::parse($data['to'], $tz)->addDay()->startOfDay()->utc();
        // Only lessons that have started can be measured.
        $upper = $to->lessThan($now) ? $to : $now;
        $late = (int) ($data['late_minutes'] ?? self::DEFAULT_LATE_MINUTES);
        $report = (int) ($data['report_minutes'] ?? self::DEFAULT_REPORT_MINUTES);

        return [
            ['from' => $from, 'upper' => $upper, 'now' => $now, 'late' => $late, 'report' => $report, 'empty' => ! $from->lessThan($upper)],
            [
                'window' => ['from' => $data['from'], 'to' => $data['to'], 'timezone' => $tz],
                'thresholds' => [
                    'late_minutes' => $late,
                    'report_minutes' => $report,
                    'opens_minutes_before' => SessionJoinController::OPENS_MINUTES_BEFORE_START,
                ],
            ],
        ];
    }

    /** @return array<string, int> */
    private function counts(?object $row): array
    {
        $out = [];
        foreach (self::COUNT_KEYS as $k) {
            $out[$k] = $row !== null ? (int) $row->{$k} : 0;
        }

        return $out;
    }

    /**
     * Counts → the three blocks the page reads, each rate beside the counts it is made of.
     *
     * @param  array<string, int>  $c
     * @return array<string, mixed>
     */
    private function present(array $c): array
    {
        $entered = $c['join_on_time'] + $c['join_late'];
        $joinMeasured = $entered + $c['join_missed'];
        $filed = $c['report_on_time'] + $c['report_late'];
        $reportDecided = $filed + $c['report_missing'];
        // The teacher showed up whenever the lesson went ahead — a student no-show included.
        $showedUp = $c['attended'] + $c['free'] + $c['student_absent'];
        $teacherDecided = $showedUp + $c['teacher_cancelled'];
        $studentDecided = $c['attended'] + $c['free'] + $c['student_absent'];

        $join = [
            'measured' => $joinMeasured,
            'entered' => $entered,
            'on_time' => $c['join_on_time'],
            'late' => $c['join_late'],
            'missed' => $c['join_missed'],
            'pending' => $c['join_pending'],
            'on_time_rate' => $this->rate($c['join_on_time'], $joinMeasured),
            'entered_rate' => $this->rate($entered, $joinMeasured),
            'avg_delay_minutes' => $entered > 0 ? round($c['join_delay_sum'] / $entered, 1) : null,
            'avg_late_minutes' => $c['join_late'] > 0 ? round($c['join_late_sum'] / $c['join_late'], 1) : null,
        ];
        $reports = [
            'due' => $reportDecided,
            'filed' => $filed,
            'on_time' => $c['report_on_time'],
            'late' => $c['report_late'],
            'missing' => $c['report_missing'],
            'pending' => $c['report_pending'],
            'on_time_rate' => $this->rate($c['report_on_time'], $reportDecided),
            'filed_rate' => $this->rate($filed, $reportDecided),
            'avg_delay_minutes' => $filed > 0 ? round($c['report_delay_sum'] / $filed, 1) : null,
        ];
        $attendance = [
            'lessons' => $c['lessons'],
            'attended' => $c['attended'],
            'free' => $c['free'],
            'student_absent' => $c['student_absent'],
            'teacher_absent' => $c['teacher_cancelled'],
            'student_cancelled' => $c['student_cancelled'],
            'unmarked' => $c['unmarked'],
            'in_progress' => $c['in_progress'],
            'teacher_attendance_rate' => $this->rate($showedUp, $teacherDecided),
            'teacher_absence_rate' => $this->rate($c['teacher_cancelled'], $teacherDecided),
            'student_attendance_rate' => $this->rate($c['attended'] + $c['free'], $studentDecided),
        ];

        $parts = array_values(array_filter(
            [$join['on_time_rate'], $reports['on_time_rate'], $attendance['teacher_attendance_rate']],
            fn (?float $r): bool => $r !== null,
        ));

        return [
            'score' => $parts === [] ? null : round(array_sum($parts) / count($parts), 1),
            'join' => $join,
            'reports' => $reports,
            'attendance' => $attendance,
        ];
    }

    private function rate(int $part, int $whole): ?float
    {
        return $whole > 0 ? round($part / $whole * 100, 1) : null;
    }
}
