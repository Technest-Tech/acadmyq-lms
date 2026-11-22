<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\StudentStatus;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Course-only students (`course_students`, Ana Muslim 2026-11-21): a student who joined the academy
 * for one group or course, paid for it, and is gone when it ends. Once the course is over (the group
 * FINISHED or ARCHIVED) the office turns its students into former students in one go, exactly as
 * pressing "deactivate" on each of them would (StudentController::deactivate): reason GRADUATED,
 * everything still running wound down ({@see StudentWindDown}), what they owe kept, every record
 * kept, and "reactivate" brings them back for the next course.
 *
 * Only students with nothing else here move: a student who still has private lessons (a timetable,
 * an open package or block, a priced subscription, a lesson still to come) or another group that is
 * still running stays as they are. An addition beside the existing flows — closing, archiving and
 * deactivating behave exactly as before, for every academy.
 */
final class CourseGraduation
{
    public const CAPABILITY = 'course_students';

    public const GRADUATE = 'GRADUATE';

    /** Already deactivated or removed — nothing to do. */
    public const KEEP_ALREADY_FORMER = 'ALREADY_FORMER';

    /** Still in another group that has not ended. */
    public const KEEP_OTHER_GROUP = 'OTHER_GROUP';

    /** Still has private lessons of their own. */
    public const KEEP_PRIVATE = 'PRIVATE';

    public function __construct(private readonly StudentWindDown $windDown) {}

    /** The course is over: its end date has passed, or the office archived it. */
    public static function courseOver(object $group): bool
    {
        return in_array(ClassGroups::state($group), ['FINISHED', 'ARCHIVED'], true);
    }

    /**
     * Everyone who was ever in the group, with what would happen to them.
     *
     * @return list<array{id: string, full_name: string, outcome: string}>
     */
    public function preview(object $group): array
    {
        $today = ClassGroups::localToday((string) $group->timezone);
        $nowUtc = now()->utc();

        $students = DB::table('class_group_members as m')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->where('m.group_id', $group->id)
            ->groupBy('st.id', 'st.full_name', 'st.deleted_at')
            ->orderBy('st.full_name')
            ->get(['st.id', 'st.full_name', 'st.deleted_at']);

        return $students->map(fn (object $s): array => [
            'id' => (string) $s->id,
            'full_name' => (string) $s->full_name,
            'outcome' => $this->outcomeFor($s, (string) $group->id, $today, $nowUtc),
        ])->values()->all();
    }

    /**
     * Turn the course's course-only students into former students. One transaction: all of them, or
     * none when something fails.
     *
     * @return array{graduated: int, kept: int}
     */
    public function apply(object $group, ?string $actorUserId, ?string $actorRole): array
    {
        $rows = $this->preview($group);
        $moving = array_values(array_filter($rows, fn (array $r): bool => $r['outcome'] === self::GRADUATE));
        $academyId = (string) $group->academy_id;

        $today = ClassGroups::localToday((string) $group->timezone);
        $graduated = [];

        DB::transaction(function () use ($moving, $group, $academyId, $actorUserId, $actorRole, $today, &$graduated): void {
            $now = now();
            foreach ($moving as $row) {
                $id = $row['id'];
                $before = DB::table('students')->where('id', $id)->whereNull('deleted_at')->lockForUpdate()->first();
                // Decided again under the lock: the preview ran before it, and a package opened or a
                // group joined in between must keep the student.
                if ($before === null || $this->outcomeFor($before, (string) $group->id, $today, now()->utc()) !== self::GRADUATE) {
                    continue;
                }
                $graduated[] = $id;

                // The same steps and the same audit entry as StudentController::deactivate, so the
                // student's history reads the same whichever button was pressed.
                $wound = $this->windDown->run($id, Carbon::parse($now), $actorUserId, $actorRole);

                DB::table('students')->where('id', $id)->update([
                    'status' => StudentStatus::GRADUATED,
                    'deleted_at' => $now,
                    'updated_at' => $now,
                ]);

                Audit::log('student.deactivate', 'student', $id, $academyId, $actorUserId, $actorRole,
                    after: [
                        'status' => StudentStatus::GRADUATED,
                        'deleted_at' => $now->toIso8601String(),
                        'course_group_id' => (string) $group->id,
                        'ended_subscription' => $wound['subscription'],
                        'closed_teacher_assignment' => $wound['assignment'],
                        'closed_package' => $wound['package'],
                        'ended_schedules' => $wound['schedules'],
                        'removed_future_sessions' => $wound['sessions_removed'],
                        'cancelled_unmarked_sessions' => $wound['sessions_cancelled'],
                        'hidden_sessions' => $wound['sessions_hidden'],
                        'left_groups' => $wound['groups_left'],
                        'cancelled_trials' => $wound['trials_cancelled'],
                    ],
                    before: ['status' => $before->status]);
            }

            Audit::log('class_group.course_students_graduated', 'class_group', (string) $group->id, $academyId, $actorUserId, $actorRole,
                after: ['student_ids' => $graduated]);
        });

        return ['graduated' => count($graduated), 'kept' => count($rows) - count($graduated)];
    }

    private function outcomeFor(object $student, string $groupId, string $today, Carbon $nowUtc): string
    {
        if ($student->deleted_at !== null) {
            return self::KEEP_ALREADY_FORMER;
        }
        $id = (string) $student->id;

        // Another group still running (or still to start) that they are in.
        $otherGroup = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->where('m.student_id', $id)
            ->where('m.group_id', '<>', $groupId)
            ->where('m.status', 'ACTIVE')
            ->where('g.status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('g.end_date')->orWhere('g.end_date', '>=', $today))
            ->exists();
        if ($otherGroup) {
            return self::KEEP_OTHER_GROUP;
        }

        $private = DB::table('schedules')->where('student_id', $id)->where('is_active', true)->whereNull('deleted_at')->exists()
            || DB::table('lesson_packages')->where('student_id', $id)->where('status', 'ACTIVE')->exists()
            || DB::table('centre_subscriptions')->where('student_id', $id)->where('status', 'OPEN')->exists()
            // A free plan with no timetable bills nothing and teaches nothing; a priced one is a learner.
            || DB::table('subscriptions')->where('student_id', $id)->where('status', 'ACTIVE')->whereNull('deleted_at')
                ->where(fn ($q) => $q->whereNull('price_basis')->orWhere('price_basis', '<>', 'FREE'))->exists()
            || DB::table('sessions')->where('student_id', $id)->where('status', 'SCHEDULED')
                ->where('scheduled_at_utc', '>=', $nowUtc)->exists()
            // A trial booked for them is a private lesson in waiting: the wind-down would cancel it.
            || DB::table('trials')->where('student_id', $id)->where('status', 'SCHEDULED')->whereNull('deleted_at')->exists();

        return $private ? self::KEEP_PRIVATE : self::GRADUATE;
    }
}
