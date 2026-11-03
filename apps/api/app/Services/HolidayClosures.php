<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\SessionStatus;
use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * What a centre's holiday does to the lessons already on the board (docs/centre-profile, Phase 2 §3).
 * Generation stops on a closed date through {@see Holidays}; this is the other half — the lessons
 * generated before anyone declared the holiday, and the ones to bring back when it is removed.
 *
 * THE RULE
 *   - Declaring a holiday cancels every PENDING lesson whose academy-local date is inside it and is
 *     today or later: a group lesson through {@see ClassGroups::cancel()} (status CANCELLED, reason
 *     HOLIDAY), a private lesson through {@see AttendanceService::record()} as CANCELLED_BY_TEACHER
 *     with status_reason HOLIDAY — the one non-billable cancellation the status model has, so no
 *     student is charged and no teacher is paid for a day the centre was shut. A lesson already
 *     held, cancelled or moved is history and is not touched; neither is anything before today.
 *   - Removing a holiday restores exactly what it cancelled: lessons carrying the HOLIDAY marker,
 *     dated inside it, today or later, and NOT inside another holiday still standing (overlaps are
 *     allowed; the surviving one keeps its days closed). A group lesson goes back through
 *     {@see ClassGroups::revert()}, a private one through {@see AttendanceService::revert()}, so
 *     each is SCHEDULED again with nothing recorded against it. The generator then fills in any date
 *     it skipped while the holiday stood.
 *   - Today counts as "still to come" both ways: a lesson at 10:00 declared off at 14:00 was a
 *     closed day; the same lesson restored at 14:00 is a sheet the centre still owes.
 *
 * The HOLIDAY marker is plain text in the existing reason columns (no CHECK constraint on either),
 * which is what lets the web show an "أجازة" badge and lets the restore find its own rows.
 *
 * Runs inside the caller's tenant context; callers wrap apply/lift in one DB::transaction.
 */
final class HolidayClosures
{
    public const REASON = 'HOLIDAY';

    public function __construct(
        private readonly ClassGroups $groups,
        private readonly AttendanceService $attendance,
    ) {}

    /**
     * How many lessons declaring this range would cancel — the confirm step's numbers.
     *
     * @return array{group_lessons:int, sessions:int}
     */
    public function preview(string $academyId, string $startsOn, string $endsOn): array
    {
        return [
            'group_lessons' => $this->pendingGroupLessons($academyId, $startsOn, $endsOn)->count(),
            'sessions' => $this->pendingSessions($academyId, $startsOn, $endsOn)->count(),
        ];
    }

    /**
     * Insert the holiday and cancel the pending lessons inside it.
     *
     * @return array{id:string, group_lessons:int, sessions:int}
     */
    public function apply(string $academyId, string $name, string $startsOn, string $endsOn, string $actorUserId, string $actorRole): array
    {
        $id = (string) Str::uuid();
        DB::table('academy_holidays')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'name' => $name,
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'created_by' => DB::table('users')->where('id', $actorUserId)->exists() ? $actorUserId : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $groupLessons = 0;
        foreach ($this->pendingGroupLessons($academyId, $startsOn, $endsOn)->orderBy('scheduled_at_utc')->get() as $lesson) {
            $this->groups->cancel($lesson, self::REASON, $actorUserId, $actorRole);
            $groupLessons++;
        }

        $sessions = 0;
        foreach ($this->pendingSessions($academyId, $startsOn, $endsOn)->orderBy('scheduled_at_utc')->get() as $session) {
            $this->attendance->record($session, SessionStatus::CancelledByTeacher, self::REASON, $actorUserId, $actorRole, false, false);
            $sessions++;
        }

        Audit::log('academy_holiday.created', 'academy_holiday', $id, $academyId, $actorUserId, $actorRole, after: [
            'name' => $name, 'starts_on' => $startsOn, 'ends_on' => $endsOn,
            'cancelled' => ['group_lessons' => $groupLessons, 'sessions' => $sessions],
        ]);

        return ['id' => $id, 'group_lessons' => $groupLessons, 'sessions' => $sessions];
    }

    /**
     * Delete the holiday and bring back what it cancelled that is still to come and not inside
     * another holiday.
     *
     * @return array{group_lessons:int, sessions:int}
     */
    public function lift(object $holiday, string $actorUserId, string $actorRole): array
    {
        $academyId = (string) $holiday->academy_id;
        $startsOn = substr((string) $holiday->starts_on, 0, 10);
        $endsOn = substr((string) $holiday->ends_on, 0, 10);

        DB::table('academy_holidays')->where('id', $holiday->id)->delete();

        $groupLessons = 0;
        $lessons = DB::table('class_group_lessons')
            ->where('academy_id', $academyId)
            ->where('status', 'CANCELLED')
            ->where('cancel_reason', self::REASON)
            ->whereBetween('occurrence_local_date', [$startsOn, $endsOn])
            ->where('occurrence_local_date', '>=', $this->today($academyId))
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('academy_holidays as h')
                ->whereColumn('h.academy_id', 'class_group_lessons.academy_id')
                ->whereRaw('class_group_lessons.occurrence_local_date between h.starts_on and h.ends_on'))
            ->orderBy('scheduled_at_utc')
            ->get();
        foreach ($lessons as $lesson) {
            $this->groups->revert($lesson, $actorUserId, $actorRole);
            $groupLessons++;
        }

