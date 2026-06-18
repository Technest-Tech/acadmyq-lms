<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-day@test.local']);
    $this->teacher1 = $this->createTeacher($this->academy, ['full_name' => 'Teacher A']);
    $this->teacher2 = $this->createTeacher($this->academy, ['full_name' => 'Teacher B']);
    $this->guardian = $this->createGuardian($this->academy);
    // A trial student with a session booked for LATER today (15:00 UTC).
    $this->trialStudent = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Trialist', 'status' => 'TRIAL_BOOKED']);
    $this->trialSession = $this->createSession($this->academy, $this->trialStudent, $this->teacher1, [
        'scheduled_at_utc' => '2026-06-11 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
    // A regular student's session today, with the other teacher.
    $this->regularStudent = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Regular', 'status' => 'REGULAR']);
    $this->regularSession = $this->createSession($this->academy, $this->regularStudent, $this->teacher2, [
        'scheduled_at_utc' => '2026-06-11 10:00:00+00', 'status' => 'SCHEDULED',
    ]);
    // A session on a different day — must NOT appear in today's window.
    $this->createSession($this->academy, $this->regularStudent, $this->teacher2, [
        'scheduled_at_utc' => '2026-06-12 10:00:00+00', 'status' => 'SCHEDULED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

function dayUrl(array $extra = []): string
{
    return '/api/sessions/day?'.http_build_query(array_merge([
        'from' => '2026-06-11T00:00:00Z',
        'to' => '2026-06-12T00:00:00Z',
    ], $extra));
}

// ── A trial booked for later today shows up immediately (not gated to past) ──
it('returns every session in the day window, including a future trial booked for later today', function () {
    Sanctum::actingAs($this->owner);

    $ids = collect($this->getJson(dayUrl())->assertOk()->json('sessions'))->pluck('id');

    expect($ids)->toContain($this->trialSession);   // future (15:00) trial included
    expect($ids)->toContain($this->regularSession);  // earlier today included
    expect($ids)->toHaveCount(2);                     // tomorrow's session excluded
});

// ── Day rows carry the student lifecycle status so trials can be badged ──────
it('includes the student status on each row', function () {
    Sanctum::actingAs($this->owner);

    $row = collect($this->getJson(dayUrl())->assertOk()->json('sessions'))
        ->firstWhere('id', $this->trialSession);

    expect($row['student_status'])->toBe('TRIAL_BOOKED');
});

// ── Filters: teacher, status, trial-only ─────────────────────────────────────
it('filters by teacher', function () {
    Sanctum::actingAs($this->owner);
    $ids = collect($this->getJson(dayUrl(['teacher_id' => $this->teacher1]))->assertOk()->json('sessions'))->pluck('id');
    expect($ids)->toEqual(collect([$this->trialSession]));
});

it('filters to trials only', function () {
    Sanctum::actingAs($this->owner);
    $ids = collect($this->getJson(dayUrl(['trial_only' => '1']))->assertOk()->json('sessions'))->pluck('id');
    expect($ids)->toEqual(collect([$this->trialSession]));
});

// ── A teacher sees only their own sessions (row scope, §3.6) ─────────────────
it('row-scopes a teacher to their own sessions', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-a@test.local']);
    // Link the login to teacher1's record.
    $this->asAcademy($this->academy);
    \Illuminate\Support\Facades\DB::table('teachers')->where('id', $this->teacher1)->update(['user_id' => $teacherUser->id]);

    Sanctum::actingAs($teacherUser);
    $ids = collect($this->getJson(dayUrl())->assertOk()->json('sessions'))->pluck('id');

    expect($ids)->toEqual(collect([$this->trialSession])); // only teacher1's session
});
