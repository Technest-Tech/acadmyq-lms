<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * GET /api/sessions/overdue — الحصص المعلقة, the lessons nobody ever marked.
 *
 * The rule under test throughout: a lesson is overdue once FOUR HOURS have passed since it ENDED
 * and it is still SCHEDULED. Measuring from the end (not the start) is the whole point — a
 * five-hour lesson that began this morning is not late while it is still being taught.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-overdue@test.local']);
    $this->teacher1 = $this->createTeacher($this->academy, ['full_name' => 'Teacher A']);
    $this->teacher2 = $this->createTeacher($this->academy, ['full_name' => 'Teacher B']);
    $this->guardian = $this->createGuardian($this->academy);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Sara', 'status' => 'REGULAR']);

    // Ended 05:30 — six and a half hours ago. Overdue.
    $this->staleToday = $this->createSession($this->academy, $this->student, $this->teacher1, [
        'scheduled_at_utc' => '2026-06-11 05:00:00+00', 'duration_minutes' => 30, 'status' => 'SCHEDULED',
    ]);
    // Two days old and still unmarked — the case a day/week view loses entirely.
    $this->ancient = $this->createSession($this->academy, $this->student, $this->teacher2, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED',
    ]);
    // Ended 10:30 — only ninety minutes ago, still inside the four-hour grace.
    $this->withinGrace = $this->createSession($this->academy, $this->student, $this->teacher1, [
        'scheduled_at_utc' => '2026-06-11 10:00:00+00', 'duration_minutes' => 30, 'status' => 'SCHEDULED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

// ── The grace window ─────────────────────────────────────────────────────────
it('returns only lessons whose grace window has expired, oldest first', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/sessions/overdue')->assertOk();
    $ids = collect($res->json('sessions'))->pluck('id');

    // Oldest first: the two-day-old lesson leads, and the one still inside grace is absent.
    expect($ids->all())->toBe([$this->ancient, $this->staleToday]);
    expect($res->json('count'))->toBe(2);
    expect($res->json('truncated'))->toBeFalse();
    expect($res->json('grace_hours'))->toBe(4);
});

it('measures the grace window from the end of the lesson, not its start', function () {
    Sanctum::actingAs($this->owner);

    // Started at 07:00 — five hours ago — but runs 300 minutes, so it only ends right now.
    $long = $this->createSession($this->academy, $this->student, $this->teacher1, [
        'scheduled_at_utc' => '2026-06-11 07:00:00+00', 'duration_minutes' => 300, 'status' => 'SCHEDULED',
    ]);

    $ids = collect($this->getJson('/api/sessions/overdue')->assertOk()->json('sessions'))->pluck('id');

    // pendingAttendance would list it (its start has passed); overdue must not — it isn't late.
    expect($ids)->not->toContain($long);
});

// ── Only unmarked lessons ────────────────────────────────────────────────────
it('drops a lesson as soon as it has an outcome', function () {
    Sanctum::actingAs($this->owner);

    $this->asAcademy($this->academy);
    DB::table('sessions')->where('id', $this->staleToday)->update(['status' => 'ATTENDED']);
    $this->clearTenantContext();

    $ids = collect($this->getJson('/api/sessions/overdue')->assertOk()->json('sessions'))->pluck('id');

    expect($ids->all())->toBe([$this->ancient]);
});

// ── Who is actually holding the lesson up ───────────────────────────────────
it('keeps a lesson awaiting the owner\'s approval, flagged as such', function () {
    Sanctum::actingAs($this->owner);

    $this->asAcademy($this->academy);
    DB::table('session_cancellation_requests')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'session_id' => $this->staleToday,
        'teacher_id' => $this->teacher1,
        'cancel_type' => 'student',
        'status' => 'PENDING',
    ]);
    $this->clearTenantContext();

    $rows = collect($this->getJson('/api/sessions/overdue')->assertOk()->json('sessions'));

    // Still stuck, still listed — the teacher acted, so the row says the OWNER owes the decision.
    expect($rows->firstWhere('id', $this->staleToday)['pending_approval'])->toBeTrue();
    expect($rows->firstWhere('id', $this->ancient)['pending_approval'])->toBeFalse();
});

// ── Row scope (§3.6) ─────────────────────────────────────────────────────────
it('row-scopes a teacher to their own overdue lessons', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-overdue@test.local']);
    $this->asAcademy($this->academy);
    DB::table('teachers')->where('id', $this->teacher1)->update(['user_id' => $teacherUser->id]);
    $this->clearTenantContext();

    Sanctum::actingAs($teacherUser);
    $res = $this->getJson('/api/sessions/overdue')->assertOk();

    // teacher2's two-day-old lesson is not this teacher's problem, and not in their count either.
    expect(collect($res->json('sessions'))->pluck('id')->all())->toBe([$this->staleToday]);
    expect($res->json('count'))->toBe(1);
});

// ── Rows carry what the page needs to name the lesson ───────────────────────
it('returns the student and teacher names on each row', function () {
    Sanctum::actingAs($this->owner);

    $row = collect($this->getJson('/api/sessions/overdue')->assertOk()->json('sessions'))
        ->firstWhere('id', $this->ancient);

    expect($row['student_name'])->toBe('Sara');
    expect($row['teacher_name'])->toBe('Teacher B');
    expect($row['student_status'])->toBe('REGULAR');
    expect($row['duration_minutes'])->toBe(60);
});
