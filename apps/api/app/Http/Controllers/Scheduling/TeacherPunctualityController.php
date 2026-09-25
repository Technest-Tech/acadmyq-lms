<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A teacher's punctuality (gate `teacher.read`): for a period, when they pressed Enter on each of
 * their lessons, measured from the lesson's start.
 *
 * Per lesson, the FIRST press decides:
 *   • on_time — within `late_minutes` of the start (pressing early counts, the button opens
 *     {@see SessionJoinController::OPENS_MINUTES_BEFORE_START} minutes before);
 *   • late    — after that, but before the lesson ended;
 *   • missed  — the lesson ended and Enter was never pressed;
 *   • pending — not pressed yet, and the lesson is still on, so it can still go either way.
 *
 * Only lessons that could have been entered are measured: cancelled and moved lessons are left out,
 * and so is everything before the teacher first had a meeting link (`join_tracking_since`) — there
 * was no button to press then. Every lesson counted is listed, so a percentage can always be traced
 * back to the lessons behind it.
 */
final class TeacherPunctualityController extends Controller
{
    use InteractsWithScheduling;

    private const TS = 'Y-m-d\TH:i:s.uP';

    public const DEFAULT_LATE_MINUTES = 5;

    private const SESSION_LIMIT = 1500;

    private const EXCLUDED_STATUSES = ['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT', 'RESCHEDULED'];

    /** GET /api/teachers/{id}/punctuality?from=Y-m-d&to=Y-m-d[&late_minutes=] */
    public function show(Request $request, string $teacherId): JsonResponse
    {
        Gate::authorize('teacher.read');

        $data = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'late_minutes' => ['sometimes', 'integer', 'min:0', 'max:240'],
        ]);

        $teacher = DB::table('teachers')->where('id', $teacherId)->first(['id', 'meeting_url', 'join_tracking_since']);
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        $academyId = $this->currentAcademyId();
        $tz = $this->academyTimezone($academyId);
        $now = CarbonImmutable::now();
        $lateMinutes = (int) ($data['late_minutes'] ?? self::DEFAULT_LATE_MINUTES);
        $since = $teacher->join_tracking_since !== null ? CarbonImmutable::parse($teacher->join_tracking_since)->utc() : null;

        $fromUtc = CarbonImmutable::parse($data['from'], $tz)->startOfDay()->utc();
        $toUtc = CarbonImmutable::parse($data['to'], $tz)->addDay()->startOfDay()->utc();
        if ($since !== null && $since->greaterThan($fromUtc)) {
            $fromUtc = $since;
        }
        // Only lessons that have started can be measured.
        $upper = $toUtc->lessThan($now) ? $toUtc : $now;

        $sessions = $since === null || ! $fromUtc->lessThan($upper) ? collect() : DB::table('sessions as se')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->where('se.teacher_id', $teacherId)
            ->whereNotIn('se.status', self::EXCLUDED_STATUSES)
            ->where('se.scheduled_at_utc', '>=', $fromUtc->format(self::TS))
            ->where('se.scheduled_at_utc', '<', $upper->format(self::TS))
            ->orderByDesc('se.scheduled_at_utc')->orderBy('se.id')
            ->limit(self::SESSION_LIMIT + 1)
            ->get(['se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status', 'st.full_name as student_name']);
        $truncated = $sessions->count() > self::SESSION_LIMIT;
        $sessions = $sessions->take(self::SESSION_LIMIT);

        $joins = $sessions->isEmpty() ? collect() : DB::table('session_joins')
            ->where('teacher_id', $teacherId)
            ->whereIn('session_id', $sessions->pluck('id')->all())
            ->orderBy('joined_at')
            ->get(['session_id', 'joined_at'])
            ->groupBy('session_id');

        $totals = ['lessons' => 0, 'on_time' => 0, 'late' => 0, 'missed' => 0, 'pending' => 0];
        $delays = [];
        $lateDelays = [];
        $rows = [];

        foreach ($sessions as $s) {
            $start = CarbonImmutable::parse($s->scheduled_at_utc)->utc();
            $end = $start->addMinutes((int) $s->duration_minutes);
            $presses = ($joins[(string) $s->id] ?? collect())
                ->map(fn (object $j): CarbonImmutable => CarbonImmutable::parse($j->joined_at)->utc())
                ->values();
            $first = $presses->first();
            $delay = $first !== null ? $this->minutesBetween($start, $first) : null;

            if ($delay !== null) {
                $bucket = $delay <= $lateMinutes ? 'on_time' : 'late';
                $delays[] = max(0, $delay);
                if ($bucket === 'late') {
                    $lateDelays[] = $delay;
                }
            } else {
                $bucket = $end->greaterThan($now) ? 'pending' : 'missed';
            }

            $totals['lessons']++;
            $totals[$bucket]++;

            $rows[] = [
                'id' => (string) $s->id,
                'scheduled_at_utc' => $start->toIso8601String(),
                'local_date' => $start->setTimezone($tz)->toDateString(),
                'duration_minutes' => (int) $s->duration_minutes,
                'status' => (string) $s->status,
                'student_name' => $s->student_name,
                'bucket' => $bucket,
                'first_joined_at' => $first?->toIso8601String(),
                'delay_minutes' => $delay,
                'joins' => $presses->map(fn (CarbonImmutable $p): string => $p->toIso8601String())->all(),
            ];
        }

        // Decided lessons only: a lesson still on cannot count for or against anyone yet.
        $measured = $totals['on_time'] + $totals['late'] + $totals['missed'];
        $entered = $totals['on_time'] + $totals['late'];

        return response()->json([
            'window' => ['from' => $data['from'], 'to' => $data['to'], 'timezone' => $tz],
            'late_minutes' => $lateMinutes,
            'opens_minutes_before' => SessionJoinController::OPENS_MINUTES_BEFORE_START,
            'has_meeting_url' => $teacher->meeting_url !== null && $teacher->meeting_url !== '',
            'tracking_since' => $since?->toIso8601String(),
            'totals' => $totals + [
                'measured' => $measured,
                'entered' => $entered,
                'on_time_rate' => $measured > 0 ? round($totals['on_time'] / $measured * 100, 1) : null,
                'entered_rate' => $measured > 0 ? round($entered / $measured * 100, 1) : null,
                'avg_delay_minutes' => $this->average($delays),
                'avg_late_minutes' => $this->average($lateDelays),
            ],
            'sessions' => $rows,
            'truncated' => $truncated,
        ]);
    }

    /** Whole minutes from $from to $to — negative when $to came first. */
    private function minutesBetween(CarbonImmutable $from, CarbonImmutable $to): int
    {
        return (int) round(($to->getTimestamp() - $from->getTimestamp()) / 60);
    }

    /** @param list<int> $values */
    private function average(array $values): ?float
    {
        return $values === [] ? null : round(array_sum($values) / count($values), 1);
    }
}
