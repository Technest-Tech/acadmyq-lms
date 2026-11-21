<?php

declare(strict_types=1);

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The monthly evaluation of a teacher: four parts, each 0–100, and one weighted total.
 *
 *   • QUALITY — the supervisor's lesson visits that month (`teacher_lesson_visits`), averaged.
 *   • REPORTS — the report the teacher owes after every lesson and every trial lesson, read from
 *     `session_reports`. A report counts once it has something IN it: the attendance popup saves
 *     an empty row on every outcome, so the row alone proves nothing.
 *   • ENTRY — the first press of Enter against the lesson's start (`session_joins`).
 *   • CONDUCT — 100 minus the points of what the supervisor recorded by hand
 *     (`teacher_conduct_notes`): absences, apologies, rules not kept.
 *
 * On time earns the whole lesson, late earns half, never earns nothing — the same rule for
 * reports and entry, so the page can say it in one line. A part with nothing to measure (no
 * visit yet, no meeting link) is left out and the remaining weights carry the total, so a
 * teacher is never marked down for something nobody measured.
 *
 * Every lesson is judged by ONE definition ({@see lessonsSql}); the month's table, a teacher's
 * lesson log and the six-month trend all read it, so they cannot disagree.
 */
final class TeacherPerformance
{
    public const KINDS = ['ABSENCE', 'APOLOGY', 'VIOLATION'];

    private const TS = 'Y-m-d\TH:i:s.uP';

    /** Months shown in a teacher's trend, the picked month included. */
    public const TREND_MONTHS = 6;

    /** Lessons listed in one teacher's log; the teacher's totals are never capped. */
    public const LESSON_LIMIT = 1000;

    private const DEFAULTS = [
        'weights' => ['quality' => 40, 'reports' => 20, 'entry' => 20, 'conduct' => 20],
        'points' => ['ABSENCE' => 10, 'APOLOGY' => 3, 'VIOLATION' => 5],
        'visits_target' => 2,
        'late_minutes' => 5,
        // Matches FlagOverdueReportsJob::GRACE_HOURS — the point the system itself calls a report overdue.
        'report_minutes' => 120,
    ];

    /** What a lesson visit is rated on until the academy writes its own list. */
    private const DEFAULT_CRITERIA = [
        ['id' => 'preparation', 'name' => 'التحضير للحصة'],
        ['id' => 'teaching', 'name' => 'أسلوب الشرح والتصحيح'],
        ['id' => 'interaction', 'name' => 'التفاعل مع الطالب'],
        ['id' => 'time', 'name' => 'إدارة وقت الحصة'],
        ['id' => 'setup', 'name' => 'جودة الصوت والصورة'],
    ];

    private const DEFAULT_RULES = [
        'فتح الكاميرا طوال الحصة',
        'الالتزام بالمنهج المحدد',
        'إبلاغ الإدارة قبل الاعتذار',
    ];

    /**
     * A report "has something in it": any answer other than the trial flag that is not blank once
     * its markup is stripped (the same test as the reports log).
     */
    private const HAS_CONTENT = <<<'SQL'
        exists (
          select 1 from jsonb_each_text(sr."values") kv
          where kv.key <> 'is_free_trial'
            and regexp_replace(coalesce(kv.value, ''), '<[^>]*>|&nbsp;|[[:space:]]', '', 'g') <> ''
        )
        SQL;

    private const COUNT_KEYS = [
        'lessons', 'taught', 'student_absent', 'teacher_cancelled', 'student_cancelled', 'unmarked', 'trials',
        'unclassified',
        'join_on_time', 'join_late', 'join_missed', 'join_pending',
        'report_on_time', 'report_late', 'report_missing', 'report_pending',
        'trial_report_on_time', 'trial_report_late', 'trial_report_missing',
    ];

