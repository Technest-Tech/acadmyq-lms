<?php

declare(strict_types=1);

use App\Services\SessionGenerator;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-conf@test.local']);
    $this->teacher = $this->createTeacher($this->academy, [
        'full_name' => 'Conf Teacher',
        // Available Tuesdays 16:00–19:00 only (weekday 2).
        'availability' => json_encode([['weekday' => 2, 'start_local' => '16:00', 'end_local' => '19:00']]),
    ]);
    $this->student = $this->createStudent($this->academy);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
});

afterEach(fn () => Carbon::setTestNow());

// ── TC-5.22 / AC-5.8: overlapping reschedule warns but is permitted ───────────
it('warns on a teacher time conflict but still performs the reschedule', function () {
    // Two existing sessions for the same teacher.
    $a = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 14:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED',
    ]);
    $b = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-16 14:00:00+00', 'duration_minutes' => 30, 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    // Reschedule B onto a time overlapping A (14:30 falls inside A's 14:00–15:00).
    $res = $this->postJson("/api/sessions/{$b}/reschedule", [
        'scheduled_at_utc' => '2026-06-09 14:30:00+00',
    ])->assertCreated();

    $warnings = collect($res->json('warnings'));
    expect($warnings->pluck('type'))->toContain('conflict');
    // Non-blocking: the successor exists.
    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $res->json('sessionId'))->exists())->toBeTrue();
});

// ── TC-5.23 / AC-5.8: out-of-availability create warns but is permitted ───────
it('warns when creating outside the teacher availability window but allows it', function () {
    Sanctum::actingAs($this->owner);
    // Thursday (weekday 4) — the teacher only declares Tuesday availability.
    $res = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-18 17:00', // a Thursday
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated();

    expect(collect($res->json('warnings'))->pluck('type'))->toContain('availability');
    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $res->json('sessionId'))->exists())->toBeTrue();
});

it('emits no availability warning inside the declared window', function () {
    Sanctum::actingAs($this->owner);
    // Tuesday 17:00 Cairo is inside the 16:00–19:00 window.
    $res = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00', // a Tuesday
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated();

    expect(collect($res->json('warnings'))->pluck('type'))->not->toContain('availability');
});

// ── TC-5.24 / AC-5.10: ad-hoc session behaves like any session; never regenerated ─
it('creates an ad-hoc session that the generator never touches', function () {
    Sanctum::actingAs($this->owner);
    $res = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'teacher_id' => $this->teacher,
        'scheduled_at_utc' => '2026-06-20 12:00:00+00',
        'duration_minutes' => 45,
    ])->assertCreated();
    $adHocId = $res->json('sessionId');

    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $adHocId)->first();
    expect($row->schedule_id)->toBeNull();
    expect($row->slot_id)->toBeNull();
    expect($row->occurrence_local_date)->toBeNull();

    // It can be cancelled like any session.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$adHocId}/cancel", ['cancelled_by' => 'teacher'])->assertOk();

    // It shows on the calendar.
    $sessions = $this->getJson('/api/calendar?from=2026-06-01&to=2026-06-30')->assertOk()->json('sessions');
    expect(collect($sessions)->pluck('id'))->toContain($adHocId);

    // The generator (run for the academy) never removes or duplicates it.
    $this->asAcademy($this->academy);
    app(SessionGenerator::class)->generateForAcademy($this->academy, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-30'));
    expect(DB::table('sessions')->where('id', $adHocId)->exists())->toBeTrue();
    expect(DB::table('sessions')->where('student_id', $this->student)->whereNull('schedule_id')->count())->toBe(1);
});
