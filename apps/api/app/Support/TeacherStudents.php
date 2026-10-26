<?php

declare(strict_types=1);

namespace App\Support;

use App\Services\GroupLessonGenerator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * A teacher's own students: an open private assignment (`student_teacher_assignments`) — and, in an
 * academy that runs groups, an open membership in a group they teach (its teacher, or the teacher of
 * any of its lessons — the same rule the group pages scope by). Without this a teacher who only
 * teaches groups had no students at all: an empty list, a 403 on a member's page, nobody to report on.
 *
 * Without `groups` the membership half is never asked, so a private-lesson academy reads exactly as
 * before. Callers are inside a tenant context; RLS scopes every read.
 */
final class TeacherStudents
{
    /** Keep only the teacher's own students in `$query` (students aliased `$alias`). */
    public static function scope(Builder $query, ?string $teacherId, string $academyId, string $alias = 's'): void
    {
        $groups = self::groupsOn($academyId);
        $query->where(function ($w) use ($teacherId, $alias, $groups): void {
            $w->whereExists(fn ($q) => $q->select(DB::raw(1))
                ->from('student_teacher_assignments as ta')
                ->whereColumn('ta.student_id', "{$alias}.id")
                ->whereNull('ta.ended_at')
                ->where('ta.teacher_id', $teacherId));
            if ($groups) {
                $w->orWhereExists(fn ($q) => self::memberships($q->select(DB::raw(1)), $teacherId)->whereColumn('gm.student_id', "{$alias}.id"));
            }
        });
    }

    /** Does the teacher teach this student now (privately, or in one of their groups)? */
    public static function teaches(?string $teacherId, string $studentId, string $academyId): bool
    {
        if ($teacherId === null) {
            return false;
        }
        $private = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)->where('teacher_id', $teacherId)->whereNull('ended_at')
            ->exists();

        return $private || (self::groupsOn($academyId)
            && self::memberships(DB::query()->selectRaw('1'), $teacherId)->where('gm.student_id', $studentId)->exists());
    }

    /** Open memberships (`gm`) of the groups the teacher teaches. */
    private static function memberships(Builder $q, ?string $teacherId): Builder
    {
        return $q->from('class_group_members as gm')
            ->join('class_groups as tg', 'tg.id', '=', 'gm.group_id')
            ->where('gm.status', 'ACTIVE')
            ->where('tg.status', 'ACTIVE')
            ->where(fn ($t) => $t->where('tg.teacher_id', $teacherId)
                ->orWhereExists(fn ($l) => $l->select(DB::raw(1))->from('class_group_lessons as tl')
                    ->whereColumn('tl.group_id', 'tg.id')->where('tl.teacher_id', $teacherId)));
    }

    private static function groupsOn(string $academyId): bool
    {
        return GroupLessonGenerator::enabledFor($academyId);
    }
}
