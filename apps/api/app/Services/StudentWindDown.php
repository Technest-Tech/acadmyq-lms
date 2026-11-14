<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Everything still running for a student who is leaving the academy, wound down in one place —
 * shared by deactivate, the recoverable delete (and through it deleting a whole family), and the
 * `students:finish-removal` repair for students removed before a piece of this existed.
 *
 * Without it a removed student kept a live package, kept generating lessons, and their unmarked
 * lessons sat in الحصص المعلقة, fired "not marked" group alerts and docked the teacher forever; a
 * trial booked for them stayed on the trials board and the calendar.
 *
 * Every step is idempotent: run again on a student already wound down, it finds nothing to do.
 * Money is not let go here — the delete does that itself ({@see ChargeCancellation::letGoAllOf()}),
 * because deactivate keeps what is owed.
 */
final class StudentWindDown
{
    public const REASON = 'Student removed from the academy';

    public function __construct(
        private readonly SessionGenerator $generator,
        private readonly LessonPackages $packages,
        private readonly CentreSubscriptions $centreSubscriptions,
        private readonly ClassGroups $groups,
    ) {}

    /**
     * @return array{subscription: bool, assignment: bool, package: ?string, groups_left: int, trials_cancelled: int, schedules: int, sessions_removed: int, sessions_cancelled: int, sessions_hidden: int}
     */
    public function run(string $studentId, Carbon $now, ?string $actorUserId, ?string $actorRole, bool $closeBlocks = true): array
    {
        $package = null;
        // `closeBlocks` false: the repair of an old removal leaves open packages / centre blocks to a
        // separate, deliberate pass — closing one bills the hours it used, months after the fact.
        if ($closeBlocks) {
            // The package first, while the subscription that describes it is still ACTIVE.
            $package = $this->closeOpenPackages($studentId, $actorUserId, $actorRole);
            // A centre's blocks in lessons stop with them (docs/centre-profile/01-*).
            $this->centreSubscriptions->windDown($studentId, 'STUDENT_REMOVED', $actorUserId, $actorRole);
        }

        $endedSubscription = DB::table('subscriptions')
            ->where('student_id', $studentId)->where('status', 'ACTIVE')->whereNull('deleted_at')
            ->update(['status' => 'ENDED', 'updated_at' => $now]);

        $closedAssignment = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)->whereNull('ended_at')
            ->update(['ended_at' => $now, 'updated_at' => $now]);

        return [
            'subscription' => $endedSubscription > 0,
            'assignment' => $closedAssignment > 0,
            'package' => $package,
            // Group classes: they stop being expected on any sheet from today (docs/groups).
            'groups_left' => $this->groups->leaveAllFor($studentId, self::REASON),
            'trials_cancelled' => $this->cancelBookedTrials($studentId, $now),
        ] + $this->windDownLessons($studentId, $now, $actorUserId);
    }

    /**
     * Close the student's open lesson packages. An untouched one is voided; one with hours already
     * used is closed the way an owner closes one early, so ON_COMPLETION still bills what was
     * actually consumed. Returns what happened (CANCELLED / COMPLETED) or null when none was open.
     */
    private function closeOpenPackages(string $studentId, ?string $actorUserId, ?string $actorRole): ?string
    {
        $outcome = null;
        // Every open block — a centre's student may hold one per subject.
        while (($package = $this->packages->anyActiveFor($studentId)) !== null) {
            // Minutes absorbed from the previous block's last lesson are not this package's own use.
            if ((int) $package->minutes_consumed - (int) $package->absorbed_overdraft_minutes === 0) {
                $this->packages->cancel((string) $package->id, 'STUDENT_REMOVED', $actorUserId, $actorRole);
                $outcome ??= 'CANCELLED';

                continue;
            }

            $this->packages->complete((string) $package->id, 'STUDENT_REMOVED', $actorUserId, $actorRole);
            $outcome = 'COMPLETED';
        }

        return $outcome;
    }

    /**
     * A trial still booked for them (the trials board, the calendar, "needs a decision") is
     * cancelled: there is nobody left to hold it for. Held / converted trials are history and stay.
     */
    private function cancelBookedTrials(string $studentId, Carbon $now): int
    {
        return DB::table('trials')
            ->where('student_id', $studentId)
            ->where('status', 'SCHEDULED')
            ->whereNull('deleted_at')
            ->update(['status' => 'CANCELLED', 'updated_at' => $now]);
    }

    /**
     * Stop the timetable and clear every lesson still sitting in SCHEDULED. The schedule is ended
     * exactly as DELETE /students/{id}/schedule ends it (future untouched rows are removed by the
     * generator). Whatever is left — past lessons nobody marked, ad-hoc lessons, reschedule
     * successors — is closed as cancelled-by-student, which neither bills nor pays, and any
     * request still waiting on those lessons is rejected so it leaves the approvals queue.
     *
     * @return array{schedules: int, sessions_removed: int, sessions_cancelled: int, sessions_hidden: int}
     */
    private function windDownLessons(string $studentId, Carbon $now, ?string $actorUserId): array
    {
        $scheduleIds = DB::table('schedules')
            ->where('student_id', $studentId)
            ->where(fn ($q) => $q->where('is_active', true)->orWhereNull('deleted_at'))
            ->pluck('id');

        $removed = 0;
        if ($scheduleIds->isNotEmpty()) {
            DB::table('schedules')->whereIn('id', $scheduleIds)->update(['is_active' => false, 'updated_at' => $now]);
            DB::table('schedules')->whereIn('id', $scheduleIds)->whereNull('deleted_at')->update(['deleted_at' => $now]);

            [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
            foreach ($scheduleIds as $scheduleId) {
                $removed += $this->generator->generateForSchedule((string) $scheduleId, $windowStart, $windowEnd)['removed'];
            }
        }

        $leftover = DB::table('sessions')
            ->where('student_id', $studentId)
            ->where('status', 'SCHEDULED')
            ->pluck('id');

        if ($leftover->isNotEmpty()) {
            DB::table('session_cancellation_requests')
                ->whereIn('session_id', $leftover)
                ->where('status', 'PENDING')
                ->update([
                    'status' => 'REJECTED',
                    'decided_by_user_id' => $actorUserId,
                    'decided_at' => $now,
                    'decision_note' => self::REASON,
                    'updated_at' => $now,
                ]);

            DB::table('sessions')->whereIn('id', $leftover)->update([
                'status' => 'CANCELLED_BY_STUDENT',
                'status_reason' => self::REASON,
                'updated_at' => $now,
            ]);
        }

        // Every lesson they ever had — attended, cancelled, the ones just closed above — leaves the
        // calendar and the attendance page. Display only: billing and payroll still read the rows.
        // Reactivation does NOT bring them back, so a returning student starts over.
        $hidden = DB::table('sessions')
            ->where('student_id', $studentId)
            ->whereNull('hidden_at')
            ->update(['hidden_at' => $now->toIso8601String()]);

        return [
            'schedules' => $scheduleIds->count(),
            'sessions_removed' => $removed,
            'sessions_cancelled' => $leftover->count(),
            'sessions_hidden' => $hidden,
        ];
    }
}
