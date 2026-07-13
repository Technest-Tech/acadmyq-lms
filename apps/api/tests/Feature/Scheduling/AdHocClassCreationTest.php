<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * The Attendance page's "add a class": a one-off lesson the weekly timetable never produced (a
 * make-up class, or one that happened before the timetable existed — the generator never
 * back-fills the past, so those occurrences have no row).
 *
 * It is gated on `session.create`, which a TEACHER holds too. That capability is deliberately
 * narrower than `schedule.manage`: it mints ONE ad-hoc occurrence and must never let a teacher
 * rewrite a timetable, teach someone else's student, or mint a billable class in another
 * teacher's name. Those boundaries are what this file pins down.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-adhoc@test.local']);

    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't1-adhoc@test.local']);
    $this->otherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't2-adhoc@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Own Teacher', 'user_id' => $this->teacherUser->getKey()]);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Other Teacher', 'user_id' => $this->otherUser->getKey()]);

    $this->student = $this->createStudent($this->academy);       // taught by $this->teacher
    $this->otherStudent = $this->createStudent($this->academy);  // taught by $this->other
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
    $this->assignTeacher($this->academy, $this->otherStudent, $this->other);
});

afterEach(fn () => Carbon::setTestNow());

it('lets a teacher add a one-off class for their own student', function () {
    Sanctum::actingAs($this->teacherUser);

    $sessionId = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'local_datetime' => '2026-05-15 08:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 45,
    ])->assertCreated()->json('sessionId');

    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $sessionId)->first();

    expect($row->status)->toBe('SCHEDULED')
        ->and((string) $row->teacher_id)->toBe($this->teacher)
        ->and((int) $row->duration_minutes)->toBe(45)
        // Ad-hoc: owned by no schedule, so the generator can never realign or delete it.
        ->and($row->schedule_id)->toBeNull();
});

it('forbids a teacher adding a class for a student who is not theirs', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->postJson('/api/sessions', [
        'student_id' => $this->otherStudent,
        'local_datetime' => '2026-05-15 08:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertForbidden();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('student_id', $this->otherStudent)->exists())->toBeFalse();
});

it('records a teacher as the teacher of their own class even if they name someone else', function () {
    Sanctum::actingAs($this->teacherUser);

    // A teacher trying to pin the class (and its payout) on a colleague is ignored, not obeyed.
    $sessionId = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'teacher_id' => $this->other,
        'local_datetime' => '2026-05-15 08:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('sessionId');

    $this->asAcademy($this->academy);
    expect((string) DB::table('sessions')->where('id', $sessionId)->value('teacher_id'))->toBe($this->teacher);
});

it('still lets an owner add a class for any teacher', function () {
    Sanctum::actingAs($this->owner);

    $sessionId = $this->postJson('/api/sessions', [
        'student_id' => $this->otherStudent,
        'teacher_id' => $this->other,
        'local_datetime' => '2026-05-15 08:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('sessionId');

    $this->asAcademy($this->academy);
    expect((string) DB::table('sessions')->where('id', $sessionId)->value('teacher_id'))->toBe($this->other);
});

it('grants session.create without granting schedule.manage to a teacher', function () {
    // The whole point of the separate capability: a teacher may mint one occurrence but must not
    // be able to rewrite the student's weekly timetable.
    $caps = array_map(
        fn (object $r): string => $r->code,
        DB::select('select code from app.role_capabilities(?)', ['TEACHER']),
    );

    expect($caps)->toContain('session.create')
        ->and($caps)->not->toContain('schedule.manage');

    Sanctum::actingAs($this->teacherUser);
    $this->putJson("/api/students/{$this->student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '16:00', 'duration_minutes' => 60]],
    ])->assertForbidden();
});

it('carries an ad-hoc class through the normal attendance + report path', function () {
    Sanctum::actingAs($this->owner);

    // Exactly what the Add-class dialog does: create → record the outcome → save the report.
    $sessionId = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-05-15 07:00', // already past (now = 06:00 UTC = 09:00 Cairo)
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 60,
    ])->assertCreated()->json('sessionId');

    $this->postJson("/api/sessions/{$sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->putJson("/api/sessions/{$sessionId}/report", [
        'values' => ['report_text' => 'Reviewed Surah Al-Mulk.'],
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $sessionId)->value('status'))->toBe('ATTENDED');

    $values = json_decode((string) DB::table('session_reports')->where('session_id', $sessionId)->value('values'), true);
    expect($values['report_text'])->toBe('Reviewed Surah Al-Mulk.');

    // And it shows up on the Attendance day view like any generated class.
    Sanctum::actingAs($this->owner);
    $day = $this->getJson('/api/sessions/day?from=2026-05-15T00:00:00Z&to=2026-05-16T00:00:00Z')
        ->assertOk()->json('sessions');
    expect(collect($day)->pluck('id'))->toContain($sessionId);
});
