<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use App\Services\ClassGroups;
use App\Support\Audit;
use App\Support\TimeHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * One group lesson (docs/groups §Attendance): its sheet, and what can be done to it.
 *
 *   - the sheet is saved by whoever marks private lessons (`session.mark_attendance`) — a TEACHER
 *     only on their own lessons — and taken back by whoever reverts them (`session.revert_attendance`);
 *   - cancelling, moving or re-teachering a lesson is running the group (`group.manage`).
 *
 * A cancellation applies to the whole class by construction — there is one row, not one per
 * student. The same timing gate as a private lesson stops a future lesson being marked held; an
 * owner may override it, audited.
 */
final class ClassGroupLessonController extends Controller
{
    use InteractsWithClassGroups;

    public function __construct(private readonly ClassGroups $groups) {}

    /** GET /api/group-lessons/{id} — the lesson, its group and the sheet (who it expects, and what was marked). */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('group.read');

        return response()->json($this->payload($this->findLesson($id)));
    }

    /**
     * POST /api/group-lessons/{id}/attendance — save the sheet and mark the lesson HELD. Anyone the
     * lesson expects who is not listed is PRESENT, so the common case is "send the absentees".
     */
    public function attendance(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.read');
        Gate::authorize('session.mark_attendance');

        $lesson = $this->findLesson($id);
        $data = $request->validate([
            'entries' => ['sometimes', 'array', 'max:500'],
            'entries.*.student_id' => ['required', 'uuid'],
            'entries.*.status' => ['required', Rule::in(ClassGroups::ATTENDANCE_STATUSES)],
            'entries.*.note' => ['sometimes', 'nullable', 'string', 'max:500'],
            'topic' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'homework' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'override_timing' => ['sometimes', 'boolean'],
        ]);

        $this->assertTimingAllowed($lesson, (bool) ($data['override_timing'] ?? false));

        $this->groups->saveAttendance(
            $lesson,
            $data['entries'] ?? [],
            array_intersect_key($data, array_flip(['topic', 'homework', 'notes'])),
            $this->ctx()->userId,
            $this->ctx()->role,
        );

        return response()->json($this->payload($this->reload($id)));
    }

    /** POST /api/group-lessons/{id}/attendance/revert — back to pending; the sheet is cleared. */
    public function revert(string $id): JsonResponse
    {
        Gate::authorize('group.read');
        Gate::authorize('session.revert_attendance');

        $this->groups->revert($this->findLesson($id), $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->payload($this->reload($id)));
    }

    /** POST /api/group-lessons/{id}/cancel — the whole class is off for this lesson. */
    public function cancel(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $data = $request->validate(['reason' => ['sometimes', 'nullable', 'string', 'max:500']]);
        $this->groups->cancel($this->findLesson($id), $data['reason'] ?? null, $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->payload($this->reload($id)));
    }

    /**
     * POST /api/group-lessons/{id}/reschedule — move one pending lesson (time, length and/or the
     * teacher taking it). The lesson is stamped as moved, so a later timetable edit never drags it
     * back to its slot. Conflict warnings are advice, never a block.
     */
    public function reschedule(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $lesson = $this->findLesson($id);
        if ($lesson->status !== 'SCHEDULED') {
            throw ValidationException::withMessages([
                'status' => ['Only a pending lesson can be moved; undo its outcome first. / يمكن نقل الحصة المعلّقة فقط؛ تراجع عن نتيجتها أولاً.'],
            ]);
        }

        $data = $request->validate([
            'local_datetime' => ['sometimes', 'nullable', 'date_format:Y-m-d H:i'],
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64', 'timezone'],
            'duration_minutes' => ['sometimes', 'integer', 'min:1', 'max:600'],
            'teacher_id' => ['sometimes', 'uuid'],
        ]);

        $group = DB::table('class_groups')->where('id', $lesson->group_id)->first();
        $tz = $data['timezone'] ?? (string) $group->timezone;
        $start = ! empty($data['local_datetime'])
            ? TimeHelper::toUtc($data['local_datetime'].':00', $tz)
            : Carbon::parse($lesson->scheduled_at_utc)->utc();
        $duration = (int) ($data['duration_minutes'] ?? $lesson->duration_minutes);
        $teacherId = $data['teacher_id'] ?? (string) $lesson->teacher_id;
        $this->assertActiveTeacher($teacherId);

        DB::table('class_group_lessons')->where('id', $id)->update([
            'scheduled_at_utc' => $start->format('Y-m-d H:i:sP'),
            'duration_minutes' => $duration,
            'teacher_id' => $teacherId,
            'moved_at' => now()->toIso8601String(),
            'updated_at' => now(),
        ]);

        Audit::log('class_group_lesson.rescheduled', 'class_group_lesson', $id, (string) $lesson->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['scheduled_at_utc' => $start->toIso8601String(), 'duration_minutes' => $duration, 'teacher_id' => $teacherId],
            before: [
                'scheduled_at_utc' => Carbon::parse($lesson->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $lesson->duration_minutes,
                'teacher_id' => (string) $lesson->teacher_id,
            ]);

        return response()->json($this->payload($this->reload($id)) + [
            'warnings' => $this->schedulingWarnings($teacherId, $start, $duration, $tz, excludeGroupLessonId: $id),
        ]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function reload(string $id): object
    {
        return DB::table('class_group_lessons')->where('id', $id)->first();
    }

    /** @return array{lesson: array, group: array, roster: list<array>} */
    private function payload(object $lesson): array
    {
        $group = DB::table('class_groups as g')
            ->leftJoin('teachers as te', 'te.id', '=', 'g.teacher_id')
            ->where('g.id', $lesson->group_id)
            ->first(['g.id', 'g.name', 'g.level', 'g.timezone', 'g.status', 'g.mode', 'g.location', 'g.meeting_url', 'g.teacher_id', 'te.meeting_url as teacher_meeting_url']);

        $lessonTeacherUrl = DB::table('teachers')->where('id', $lesson->teacher_id)->value('meeting_url');

        return [
            'lesson' => $this->presentLesson($lesson, $this->lessonCounts([(string) $lesson->id])[(string) $lesson->id] ?? null),
            'group' => [
                'id' => (string) $group->id,
                'name' => (string) $group->name,
                'level' => $group->level,
                'timezone' => (string) $group->timezone,
                'status' => (string) $group->status,
                'mode' => (string) $group->mode,
                'location' => $group->location,
                // The group's own link wins; else whoever is taking THIS lesson (a substitute's room).
                'meeting_url' => $group->meeting_url ?? $lessonTeacherUrl ?? $group->teacher_meeting_url,
            ],
            'roster' => $this->groups->roster($lesson)->map(fn ($r) => [
                'student_id' => $r->student_id,
                'full_name' => $r->full_name,
                'status' => $r->status,
                'note' => $r->note,
                'member' => $r->member,
            ])->values()->all(),
        ];
    }

    /**
     * The private lesson's timing gate (AttendanceController::assertTimingAllowed): a lesson that
     * has not started yet cannot be marked held. An owner may override it, and that is audited.
     */
    private function assertTimingAllowed(object $lesson, bool $override): void
    {
        $grace = (int) config('attendance.grace_minutes', 0);
        $start = Carbon::parse($lesson->scheduled_at_utc)->utc();

        if (now()->lt($start->copy()->subMinutes($grace))) {
            $isOwner = in_array($this->ctx()->role, ['ACADEMY_OWNER', 'SUPER_ADMIN'], true);
            if (! ($override && $isOwner)) {
                throw ValidationException::withMessages([
                    'status' => ['This lesson has not started yet; attendance cannot be recorded. / لم تبدأ هذه الحصة بعد، لا يمكن تسجيل الحضور.'],
                ]);
            }

            Audit::log('class_group_lesson.attendance_override', 'class_group_lesson', (string) $lesson->id, (string) $lesson->academy_id,
                $this->ctx()->userId, $this->ctx()->role, after: ['scheduled_at_utc' => $start->toIso8601String(), 'override' => true]);
        }
    }
}
