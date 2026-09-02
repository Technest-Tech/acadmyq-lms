<?php

declare(strict_types=1);

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
 * A timetable starts when you say it starts.
 *
 * Before this, generation's floor was always `now`, so a student enrolled on the 1st and entered
 * into the system on the 20th silently lost three weeks of lessons — taught, owed, and existing
 * nowhere. The rule under test: lessons are produced from the timetable's start date, even when
 * that date is in the past, and they arrive SCHEDULED so the academy can mark them.
 */
beforeEach(function () {
    // A Wednesday, mid-month, so "the 1st" is comfortably behind us.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-start@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ustadh']);
    $this->guardian = $this->createGuardian($this->academy);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Sara', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
});

afterEach(fn () => Carbon::setTestNow());

/** Every Monday 17:00, 30 minutes. */
function mondaySlots(): array
{
    return ['slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 30]]];
}

function sessionDates(string $studentId): array
{
    return DB::table('sessions')->where('student_id', $studentId)
        ->orderBy('occurrence_local_date')
        ->pluck('occurrence_local_date')
        ->map(fn ($d) => Carbon::parse($d)->format('Y-m-d'))
        ->all();
}

// ── The bug this fixes ───────────────────────────────────────────────────────

it('generates the lessons already taught since a start date in the past', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-01'])->assertCreated();

    $dates = sessionDates($this->student);

    // June Mondays from the 1st — including the three that fell BEFORE today (17 June).
    expect($dates)->toContain('2026-06-01')->toContain('2026-06-08')->toContain('2026-06-15');
    // …and the window still runs forward to the end of next month.
    expect($dates)->toContain('2026-06-22')->toContain('2026-07-27');
});

it('leaves the back-filled lessons SCHEDULED, so nothing is billed until someone marks them', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-01'])->assertCreated();

    $this->asAcademy($this->academy);
    $past = DB::table('sessions')->where('student_id', $this->student)
        ->where('occurrence_local_date', '2026-06-01')->first();

    expect($past->status)->toBe('SCHEDULED');
    expect((bool) $past->billed)->toBeFalse();
});

it('does not reach back before the start date', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-08'])->assertCreated();

    expect(sessionDates($this->student))->not->toContain('2026-06-01');
});

// ── The default when nobody types a date ─────────────────────────────────────

it('inherits the start date from the student subscription when none is given', function () {
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
    ]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/students/{$this->student}/schedule", mondaySlots())->assertCreated();

    // The date was entered once, on the enrolment — the timetable honours it.
    expect(sessionDates($this->student))->toContain('2026-06-01');
});

it('starts today when there is no subscription and no date given', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule", mondaySlots())->assertCreated();

    // The old behaviour, preserved as the default: nothing before today.
    expect(sessionDates($this->student))->not->toContain('2026-06-01')
        ->not->toContain('2026-06-08')->not->toContain('2026-06-15');
    expect(sessionDates($this->student))->toContain('2026-06-22');
});

// ── Editing a timetable must not move its start or invent history ────────────

it('keeps the start date across an unrelated edit', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-01'])->assertCreated();

    // Move the lesson an hour later; say nothing about the start date.
    $this->putJson("/api/students/{$this->student}/schedule", [
        'slots' => [['weekday' => 1, 'start_time_local' => '18:00', 'duration_minutes' => 30]],
    ])->assertOk();

    $this->asAcademy($this->academy);
    $schedule = DB::table('schedules')->where('student_id', $this->student)->first();
    expect(Carbon::parse($schedule->start_date)->format('Y-m-d'))->toBe('2026-06-01');

    // The already-taught lessons are still there.
    expect(sessionDates($this->student))->toContain('2026-06-01');
});

// Retiming a back-dated timetable deletes the old slot and DETACHES the past sessions it made
// (slot_id → null). Matching new occurrences by slot alone would then miss them and put a second
// copy of every taught lesson on the board — markable, and billable, twice.
it('does not duplicate already-taught lessons when the timetable is retimed', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-01'])->assertCreated();
    $before = sessionDates($this->student);

    $this->putJson("/api/students/{$this->student}/schedule", [
        'slots' => [['weekday' => 1, 'start_time_local' => '18:00', 'duration_minutes' => 30]],
    ])->assertOk();

    $after = sessionDates($this->student);
    expect($after)->toHaveCount(count($before));
    // Each past Monday appears exactly once.
    foreach (['2026-06-01', '2026-06-08', '2026-06-15'] as $day) {
        expect(count(array_filter($after, fn ($d) => $d === $day)))->toBe(1);
    }
});

// The guard is per-date, not "one lesson a day" — an academy teaching twice on a Monday still
// gets both back-filled.
it('back-fills two lessons on the same weekday', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule", [
        'start_date' => '2026-06-01',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '10:00', 'duration_minutes' => 30],
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 30],
        ],
    ])->assertCreated();

    $dates = sessionDates($this->student);
    expect(count(array_filter($dates, fn ($d) => $d === '2026-06-01')))->toBe(2);
});

it('is idempotent — re-saving a back-dated timetable creates nothing twice', function () {
    Sanctum::actingAs($this->owner);

    $first = $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-01'])->assertCreated();
    $before = count(sessionDates($this->student));
    expect($first->json('generated.created'))->toBe($before);

    $again = $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-01'])->assertOk();

    expect($again->json('generated.created'))->toBe(0);
    expect(sessionDates($this->student))->toHaveCount($before);
});

// ── The rolling window must never back-fill on its own ──────────────────────

it('never back-fills from an academy-wide regeneration', function () {
    Sanctum::actingAs($this->owner);

    // A timetable that starts today, then a whole-academy run: the roll job's floor is `now`,
    // so a schedule is only ever back-filled by someone deliberately saving it.
    $this->putJson("/api/students/{$this->student}/schedule", mondaySlots())->assertCreated();

    $this->postJson('/api/admin/generate-sessions')->assertOk();

    expect(sessionDates($this->student))->not->toContain('2026-06-01');
});

it('exposes the start date on the timetable list and the student schedule', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/schedule",
        mondaySlots() + ['start_date' => '2026-06-01'])->assertCreated();

    $row = collect($this->getJson('/api/timetables')->assertOk()->json('timetables'))
        ->firstWhere('student_id', $this->student);
    expect($row['start_date'])->toBe('2026-06-01');

    $shown = $this->getJson("/api/students/{$this->student}/schedule")->assertOk()->json('schedule');
    expect(Carbon::parse($shown['start_date'])->format('Y-m-d'))->toBe('2026-06-01');
});