    /**
     * The academy's evaluation settings, defaults filled in.
     *
     * @return array{weights: array<string,int>, points: array<string,int>, visits_target: int, late_minutes: int, report_minutes: int, criteria: list<array{id: string, name: string}>, rules: list<string>}
     */
    public static function settings(string $academyId): array
    {
        $row = DB::table('teacher_performance_settings')->where('academy_id', $academyId)->first();
        if ($row === null) {
            return self::DEFAULTS + ['criteria' => self::DEFAULT_CRITERIA, 'rules' => self::DEFAULT_RULES];
        }

        $criteria = array_values(array_filter(
            (array) json_decode((string) $row->criteria, true),
            static fn ($c): bool => is_array($c) && isset($c['id'], $c['name']),
        ));

        return [
            'weights' => [
                'quality' => (int) $row->weight_quality,
                'reports' => (int) $row->weight_reports,
                'entry' => (int) $row->weight_entry,
                'conduct' => (int) $row->weight_conduct,
            ],
            'points' => [
                'ABSENCE' => (int) $row->absence_points,
                'APOLOGY' => (int) $row->apology_points,
                'VIOLATION' => (int) $row->violation_points,
            ],
            'visits_target' => (int) $row->visits_target,
            'late_minutes' => (int) $row->late_minutes,
            'report_minutes' => (int) $row->report_minutes,
            'criteria' => $criteria === [] ? self::DEFAULT_CRITERIA : $criteria,
            'rules' => array_values(array_filter((array) json_decode((string) $row->rules, true), 'is_string')),
        ];
    }

    /**
     * A calendar month of the academy, as the instants and days that bound it. Only lessons that
     * have started can be judged, so `upper` stops at now.
     *
     * @return array{month: string, from: CarbonImmutable, upper: CarbonImmutable, now: CarbonImmutable, first_day: string, last_day: string, timezone: string}
     */
    public static function window(string $month, string $tz, int $monthsBack = 0): array
    {
        $now = CarbonImmutable::now()->utc();
        $start = CarbonImmutable::parse($month.'-01', $tz)->startOfDay();
        $end = $start->addMonth();
        $from = $start->subMonths($monthsBack);

        return [
            'month' => $month,
            'from' => $from->utc(),
            'upper' => $end->utc()->lessThan($now) ? $end->utc() : $now,
            'now' => $now,
            'first_day' => $from->toDateString(),
            'last_day' => $end->subDay()->toDateString(),
            'timezone' => $tz,
        ];
    }