        $sessions = 0;
        $tz = $this->timezone($academyId);
        $rows = DB::table('sessions')
            ->where('academy_id', $academyId)
            ->where('status', SessionStatus::CancelledByTeacher->value)
            ->where('status_reason', self::REASON)
            ->whereNull('hidden_at')
            ->whereRaw('(scheduled_at_utc at time zone ?)::date between ?::date and ?::date', [$tz, $startsOn, $endsOn])
            ->whereRaw('(scheduled_at_utc at time zone ?)::date >= ?::date', [$tz, $this->today($academyId)])
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('academy_holidays as h')
                ->whereColumn('h.academy_id', 'sessions.academy_id')
                ->whereRaw('(sessions.scheduled_at_utc at time zone ?)::date between h.starts_on and h.ends_on', [$tz]))
            ->orderBy('scheduled_at_utc')
            ->get();
        foreach ($rows as $session) {
            $this->attendance->revert($session, $actorUserId, $actorRole);
            $sessions++;
        }

        Audit::log('academy_holiday.deleted', 'academy_holiday', (string) $holiday->id, $academyId, $actorUserId, $actorRole,
            before: ['name' => (string) $holiday->name, 'starts_on' => $startsOn, 'ends_on' => $endsOn],
            after: ['restored' => ['group_lessons' => $groupLessons, 'sessions' => $sessions]]);

        return ['group_lessons' => $groupLessons, 'sessions' => $sessions];
    }

    /**
     * The holidays as the settings card lists them, each with what still stands cancelled in its days.
     *
     * @return list<array{id:string, name:string, starts_on:string, ends_on:string, cancelled:array{group_lessons:int, sessions:int}, created_at:string}>
     */
    public function listFor(string $academyId): array
    {
        $tz = $this->timezone($academyId);

        return DB::table('academy_holidays as h')
            ->where('h.academy_id', $academyId)
            ->select(['h.id', 'h.name', 'h.starts_on', 'h.ends_on', 'h.created_at'])
            ->selectRaw(<<<'SQL'
                (select count(*) from class_group_lessons l
                  where l.academy_id = h.academy_id and l.status = 'CANCELLED' and l.cancel_reason = ?
                    and l.occurrence_local_date between h.starts_on and h.ends_on) as group_lessons
            SQL, [self::REASON])
            ->selectRaw(<<<'SQL'
                (select count(*) from sessions s
                  where s.academy_id = h.academy_id and s.status = ? and s.status_reason = ? and s.hidden_at is null
                    and (s.scheduled_at_utc at time zone ?)::date between h.starts_on and h.ends_on) as sessions
            SQL, [SessionStatus::CancelledByTeacher->value, self::REASON, $tz])
            ->orderByDesc('h.starts_on')
            ->get()
            ->map(fn ($h) => [
                'id' => (string) $h->id,
                'name' => (string) $h->name,
                'starts_on' => substr((string) $h->starts_on, 0, 10),
                'ends_on' => substr((string) $h->ends_on, 0, 10),
                'cancelled' => ['group_lessons' => (int) $h->group_lessons, 'sessions' => (int) $h->sessions],
                'created_at' => Carbon::parse($h->created_at)->utc()->toIso8601String(),
            ])
            ->values()
            ->all();
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Pending group lessons dated inside the range, today or later. */
    private function pendingGroupLessons(string $academyId, string $startsOn, string $endsOn)
    {
        return DB::table('class_group_lessons')
            ->where('academy_id', $academyId)
            ->where('status', 'SCHEDULED')
            ->whereBetween('occurrence_local_date', [$startsOn, $endsOn])
            ->where('occurrence_local_date', '>=', $this->today($academyId));
    }

    /** Pending private lessons dated (academy-local) inside the range, today or later. */
    private function pendingSessions(string $academyId, string $startsOn, string $endsOn)
    {
        $tz = $this->timezone($academyId);

        return DB::table('sessions')
            ->where('academy_id', $academyId)
            ->where('status', SessionStatus::Scheduled->value)
            ->whereNull('hidden_at')
            ->whereRaw('(scheduled_at_utc at time zone ?)::date between ?::date and ?::date', [$tz, $startsOn, $endsOn])
            ->whereRaw('(scheduled_at_utc at time zone ?)::date >= ?::date', [$tz, $this->today($academyId)]);
    }

    private function today(string $academyId): string
    {
        return Carbon::now($this->timezone($academyId))->format('Y-m-d');
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
    }
}
