<?php

declare(strict_types=1);

namespace Tests\Concerns;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fixture helpers for the Sprint 5 scheduling tests: build schedules, slots, active teacher
 * assignments and concrete sessions directly under the owning academy's context (so the RLS
 * `with check` passes), letting tests drive the SessionGenerator service with full control over
 * the window and "now". Requires InteractsWithTenancy.
 */
trait CreatesSchedules
{
    protected function assignTeacher(string $academyId, string $studentId, string $teacherId, $startedAt = null): void
    {
        $this->asAcademy($academyId);
        // Close any open assignment first (the partial unique index allows only one).
        DB::table('student_teacher_assignments')->where('student_id', $studentId)->whereNull('ended_at')
            ->update(['ended_at' => now(), 'updated_at' => now()]);
        DB::table('student_teacher_assignments')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'started_at' => $startedAt ?? now(),
            'ended_at' => null,
        ]);
    }

    protected function createSchedule(string $academyId, string $studentId, string $teacherId, string $timezone = 'Africa/Cairo', array $overrides = []): string
    {
        $id = (string) Str::uuid();
        $this->asAcademy($academyId);
        DB::table('schedules')->insert(array_merge([
            'id' => $id,
            'academy_id' => $academyId,
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'timezone' => $timezone,
            'is_active' => true,
            'version' => 1,
        ], $overrides));

        return $id;
    }

    protected function addSlot(string $academyId, string $scheduleId, int $weekday, string $time = '17:00:00', int $duration = 30): string
    {
        $id = (string) Str::uuid();
        $this->asAcademy($academyId);
        DB::table('schedule_slots')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'schedule_id' => $scheduleId,
            'weekday' => $weekday,
            'start_time_local' => $time,
            'duration_minutes' => $duration,
        ]);

        return $id;
    }
}
