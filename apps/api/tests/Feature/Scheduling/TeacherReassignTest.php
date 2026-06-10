<?php

declare(strict_types=1);

use App\Services\SessionGenerator;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

// ── TC-5.25 / §6: reassign teacher + regenerate → future untouched carry the new teacher ─
it('moves future untouched sessions to the new teacher on regeneration; past & touched keep the old', function () {
    Carbon::setTestNow('2026-06-15 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $teacherOld = $this->createTeacher($academy, ['full_name' => 'Old Teacher']);
    $teacherNew = $this->createTeacher($academy, ['full_name' => 'New Teacher']);
    $student = $this->createStudent($academy);
    $this->assignTeacher($academy, $student, $teacherOld);

    $schedule = $this->createSchedule($academy, $student, $teacherOld, 'Africa/Cairo');
    $slot = $this->addSlot($academy, $schedule, 2, '17:00:00'); // Tuesdays

    $generator = app(SessionGenerator::class);
    $window = [Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31')];
    $this->asAcademy($academy);
    $generator->generateForSchedule($schedule, ...$window);

    // A PAST attended Tuesday with the old teacher, and a future TOUCHED (cancelled) one.
    $this->asAcademy($academy);
    $pastId = (string) Str::uuid();
    DB::table('sessions')->insert([
        'id' => $pastId, 'academy_id' => $academy, 'student_id' => $student, 'teacher_id' => $teacherOld,
        'schedule_id' => $schedule, 'slot_id' => $slot, 'occurrence_local_date' => '2026-06-09',
        'scheduled_at_utc' => '2026-06-09 14:00:00+00', 'duration_minutes' => 30, 'status' => 'ATTENDED',
    ]);
    $touched = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-30')->first();
    DB::table('sessions')->where('id', $touched->id)->update(['status' => 'CANCELLED_BY_STUDENT']);
    $futureUntouched = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-23')->first();

    // Reassign the student's teacher (Sprint 4), then regenerate.
    $this->assignTeacher($academy, $student, $teacherNew);
    $this->asAcademy($academy);
    $generator->generateForSchedule($schedule, ...$window);

    $this->asAcademy($academy);
    // Future untouched now carries the NEW teacher…
    expect(DB::table('sessions')->where('id', $futureUntouched->id)->value('teacher_id'))->toBe($teacherNew);
    // …past attended keeps the OLD teacher…
    expect(DB::table('sessions')->where('id', $pastId)->value('teacher_id'))->toBe($teacherOld);
    // …and the touched (cancelled) future session keeps the OLD teacher too.
    expect(DB::table('sessions')->where('id', $touched->id)->value('teacher_id'))->toBe($teacherOld);
});