    /**
     * Per teacher and month in the window: the lesson counts, the notes and the visits, scored.
     * Keyed `[teacherId][month]`.
     *
     * @param  array<string, mixed>  $window  {@see window()}
     * @param  array<string, mixed>  $settings  {@see settings()}
     * @return array<string, array<string, array<string, mixed>>>
     */
    public static function monthly(string $academyId, array $window, array $settings, ?string $teacherId = null): array
    {
        $counts = [];
        if ($window['from']->lessThan($window['upper'])) {
            $select = implode(",\n", [
                'count(*) as lessons',
                "count(*) filter (where status in ('ATTENDED','FREE')) as taught",
                "count(*) filter (where status in ('ABSENT_UNEXCUSED','ABSENT_EXCUSED')) as student_absent",
                "count(*) filter (where status = 'CANCELLED_BY_TEACHER') as teacher_cancelled",
                "count(*) filter (where status = 'CANCELLED_BY_STUDENT') as student_cancelled",
                "count(*) filter (where status = 'SCHEDULED' and not in_progress) as unmarked",
                'count(*) filter (where is_trial) as trials',
                "count(*) filter (where status = 'CANCELLED_BY_TEACHER' and not noted) as unclassified",
                "count(*) filter (where join_bucket = 'on_time') as join_on_time",
                "count(*) filter (where join_bucket = 'late') as join_late",
                "count(*) filter (where join_bucket = 'missed') as join_missed",
                "count(*) filter (where join_bucket = 'pending') as join_pending",
                "count(*) filter (where report_bucket = 'on_time') as report_on_time",
                "count(*) filter (where report_bucket = 'late') as report_late",
                "count(*) filter (where report_bucket = 'missing') as report_missing",
                "count(*) filter (where report_bucket = 'pending') as report_pending",
                "count(*) filter (where is_trial and report_bucket = 'on_time') as trial_report_on_time",
                "count(*) filter (where is_trial and report_bucket = 'late') as trial_report_late",
                "count(*) filter (where is_trial and report_bucket = 'missing') as trial_report_missing",
            ]);
            $rows = DB::select(
                self::lessonsSql()." select teacher_id, month_key,\n{$select}\n from judged group by teacher_id, month_key",
                self::bindings($academyId, $window, $settings, $teacherId),
            );
            foreach ($rows as $r) {
                foreach (self::COUNT_KEYS as $k) {
                    $counts[(string) $r->teacher_id][(string) $r->month_key][$k] = (int) $r->{$k};
                }
            }
        }

        $notes = [];
        $noteRows = DB::table('teacher_conduct_notes')
            ->where('academy_id', $academyId)
            ->whereNull('deleted_at')
            ->whereBetween('occurred_on', [$window['first_day'], $window['last_day']])
            ->when($teacherId !== null, fn ($q) => $q->where('teacher_id', $teacherId))
            ->selectRaw("teacher_id, to_char(occurred_on, 'YYYY-MM') as month_key, kind, count(*) as n, coalesce(sum(points), 0) as points")
            ->groupByRaw("teacher_id, to_char(occurred_on, 'YYYY-MM'), kind")
            ->get();
        foreach ($noteRows as $r) {
            $notes[(string) $r->teacher_id][(string) $r->month_key][(string) $r->kind] = ['n' => (int) $r->n, 'points' => (int) $r->points];
        }

        $visits = [];
        $visitRows = DB::table('teacher_lesson_visits')
            ->where('academy_id', $academyId)
            ->whereNull('deleted_at')
            ->whereBetween('visited_on', [$window['first_day'], $window['last_day']])
            ->when($teacherId !== null, fn ($q) => $q->where('teacher_id', $teacherId))
            ->selectRaw("teacher_id, to_char(visited_on, 'YYYY-MM') as month_key, count(*) as n, coalesce(sum(score), 0) as total")
            ->groupByRaw("teacher_id, to_char(visited_on, 'YYYY-MM')")
            ->get();
        foreach ($visitRows as $r) {
            $visits[(string) $r->teacher_id][(string) $r->month_key] = ['n' => (int) $r->n, 'total' => (int) $r->total];
        }

        $out = [];
        $teacherIds = array_unique(array_merge(array_keys($counts), array_keys($notes), array_keys($visits)));
        foreach ($teacherIds as $tid) {
            $months = array_unique(array_merge(
                array_keys($counts[$tid] ?? []), array_keys($notes[$tid] ?? []), array_keys($visits[$tid] ?? []),
            ));
            foreach ($months as $m) {
                $out[(string) $tid][(string) $m] = self::score(
                    $counts[$tid][$m] ?? [], $notes[$tid][$m] ?? [], $visits[$tid][$m] ?? null, $settings,
                );
            }
        }

        return $out;
    }

