<?php

declare(strict_types=1);

use App\Jobs\RollSessionWindowJob;
use App\Services\SessionGenerator;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * The lessons on the board follow what the academy changed, and only that.
 *
 * Reported by two clients. Al-Rayan moved a student from three days to two: the upcoming lessons
 * were right, but the save invented six past lessons on the new day and announced "0 removed", so
 * it read as if nothing had changed. The rules under test: an edit never invents lessons in the
 * past, a lesson with a record against it never blocks a save, and a teacher move carries
 * everything still unmarked, including lessons no timetable owns.
 */
beforeEach(function () {
    // A Wednesday, mid-month.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-sync@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Old Teacher']);
    $this->newTeacher = $this->createTeacher($this->academy, ['full_name' => 'New Teacher']);
    $this->student = $this->createStudent($this->academy, $this->createGuardian($this->academy), ['full_name' => 'Fathia', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
});

afterEach(fn () => Carbon::setTestNow());

/** @return array{weekday:int, start_time_local:string, duration_minutes:int} */
function syncSlot(int $weekday, int $minutes = 30, string $time = '17:00'): array
{
    return ['weekday' => $weekday, 'start_time_local' => $time, 'duration_minutes' => $minutes];
}

function syncRow(string $studentId, string $date): ?object
{
    return DB::table('sessions')->where('student_id', $studentId)->where('occurrence_local_date', $date)->first();
}

function syncDates(string $studentId): array
{
    return DB::table('sessions')->where('student_id', $studentId)->whereNotNull('occurrence_local_date')
        ->orderBy('occurrence_local_date')->pluck('occurrence_local_date')
        ->map(fn ($d) => Carbon::parse($d)->format('Y-m-d'))->all();
}

// ── An edit never invents history ────────────────────────────────────────────

// The timetable started on the 1st on Mondays. Moving it to Tuesdays today is a statement about
// the future — it says nothing about Tuesdays gone by, and nobody taught them.
it('does not create past lessons on the new day when a timetable moves to another day', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-06-01'])->assertCreated();

    $res = $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(2)], 'start_date' => '2026-06-01'])->assertOk();

    $this->asAcademy($this->academy);
    $dates = syncDates($this->student);
    expect($dates)->not->toContain('2026-06-02')->not->toContain('2026-06-09')->not->toContain('2026-06-16');
    // Tuesdays from here on are what the edit asked for.
    expect($dates)->toContain('2026-06-23');
    expect($res->json('generated.created'))->toBeGreaterThan(0);
});

// "0 removed" on a save that had just removed lessons is half of why this read as broken.
it('reports the lessons a dropped day took with it', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1), syncSlot(2)]])->assertCreated();

    $res = $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(2)]])->assertOk();

    $this->asAcademy($this->academy);
    expect(syncDates($this->student))->not->toContain('2026-06-22');
    expect($res->json('generated.removed'))->toBeGreaterThan(0);
});

it('still back-fills the stretch when the start date is moved earlier, and only that stretch', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-06-15'])->assertCreated();

    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-06-01'])->assertOk();

    $this->asAcademy($this->academy);
    expect(syncDates($this->student))->toContain('2026-06-01')->toContain('2026-06-08')->toContain('2026-06-15');
});

it('leaves unmarked past lessons as they are when the length changes', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1, 30)], 'start_date' => '2026-06-01'])->assertCreated();

    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1, 40)]])->assertOk();

    $this->asAcademy($this->academy);
    expect((int) syncRow($this->student, '2026-06-15')->duration_minutes)->toBe(30);
    expect((int) syncRow($this->student, '2026-06-22')->duration_minutes)->toBe(40);
});

// ── The timetable's own start date binds every generation ────────────────────

it('never makes lessons before a start date in the future, even from the nightly roll', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-07-06'])->assertCreated();

    $this->clearTenantContext();
    (new RollSessionWindowJob)->handle(app(SessionGenerator::class));

    $this->asAcademy($this->academy);
    expect(syncDates($this->student))->not->toContain('2026-06-22')->not->toContain('2026-06-29');
    expect(syncDates($this->student))->toContain('2026-07-06');
});

it('clears upcoming lessons before the new start when the start date moves forward', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-06-01'])->assertCreated();

    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-07-06'])->assertOk();

    $this->asAcademy($this->academy);
    expect(syncDates($this->student))->not->toContain('2026-06-22');
    // What already went by is history, and stays.
    expect(syncDates($this->student))->toContain('2026-06-15');
});

// ── A lesson with a record against it must not break the save ────────────────

