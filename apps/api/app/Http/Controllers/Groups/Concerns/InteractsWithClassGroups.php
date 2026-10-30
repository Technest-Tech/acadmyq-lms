<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups\Concerns;

use App\Domain\OutcomeLock;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Shared loading + row-scoping for the group-class controllers (docs/groups). RLS already confines
 * every query to the request's academy; on top of that a TEACHER reaches only the groups they
 * teach — the group's own teacher, or the substitute on one of its lessons — and only the lessons
 * they teach or that belong to a group of theirs. Anything else is a 403, never a leak.
 */
trait InteractsWithClassGroups
{
    use InteractsWithScheduling;

    protected function isTeacher(): bool
    {
        return $this->ctx()->role === 'TEACHER';
    }

    /** The caller's teacher row, or a 403 for a TEACHER login without one. */
    protected function ownTeacherId(): string
    {
        $id = $this->callerTeacherId();
        if ($id === null) {
            abort(403, 'No teacher record for this user.');
        }

        return $id;
    }

    /** Narrow a `class_groups as g` query to the caller's own groups when they are a TEACHER. */
    protected function scopeGroupsToCaller(Builder $query): Builder
    {
        if (! $this->isTeacher()) {
            return $query;
        }

        $teacherId = $this->ownTeacherId();

        return $query->where(function ($q) use ($teacherId): void {
            $q->where('g.teacher_id', $teacherId)
                ->orWhereExists(function ($e) use ($teacherId): void {
                    $e->select(DB::raw(1))
                        ->from('class_group_lessons as tl')
                        ->whereColumn('tl.group_id', 'g.id')
                        ->where('tl.teacher_id', $teacherId);
                });
        });
    }

    protected function findGroup(string $groupId): object
    {
        $group = $this->scopeGroupsToCaller(DB::table('class_groups as g')->where('g.id', $groupId))
            ->select('g.*')
            ->first();

        if ($group === null) {
            // Distinguish "not yours" from "not there" only for people who could see it at all.
            abort($this->isTeacher() && DB::table('class_groups')->where('id', $groupId)->exists() ? 403 : 404,
                'Group not found.');
        }

        return $group;
    }

    protected function findLesson(string $lessonId): object
    {
        $lesson = DB::table('class_group_lessons')->where('id', $lessonId)->first();
        if ($lesson === null) {
            abort(404, 'Lesson not found.');
        }

        if ($this->isTeacher()) {
            $teacherId = $this->ownTeacherId();
            $groupTeacher = (string) DB::table('class_groups')->where('id', $lesson->group_id)->value('teacher_id');
            if ((string) $lesson->teacher_id !== $teacherId && $groupTeacher !== $teacherId) {
                abort(403, 'Not your lesson.');
            }
        }

        return $lesson;
    }

    /** A teacher who exists and is not deactivated — the only kind a group may be given. */
    protected function assertActiveTeacher(string $teacherId): void
    {
        if (DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown or inactive teacher. / معلّم غير موجود أو غير نشط.']]);
        }
    }

    /** The lesson as the API returns it. */
    protected function presentLesson(object $l, ?array $counts = null): array
    {
        return [
            'id' => (string) $l->id,
            'group_id' => (string) $l->group_id,
            'teacher_id' => (string) $l->teacher_id,
            'teacher_name' => $l->teacher_name ?? DB::table('teachers')->where('id', $l->teacher_id)->value('full_name'),
            'slot_id' => $l->slot_id !== null ? (string) $l->slot_id : null,
            'occurrence_local_date' => Carbon::parse($l->occurrence_local_date)->format('Y-m-d'),
            'scheduled_at_utc' => Carbon::parse($l->scheduled_at_utc)->utc()->toIso8601String(),
            'duration_minutes' => (int) $l->duration_minutes,
            'status' => (string) $l->status,
            'cancel_reason' => $l->cancel_reason,
            'moved' => $l->moved_at !== null,
            'extra' => (bool) $l->is_extra,
            'topic' => $l->topic,
            'homework' => $l->homework,
            'notes' => $l->notes,
            'outcome_set_at' => $l->outcome_set_at !== null ? Carbon::parse($l->outcome_set_at)->utc()->toIso8601String() : null,
            // The office saved this sheet: the calling teacher may read it but not change or undo it.
            'outcome_locked' => OutcomeLock::locks($this->ctx()->role, $this->ctx()->userId, (string) $l->status === 'SCHEDULED',
                isset($l->outcome_set_by) ? (string) $l->outcome_set_by : null),
            'counts' => $counts,
        ];
    }

    /**
     * Sheet counts for each lesson id: what the sheet recorded, and how many students the lesson
     * expects (members covering its date; never fewer than the rows already on the sheet).
     *
     * @param  list<string>  $lessonIds
     * @return array<string, array{present:int, late:int, absent:int, excused:int, marked:int, expected:int}>
     */
    protected function lessonCounts(array $lessonIds): array
    {
        if ($lessonIds === []) {
            return [];
        }

        $rows = DB::table('class_group_lessons as l')
            ->whereIn('l.id', $lessonIds)
            ->select('l.id')
            ->selectRaw("(select count(*) from class_group_attendance a where a.lesson_id = l.id and a.status = 'PRESENT') as present")
            ->selectRaw("(select count(*) from class_group_attendance a where a.lesson_id = l.id and a.status = 'LATE') as late")
            ->selectRaw("(select count(*) from class_group_attendance a where a.lesson_id = l.id and a.status = 'ABSENT') as absent")
            ->selectRaw("(select count(*) from class_group_attendance a where a.lesson_id = l.id and a.status = 'EXCUSED') as excused")
            ->selectRaw(<<<'SQL'
                (select count(*) from class_group_members m
                   join students st on st.id = m.student_id
                  where m.group_id = l.group_id
                    and m.joined_on <= l.occurrence_local_date
                    and (m.left_on is null or m.left_on > l.occurrence_local_date)
                    and st.deleted_at is null
                    and not exists (select 1 from class_group_lesson_removals r
                                     where r.lesson_id = l.id and r.student_id = m.student_id)) as members
            SQL)
            ->get();

        $out = [];
        foreach ($rows as $r) {
            $marked = (int) $r->present + (int) $r->late + (int) $r->absent + (int) $r->excused;
            $out[(string) $r->id] = [
                'present' => (int) $r->present,
                'late' => (int) $r->late,
                'absent' => (int) $r->absent,
                'excused' => (int) $r->excused,
                'marked' => $marked,
                'expected' => max($marked, (int) $r->members),
            ];
        }

        return $out;
    }
}