    /**
     * Counts → the four parts and the total, every score beside the counts it is made of.
     *
     * @param  array<string, int>  $counts
     * @param  array<string, array{n: int, points: int}>  $notes  by kind
     * @param  array{n: int, total: int}|null  $visits
     * @param  array<string, mixed>  $settings
     * @return array<string, mixed>
     */
    public static function score(array $counts, array $notes, ?array $visits, array $settings): array
    {
        $c = [];
        foreach (self::COUNT_KEYS as $k) {
            $c[$k] = $counts[$k] ?? 0;
        }

        $joinMeasured = $c['join_on_time'] + $c['join_late'] + $c['join_missed'];
        $reportDue = $c['report_on_time'] + $c['report_late'] + $c['report_missing'];
        $points = 0;
        foreach (self::KINDS as $kind) {
            $points += $notes[$kind]['points'] ?? 0;
        }
        $noteCount = array_sum(array_map(static fn (array $n): int => $n['n'], $notes));
        $visitCount = $visits['n'] ?? 0;

        $quality = $visitCount > 0 ? round($visits['total'] / $visitCount, 1) : null;
        $reports = self::earned($c['report_on_time'], $c['report_late'], $reportDue);
        $entry = self::earned($c['join_on_time'], $c['join_late'], $joinMeasured);
        // No lessons and no notes: the teacher was not here to be judged this month.
        $conduct = ($c['lessons'] > 0 || $noteCount > 0) ? (float) max(0, 100 - $points) : null;

        $sum = 0.0;
        $weight = 0;
        foreach (['quality' => $quality, 'reports' => $reports, 'entry' => $entry, 'conduct' => $conduct] as $part => $value) {
            if ($value !== null && $settings['weights'][$part] > 0) {
                $sum += $value * $settings['weights'][$part];
                $weight += $settings['weights'][$part];
            }
        }

        return [
            'total' => $weight > 0 ? round($sum / $weight, 1) : null,
            'quality' => [
                'score' => $quality,
                'visits' => $visitCount,
                'target' => (int) $settings['visits_target'],
            ],
            'reports' => [
                'score' => $reports,
                'due' => $reportDue,
                'on_time' => $c['report_on_time'],
                'late' => $c['report_late'],
                'missing' => $c['report_missing'],
                'pending' => $c['report_pending'],
                'trial_due' => $c['trial_report_on_time'] + $c['trial_report_late'] + $c['trial_report_missing'],
                'trial_on_time' => $c['trial_report_on_time'],
                'trial_late' => $c['trial_report_late'],
                'trial_missing' => $c['trial_report_missing'],
            ],
            'entry' => [
                'score' => $entry,
                'measured' => $joinMeasured,
                'on_time' => $c['join_on_time'],
                'late' => $c['join_late'],
                'missed' => $c['join_missed'],
                'pending' => $c['join_pending'],
            ],
            'conduct' => [
                'score' => $conduct,
                'points' => $points,
                'absences' => $notes['ABSENCE']['n'] ?? 0,
                'apologies' => $notes['APOLOGY']['n'] ?? 0,
                'violations' => $notes['VIOLATION']['n'] ?? 0,
                // Lessons the teacher cancelled that nobody has called an absence or an apology yet.
                'unclassified' => $c['unclassified'],
            ],
            'lessons' => [
                'total' => $c['lessons'],
                'taught' => $c['taught'],
                'student_absent' => $c['student_absent'],
                'teacher_cancelled' => $c['teacher_cancelled'],
                'student_cancelled' => $c['student_cancelled'],
                'unmarked' => $c['unmarked'],
                'trials' => $c['trials'],
            ],
        ];
    }

    /** A month with nothing in it, in the same shape as a scored one. */
    public static function blank(array $settings): array
    {
        return self::score([], [], null, $settings);
    }

    /**
     * One teacher's lessons in the window, judged, newest first.
     *
     * @param  array<string, mixed>  $window
     * @param  array<string, mixed>  $settings
     * @return list<object>
     */
    public static function lessons(string $academyId, array $window, array $settings, string $teacherId): array
    {
        if (! $window['from']->lessThan($window['upper'])) {
            return [];
        }

        return DB::select(
            self::lessonsSql().' '.<<<'SQL'
            select id, scheduled_at_utc, duration_minutes, status, student_name, is_trial, noted,
                   join_bucket, first_join, join_delay, presses,
                   report_bucket, reported_at, report_delay
              from judged
             order by scheduled_at_utc desc, id
             limit ?
            SQL,
            [...self::bindings($academyId, $window, $settings, $teacherId), self::LESSON_LIMIT + 1],
        );
    }