it('saves a timetable edit when a lesson on the dropped day has a cancellation request', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1), syncSlot(2)]])->assertCreated();

    $this->asAcademy($this->academy);
    $requested = syncRow($this->student, '2026-06-22');
    DB::table('session_cancellation_requests')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'session_id' => $requested->id,
        'teacher_id' => $this->teacher,
        'cancel_type' => 'teacher',
        'status' => 'PENDING',
    ]);
    $plain = syncRow($this->student, '2026-06-29');
    $this->clearTenantContext();

    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(2)]])->assertOk();

    $this->asAcademy($this->academy);
    // Someone is waiting on a decision about this one, so it stays until they get it.
    expect(DB::table('sessions')->where('id', $requested->id)->exists())->toBeTrue();
    expect(DB::table('sessions')->where('id', $plain->id)->exists())->toBeFalse();
});

// A teacher can enter from ten minutes before the start, so "upcoming" can already be happening.
it('keeps an upcoming lesson the teacher has already entered', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)]])->assertCreated();

    $this->asAcademy($this->academy);
    $entered = syncRow($this->student, '2026-06-22');
    DB::table('session_joins')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'session_id' => $entered->id,
        'teacher_id' => $this->teacher,
    ]);
    $this->clearTenantContext();

    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(2)]])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $entered->id)->exists())->toBeTrue();
    expect(syncDates($this->student))->not->toContain('2026-06-29');
});

// ── The length the price assumes ─────────────────────────────────────────────

it('tells the timetable editor what lesson length the student is priced at', function () {
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Hourly',
        'price_minor' => 50000,
        'currency' => 'EGP',
        'price_basis' => 'PER_HOUR',
        'status' => 'ACTIVE',
        'start_date' => '2026-06-01',
        'sessions_per_month' => 8,
        'lesson_minutes' => 40,
    ]);
    $this->clearTenantContext();

    // Before there is a timetable is exactly when it matters most.
    expect($this->getJson("/api/students/{$this->student}/schedule")->assertOk()->json('lesson_minutes'))->toBe(40);

    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1, 30)]])->assertCreated();
    expect($this->getJson("/api/students/{$this->student}/schedule")->assertOk()->json('lesson_minutes'))->toBe(40);
});

// ── Moving a student to another teacher ──────────────────────────────────────

it('carries rescheduled and one-off upcoming lessons to the new teacher', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)]])->assertCreated();

    $this->asAcademy($this->academy);
    $origin = syncRow($this->student, '2026-06-22');
    $this->clearTenantContext();

    $moved = $this->postJson("/api/sessions/{$origin->id}/reschedule", ['scheduled_at_utc' => '2026-06-24T14:00:00Z'])->assertCreated()->json('sessionId');
    $oneOff = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'scheduled_at_utc' => '2026-06-25T14:00:00Z',
        'duration_minutes' => 30,
    ])->assertCreated()->json('sessionId');

    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->newTeacher])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $moved)->value('teacher_id'))->toBe($this->newTeacher);
    expect(DB::table('sessions')->where('id', $oneOff)->value('teacher_id'))->toBe($this->newTeacher);
});

it('carries unmarked lessons since the effective date, and keeps marked ones with the teacher who taught them', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-06-01'])->assertCreated();

    $this->asAcademy($this->academy);
    $taught = syncRow($this->student, '2026-06-08');
    DB::table('sessions')->where('id', $taught->id)->update(['status' => 'ATTENDED']);
    $this->clearTenantContext();

    $this->postJson("/api/students/{$this->student}/teacher", [
        'teacher_id' => $this->newTeacher,
        'effective_date' => '2026-06-08',
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(syncRow($this->student, '2026-06-01')->teacher_id)->toBe($this->teacher)     // before the date
        ->and(DB::table('sessions')->where('id', $taught->id)->value('teacher_id'))->toBe($this->teacher) // marked
        ->and(syncRow($this->student, '2026-06-15')->teacher_id)->toBe($this->newTeacher) // unmarked, in range
        ->and(syncRow($this->student, '2026-06-22')->teacher_id)->toBe($this->newTeacher); // upcoming
});

it('leaves an unmarked past lesson with the old teacher when no date is given', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)], 'start_date' => '2026-06-01'])->assertCreated();

    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->newTeacher])->assertOk();

    $this->asAcademy($this->academy);
    expect(syncRow($this->student, '2026-06-15')->teacher_id)->toBe($this->teacher)
        ->and(syncRow($this->student, '2026-06-22')->teacher_id)->toBe($this->newTeacher);
});

it('leaves another teacher\'s lessons with the same student alone', function () {
    $this->putJson("/api/students/{$this->student}/schedule", ['slots' => [syncSlot(1)]])->assertCreated();

    $third = $this->createTeacher($this->academy, ['full_name' => 'Third Teacher']);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/students/{$this->student}/schedule", ['teacher_id' => $third, 'slots' => [syncSlot(3)]])->assertCreated();

    $this->postJson("/api/students/{$this->student}/teacher", [
        'teacher_id' => $this->newTeacher,
        'replaces_teacher_id' => $this->teacher,
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(syncRow($this->student, '2026-06-24')->teacher_id)->toBe($third);
    expect(syncRow($this->student, '2026-06-22')->teacher_id)->toBe($this->newTeacher);
});
