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
 * Supervision statistics (gate `supervision.stats`): how promptly each supervisor pressed
 * "Following" on the lessons of a period, and how promptly outcomes were recorded.
 *
 * Two clocks, both per lesson:
 *
 *   • FOLLOW — the first "Following" click, measured from the lesson's START. On time when it
 *     came within `follow_minutes` of the start (a click just before the start counts). A lesson
 *     that was already marked before it started (cancelled the day before) never needed following
 *     and is left out of that denominator.
 *   • MARK — `sessions.outcome_set_at`, measured from the lesson's END, whatever the outcome was
 *     (attended, absent, cancelled). On time within `mark_minutes` of the end; a lesson marked
 *     before it ended reads as zero delay.
 *
 * A lesson whose deadline has not passed yet is "pending", not late, so this morning's lessons do
 * not drag the day's numbers down before anyone could have acted. Every lesson in the window is
 * listed with both clocks, so a percentage can always be traced back to the lessons behind it.
 */
final class SupervisionStatsController extends Controller
{
    use InteractsWithScheduling;

    private const TS = 'Y-m-d\TH:i:s.uP';

    private const DEFAULT_FOLLOW_MINUTES = 10;

    private const DEFAULT_MARK_MINUTES = 60;

    /** Lessons listed per response; the counts are computed over the same capped set. */
    private const SESSION_LIMIT = 1500;

    private const ROLE_ORDER = ['ACADEMY_OWNER' => 0, 'SUPERVISOR' => 1, 'TEACHER' => 2, 'STAFF' => 3];

    /** GET /api/supervision/stats?from=Y-m-d&to=Y-m-d[&follow_minutes=&mark_minutes=] */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('supervision.stats');

