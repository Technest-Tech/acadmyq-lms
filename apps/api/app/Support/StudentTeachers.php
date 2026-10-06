<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Who teaches a student right now. A student may have several teachers at once — one per course
 * (Qur'an with one, Arabic with another) — and each pair is an open row in
 * `student_teacher_assignments` (`ended_at` null; at most one per pair, sta_one_active_per_pair).
 *
 * Every question the app asks about "the student's teacher" goes through here, so none of them
 * quietly assumes there is exactly one. Callers are already inside a tenant context; RLS scopes
 * every read.
 */
final class StudentTeachers
{
    /**
     * The open links for a student, oldest first — the order they were taken on in; teachers added
     * together (one create form) fall back to name order, so the list never shuffles.
     *
     * @return Collection<int, object{teacher_id: string, teacher_name: ?string, course: ?string, started_at: string}>
     */
    public static function active(string $studentId): Collection
    {
        return DB::table('student_teacher_assignments as a')
            ->leftJoin('teachers as t', 't.id', '=', 'a.teacher_id')
            ->where('a.student_id', $studentId)
            ->whereNull('a.ended_at')
            ->orderBy('a.started_at')
            ->orderBy('t.full_name')
            ->orderBy('a.id')
            ->get(['a.teacher_id', 't.full_name as teacher_name', 'a.course', 'a.started_at']);
    }

    /** @return list<string> */
    public static function activeIds(string $studentId): array
    {
        return self::active($studentId)->pluck('teacher_id')->map(fn ($id) => (string) $id)->all();
    }

    public static function teaches(string $studentId, string $teacherId): bool
    {
        return DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)
            ->where('teacher_id', $teacherId)
            ->whereNull('ended_at')
            ->exists();
    }

    /**
     * The teacher to use when a caller did not name one: the student's only teacher, or null when
     * they have none. With two or more there is no right default, so it refuses rather than guess —
     * a lesson silently landing on the wrong teacher is a payroll error.
     */
    public static function defaultFor(string $studentId, string $field = 'teacher_id'): ?string
    {
        $ids = self::activeIds($studentId);
        if (count($ids) > 1) {
            throw ValidationException::withMessages([
                $field => ['This student has more than one teacher — choose which one. / لهذا الطالب أكثر من معلّم، اختر المعلّم المقصود.'],
            ]);
        }

        return $ids[0] ?? null;
    }

    /**
     * One row per student with an open link, for list queries to left-join: the first teacher's
     * id (for callers that still want one), every name joined for display, and the full set as
     * JSON. Aggregated so a student with three teachers is still ONE row in a list.
     */
    public static function summary(): Builder
    {
        return DB::table('student_teacher_assignments as a')
            ->leftJoin('teachers as t', 't.id', '=', 'a.teacher_id')
            ->whereNull('a.ended_at')
            ->groupBy('a.student_id')
            ->select([
                'a.student_id',
                DB::raw('(array_agg(a.teacher_id order by a.started_at, t.full_name, a.id))[1] as teacher_id'),
                DB::raw("string_agg(t.full_name, ', ' order by a.started_at, t.full_name, a.id) as teacher_name"),
                DB::raw("json_agg(json_build_object('teacher_id', a.teacher_id, 'teacher_name', t.full_name, 'course', a.course) order by a.started_at, t.full_name, a.id) as teachers"),
            ]);
    }

    /** Decode the `teachers` JSON column that summary() adds to a list row. */
    public static function decodeRow(object $row): object
    {
        if (property_exists($row, 'teachers')) {
            $row->teachers = is_string($row->teachers) ? json_decode($row->teachers, true) : ($row->teachers ?? []);
        }

        return $row;
    }
}