    /**
     * The one definition of how a lesson is judged, as a `judged` CTE. Parameters are bound once,
     * in a `p` row, because native Postgres prepares cannot repeat a placeholder.
     *
     *   join_bucket   : not_tracked | on_time | late | missed | pending
     *   report_bucket : not_needed  | on_time | late | missing | pending
     *   *_delay       : whole minutes (negative = before the start / end)
     *
     * Entry is only measured once the teacher had a meeting link (`join_tracking_since`) and never
     * on a cancelled lesson. A report is owed by a lesson that went ahead or is still unmarked; its
     * clock is `created_at`, the DB's own, because `filled_at` is re-stamped on every edit. A
     * lesson is a TRIAL when its report says so or its student is still a trial student. Deleted
     * lessons (`hidden_at`) and the moved-away half of a reschedule belong to nobody.
     */
    private static function lessonsSql(): string
    {
        $hasContent = self::HAS_CONTENT;

        return <<<SQL
            with p as (
              select ?::uuid as academy_id, ?::timestamptz as from_at, ?::timestamptz as upper_at,
                     ?::timestamptz as now_at, ?::int as late_min, ?::int as report_min,
                     ?::uuid as teacher_id, ?::text as tz
            ), lessons as (
              select se.id, se.teacher_id, se.student_id, se.status::text as status,
                     se.scheduled_at_utc, se.duration_minutes,
                     se.scheduled_at_utc + make_interval(mins => se.duration_minutes) as end_at,
                     to_char(se.scheduled_at_utc at time zone p.tz, 'YYYY-MM') as month_key,
                     te.join_tracking_since,
                     st.full_name as student_name,
                     (coalesce((sr."values"->>'is_free_trial')::boolean, false)
                       or coalesce(st.status::text, '') in ('TRIAL','TRIAL_BOOKED')) as is_trial,
                     exists (
                       select 1 from teacher_conduct_notes n
                        where n.session_id = se.id and n.deleted_at is null
                     ) as noted,
                     j.first_join, coalesce(j.presses, 0) as presses,
                     case when {$hasContent} then sr.created_at end as reported_at,
                     p.now_at, p.late_min, p.report_min
                from sessions se
                cross join p
                join teachers te on te.id = se.teacher_id
                left join students st on st.id = se.student_id
                left join lateral (
                  select min(sj.joined_at) as first_join, count(*) as presses
                    from session_joins sj
                   where sj.session_id = se.id and sj.teacher_id = se.teacher_id
                ) j on true
                left join session_reports sr on sr.session_id = se.id
               where se.academy_id = p.academy_id
                 and se.status <> 'RESCHEDULED'
                 and se.hidden_at is null
                 and se.scheduled_at_utc >= p.from_at
                 and se.scheduled_at_utc <  p.upper_at
                 and (p.teacher_id is null or se.teacher_id = p.teacher_id)
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
     * @param  array<string, mixed>  $window
     * @param  array<string, mixed>  $settings
     * @return list<mixed>
     */
    private static function bindings(string $academyId, array $window, array $settings, ?string $teacherId): array
    {
        // Explicit offsets: a naive Carbon bind is read in the DB session's zone, hours off.
        return [
            $academyId,
            $window['from']->format(self::TS),
            $window['upper']->format(self::TS),
            $window['now']->format(self::TS),
            (int) $settings['late_minutes'],
            (int) $settings['report_minutes'],
            $teacherId,
            $window['timezone'],
        ];
    }

    /** On time earns the whole lesson, late earns half. */
    private static function earned(int $onTime, int $late, int $whole): ?float
    {
        return $whole > 0 ? round(($onTime + $late / 2) / $whole * 100, 1) : null;
    }
}
