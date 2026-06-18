<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling\Concerns;

use App\Support\AuthContext;
use App\Support\TimeHelper;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Shared helpers for the Sprint 5 scheduling controllers. Like the people controllers they run
 * inside the current request's tenant context (Owner's academy, or the academy a Super Admin
 * entered) — never cross-tenant — so RLS already scopes every query and is the backstop on
 * every write. The conflict/availability checks here are SOFT guidance only (§3.7): they shape
 * the `warnings` array a response returns, never a hard block.
 */
trait InteractsWithScheduling
{
    protected function ctx(): AuthContext
    {
        return app(AuthContext::class);
    }

    /** The academy this request is scoped to (Owner's home, or the entered academy). */
    protected function currentAcademyId(): string
    {
        $id = $this->ctx()->academyId;
        if ($id === null) {
            abort(403, 'Enter an academy to manage its scheduling.');
        }

        return $id;
    }

    /** The academy's configured IANA timezone (the default for local↔UTC rendering). */
    protected function academyTimezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?? 'UTC');
    }

    /** The teacher row id for the calling user, or null if the user is not a teacher. */
    protected function callerTeacherId(): ?string
    {
        $id = DB::table('teachers')->where('user_id', $this->ctx()->userId)->value('id');

        return $id !== null ? (string) $id : null;
    }

    /**
     * Load a session in the current academy (RLS already scopes to it); a TEACHER is further
     * limited to their OWN sessions (Sprint 2 §3.6) — acting on another teacher's session is a
     * 403, never a cross-academy leak. Owners/Super Admins carry no per-teacher filter.
     */
    protected function findOwnedSession(string $sessionId): object
    {
        $session = DB::table('sessions')->where('id', $sessionId)->first();
        if ($session === null) {
            abort(404, 'Session not found.');
        }

        if ($this->ctx()->role === 'TEACHER') {
            $teacherId = $this->callerTeacherId();
            if ($teacherId === null || (string) $session->teacher_id !== $teacherId) {
                abort(403, 'Not your session.');
            }
        }

        return $session;
    }

    /**
     * Resolve a requested instant from either an explicit UTC ISO string (`scheduled_at_utc`) or
     * a local wall-clock (`local_datetime` + `timezone`), converted per-date so DST is correct.
     */
    protected function resolveInstant(array $data, string $fallbackTimezone): Carbon
    {
        if (! empty($data['scheduled_at_utc'])) {
            return Carbon::parse((string) $data['scheduled_at_utc'])->utc();
        }
        if (! empty($data['local_datetime'])) {
            $tz = $data['timezone'] ?? $fallbackTimezone;

            return TimeHelper::toUtc((string) $data['local_datetime'], (string) $tz);
        }

        throw ValidationException::withMessages([
            'scheduled_at_utc' => ['Provide scheduled_at_utc, or local_datetime with a timezone.'],
        ]);
    }

    /**
     * Sessions of the same teacher whose time-range overlaps [start, start+duration). Used to
     * surface a non-blocking conflict warning on create/reschedule (§3.7, AC-5.8). The
     * candidate row itself is excluded by id.
     *
     * @return list<array{id:string, scheduled_at_utc:string, duration_minutes:int, student_id:string}>
     */
    protected function teacherConflicts(string $teacherId, Carbon $startUtc, int $durationMinutes, ?string $excludeSessionId = null): array
    {
        $endUtc = $startUtc->copy()->addMinutes($durationMinutes);

        $candidates = DB::table('sessions')
            ->where('teacher_id', $teacherId)
            ->whereIn('status', ['SCHEDULED', 'ATTENDED', 'FREE', 'ABSENT_UNEXCUSED', 'ABSENT_EXCUSED'])
            ->when($excludeSessionId !== null, fn ($q) => $q->where('id', '!=', $excludeSessionId))
            // Cheap pre-filter window; exact overlap computed in PHP with per-row duration.
            ->whereBetween('scheduled_at_utc', [
                $startUtc->copy()->subDay()->format('Y-m-d H:i:sP'),
                $endUtc->copy()->addDay()->format('Y-m-d H:i:sP'),
            ])
            ->get(['id', 'scheduled_at_utc', 'duration_minutes', 'student_id']);

        $conflicts = [];
        foreach ($candidates as $row) {
            $rowStart = Carbon::parse($row->scheduled_at_utc)->utc();
            $rowEnd = $rowStart->copy()->addMinutes((int) $row->duration_minutes);
            // Half-open overlap: they conflict unless one ends at/before the other starts.
            if ($startUtc->lessThan($rowEnd) && $rowStart->lessThan($endUtc)) {
                $conflicts[] = [
                    'id' => (string) $row->id,
                    'scheduled_at_utc' => Carbon::parse($row->scheduled_at_utc)->utc()->toIso8601String(),
                    'duration_minutes' => (int) $row->duration_minutes,
                    'student_id' => (string) $row->student_id,
                ];
            }
        }

        return $conflicts;
    }

    /**
     * True when the instant falls OUTSIDE every availability window the teacher declared
     * (Sprint 4 `teachers.availability`). Availability is interpreted in $timezone (the schedule
     * / academy local time). Returns false (no warning) when the teacher declares no windows —
     * an empty availability means "unspecified", not "never available" (§3.7).
     */
    protected function outsideAvailability(string $teacherId, Carbon $startUtc, string $timezone): bool
    {
        $raw = DB::table('teachers')->where('id', $teacherId)->value('availability');
        $windows = is_string($raw) ? (json_decode($raw, true) ?: []) : (array) ($raw ?? []);
        if ($windows === []) {
            return false;
        }

        $local = $startUtc->copy()->setTimezone($timezone);
        $weekday = $local->dayOfWeek; // 0=Sun … 6=Sat
        $minutes = $local->hour * 60 + $local->minute;

        foreach ($windows as $w) {
            $wday = (int) ($w['weekday'] ?? -1);
            $start = $this->minutesOfDay((string) ($w['start_local'] ?? '00:00'));
            $end = $this->minutesOfDay((string) ($w['end_local'] ?? '24:00'));
            if ($end === 0) {
                $end = 1440; // an end of 00:00 (12am) means midnight — the end of the start day.
            }

            if ($end > $start) {
                // Same-day window.
                if ($wday === $weekday && $minutes >= $start && $minutes < $end) {
                    return false; // inside a window → no warning
                }
            } else {
                // Crosses midnight (e.g. 22:00 → 01:00): the evening portion [start, 24:00) sits
                // on `weekday`, while the early-morning tail [00:00, end) lands on the NEXT weekday.
                if ($wday === $weekday && $minutes >= $start) {
                    return false;
                }
                if ((($wday + 1) % 7) === $weekday && $minutes < $end) {
                    return false;
                }
            }
        }

        return true;
    }

    private function minutesOfDay(string $hhmm): int
    {
        [$h, $m] = array_pad(explode(':', $hhmm), 2, '0');

        return ((int) $h) * 60 + (int) $m;
    }

    /**
     * Build the soft-guidance warning list for a candidate instant (conflicts + availability).
     *
     * @return list<array{type:string, message:string, detail?:mixed}>
     */
    protected function schedulingWarnings(string $teacherId, Carbon $startUtc, int $durationMinutes, string $timezone, ?string $excludeSessionId = null): array
    {
        $warnings = [];

        $conflicts = $this->teacherConflicts($teacherId, $startUtc, $durationMinutes, $excludeSessionId);
        if ($conflicts !== []) {
            $warnings[] = [
                'type' => 'conflict',
                'message' => 'This overlaps another session for the same teacher. / يتعارض هذا مع حصة أخرى لنفس المعلّم.',
                'detail' => $conflicts,
            ];
        }

        if ($this->outsideAvailability($teacherId, $startUtc, $timezone)) {
            $warnings[] = [
                'type' => 'availability',
                'message' => "This is outside the teacher's declared availability. / هذا خارج أوقات توفّر المعلّم.",
            ];
        }

        return $warnings;
    }
}