        $data = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'follow_minutes' => ['sometimes', 'integer', 'min:0', 'max:1440'],
            'mark_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
        ]);

        $academyId = $this->currentAcademyId();
        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?? 'UTC');
        $now = CarbonImmutable::now();
        $fromUtc = CarbonImmutable::parse($data['from'], $tz)->startOfDay()->utc();
        $toUtc = CarbonImmutable::parse($data['to'], $tz)->addDay()->startOfDay()->utc();
        $followMinutes = (int) ($data['follow_minutes'] ?? self::DEFAULT_FOLLOW_MINUTES);
        $markMinutes = (int) ($data['mark_minutes'] ?? self::DEFAULT_MARK_MINUTES);

        // Only lessons that have started can be measured; a RESCHEDULED row is the moved-away
        // original and is never anyone's to follow or mark.
        $sessions = DB::table('sessions as se')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->leftJoin('users as mu', 'mu.id', '=', 'se.outcome_set_by')
            ->where('se.academy_id', $academyId)
            ->where('se.status', '!=', 'RESCHEDULED')
            ->where('se.scheduled_at_utc', '>=', $fromUtc->format(self::TS))
            ->where('se.scheduled_at_utc', '<', $toUtc->lessThan($now) ? $toUtc->format(self::TS) : $now->format(self::TS))
            ->orderByDesc('se.scheduled_at_utc')->orderBy('se.id')
            ->limit(self::SESSION_LIMIT + 1)
            ->get([
                'se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status',
                'se.outcome_set_at', 'se.outcome_set_by',
                'st.full_name as student_name', 'te.full_name as teacher_name',
                'mu.full_name as marked_by_name',
            ]);
        $truncated = $sessions->count() > self::SESSION_LIMIT;
        $sessions = $sessions->take(self::SESSION_LIMIT);

        $followUps = $sessions->isEmpty() ? collect() : DB::table('session_follow_ups as f')
            ->leftJoin('users as u', 'u.id', '=', 'f.user_id')
            ->whereIn('f.session_id', $sessions->pluck('id')->all())
            ->orderBy('f.followed_at')
            ->get(['f.session_id', 'f.user_id', 'f.followed_at', 'u.full_name'])
            ->groupBy('session_id');

        $totals = [
            'sessions' => 0,
            'needing_follow' => 0, 'followed' => 0, 'follow_on_time' => 0, 'follow_late' => 0, 'follow_pending' => 0, 'unfollowed' => 0,
            'marked' => 0, 'mark_on_time' => 0, 'mark_late' => 0, 'mark_pending' => 0, 'unmarked' => 0,
        ];
        $followDelays = [];
        $markDelays = [];
        $people = [];
        $rows = [];

        foreach ($sessions as $s) {
            $start = CarbonImmutable::parse($s->scheduled_at_utc)->utc();
            $end = $start->addMinutes((int) $s->duration_minutes);
            $markedAt = $s->outcome_set_at !== null ? CarbonImmutable::parse($s->outcome_set_at)->utc() : null;
            $totals['sessions']++;

            // ── follow clock ───────────────────────────────────────────────────────
            $needsFollow = $markedAt === null || $markedAt->greaterThanOrEqualTo($start);
            $clicks = ($followUps[(string) $s->id] ?? collect())->map(fn (object $f): array => [
                'user_id' => (string) $f->user_id,
                'name' => $f->full_name,
                'followed_at' => CarbonImmutable::parse($f->followed_at)->utc(),
                'delay_minutes' => $this->minutesBetween($start, CarbonImmutable::parse($f->followed_at)),
            ])->values();
            $first = $clicks->first();

            if (! $needsFollow) {
                $followBucket = 'not_needed';
            } elseif ($first !== null) {
                $followBucket = $first['delay_minutes'] <= $followMinutes ? 'on_time' : 'late';
            } elseif ($start->addMinutes($followMinutes)->greaterThan($now)) {
                $followBucket = 'pending';
            } else {
                $followBucket = 'none';
            }

            if ($needsFollow) {
                $totals['needing_follow']++;
                match ($followBucket) {
                    'on_time' => [$totals['followed']++, $totals['follow_on_time']++],
                    'late' => [$totals['followed']++, $totals['follow_late']++],
                    'pending' => $totals['follow_pending']++,
                    default => $totals['unfollowed']++,
                };
                if ($first !== null) {
                    $followDelays[] = max(0, $first['delay_minutes']);
                }
            }

            foreach ($clicks as $click) {
                $person = &$this->person($people, $click['user_id'], $click['name']);
                $person['followed']++;
                $onTime = $click['delay_minutes'] <= $followMinutes;
                $person[$onTime ? 'follow_on_time' : 'follow_late']++;
                $person['follow_delays'][] = max(0, $click['delay_minutes']);
                unset($person);
            }

            // ── mark clock ─────────────────────────────────────────────────────────
            $markDelay = $markedAt !== null ? $this->minutesBetween($end, $markedAt) : null;
            if ($markedAt !== null) {
                $markBucket = $markDelay <= $markMinutes ? 'on_time' : 'late';
                $totals['marked']++;
                $totals[$markBucket === 'on_time' ? 'mark_on_time' : 'mark_late']++;
                $markDelays[] = max(0, $markDelay);

                if ($s->outcome_set_by !== null) {
                    $person = &$this->person($people, (string) $s->outcome_set_by, $s->marked_by_name);
                    $person['marked']++;
                    $person[$markBucket === 'on_time' ? 'mark_on_time' : 'mark_late']++;
                    $person['mark_delays'][] = max(0, $markDelay);
                    unset($person);
                }
            } elseif ($end->addMinutes($markMinutes)->greaterThan($now)) {
                $markBucket = 'pending';
                $totals['mark_pending']++;
            } else {
                $markBucket = 'none';
                $totals['unmarked']++;
            }

            $rows[] = [
                'id' => (string) $s->id,
                'scheduled_at_utc' => $start->toIso8601String(),
                'local_date' => $start->setTimezone($tz)->toDateString(),
                'duration_minutes' => (int) $s->duration_minutes,
                'status' => (string) $s->status,
                'student_name' => $s->student_name,
                'teacher_name' => $s->teacher_name,
                'needs_follow' => $needsFollow,
                'follow_bucket' => $followBucket,
                'followed_at' => $first !== null ? $first['followed_at']->toIso8601String() : null,
                'follow_delay_minutes' => $first !== null ? $first['delay_minutes'] : null,
                'followed_by' => $first !== null ? ['id' => $first['user_id'], 'name' => $first['name']] : null,
                'follow_ups' => $clicks->map(fn (array $c): array => [
                    'user_id' => $c['user_id'],
                    'name' => $c['name'],
                    'followed_at' => $c['followed_at']->toIso8601String(),
                    'delay_minutes' => $c['delay_minutes'],
                ])->all(),
                'mark_bucket' => $markBucket,
                'outcome_set_at' => $markedAt?->toIso8601String(),
                'mark_delay_minutes' => $markDelay,
                'marked_by' => $s->outcome_set_by !== null ? ['id' => (string) $s->outcome_set_by, 'name' => $s->marked_by_name] : null,
            ];
        }

        return response()->json([
            'window' => ['from' => $data['from'], 'to' => $data['to'], 'timezone' => $tz],
            'thresholds' => ['follow_minutes' => $followMinutes, 'mark_minutes' => $markMinutes],
            'totals' => $totals + [
                'avg_follow_delay_minutes' => $this->average($followDelays),
                'avg_mark_delay_minutes' => $this->average($markDelays),
            ],
            'supervisors' => $this->presentPeople($people, $academyId),
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

    /**
     * @param  array<string, array<string, mixed>>  $people
     * @return array<string, mixed>
     */
    private function &person(array &$people, string $userId, ?string $name): array
    {
        if (! isset($people[$userId])) {
            $people[$userId] = [
                'id' => $userId, 'name' => $name,
                'followed' => 0, 'follow_on_time' => 0, 'follow_late' => 0, 'follow_delays' => [],
                'marked' => 0, 'mark_on_time' => 0, 'mark_late' => 0, 'mark_delays' => [],
            ];
        }

        return $people[$userId];
    }

    /**
     * Everyone who followed or marked at least one lesson, with their role — the page lists
     * teachers who mark their own lessons beside supervisors, and the role is how it tells them apart.
     *
     * @param  array<string, array<string, mixed>>  $people
     * @return list<array<string, mixed>>
     */
    private function presentPeople(array $people, string $academyId): array
    {
        if ($people === []) {
            return [];
        }

        $roles = DB::table('user_roles')
            ->where('academy_id', $academyId)
            ->whereIn('user_id', array_keys($people))
            ->get(['user_id', 'role'])
            ->groupBy('user_id')
            ->map(fn ($rows) => $rows->pluck('role')->map(fn ($r) => (string) $r)
                ->sortBy(fn (string $r) => self::ROLE_ORDER[$r] ?? 9)
                ->first());

        $out = array_map(fn (array $p): array => [
            'id' => $p['id'],
            'name' => $p['name'],
            'role' => $roles[$p['id']] ?? null,
            'followed' => $p['followed'],
            'follow_on_time' => $p['follow_on_time'],
            'follow_late' => $p['follow_late'],
            'follow_on_time_rate' => $p['followed'] > 0 ? round($p['follow_on_time'] / $p['followed'] * 100, 1) : null,
            'avg_follow_delay_minutes' => $this->average($p['follow_delays']),
            'marked' => $p['marked'],
            'mark_on_time' => $p['mark_on_time'],
            'mark_late' => $p['mark_late'],
            'mark_on_time_rate' => $p['marked'] > 0 ? round($p['mark_on_time'] / $p['marked'] * 100, 1) : null,
            'avg_mark_delay_minutes' => $this->average($p['mark_delays']),
        ], array_values($people));

        // Supervisors first, busiest first.
        usort($out, fn (array $a, array $b): int => [self::ROLE_ORDER[$a['role']] ?? 9, -($a['followed'] + $a['marked'])]
            <=> [self::ROLE_ORDER[$b['role']] ?? 9, -($b['followed'] + $b['marked'])]);

        return $out;
    }
}
