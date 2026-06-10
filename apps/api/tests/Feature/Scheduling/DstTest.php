<?php

declare(strict_types=1);

use App\Services\SessionGenerator;
use App\Support\TimeHelper;
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

/**
 * DST correctness at the DB-generation level (AC-5.7/5.9). The pure math is unit-tested in
 * RecurrenceCalculatorTest; here we prove the stored `scheduled_at_utc` rows carry that math
 * through to the database and back out in any viewer timezone.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-03-01 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->generator = app(SessionGenerator::class);
});

afterEach(fn () => Carbon::setTestNow());

// ── TC-5.12 / AC-5.7: northern-hemisphere boundary, stored rows keep local time ─
it('stores DST-correct UTC instants across a Cairo spring-forward boundary', function () {
    $academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $teacher = $this->createTeacher($academy);
    $student = $this->createStudent($academy);
    $this->assignTeacher($academy, $student, $teacher);
    $schedule = $this->createSchedule($academy, $student, $teacher, 'Africa/Cairo');
    $this->addSlot($academy, $schedule, 5, '17:00:00'); // Fridays at 17:00 Cairo

    $this->asAcademy($academy);
    // Egypt springs forward on the last Friday of April 2026 (04-24): +02:00 → +03:00.
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-04-17'), Carbon::parse('2026-05-08'));

    $before = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-04-17')->first();
    $after = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-05-01')->first();

    // Local time fixed at 17:00 on both sides; UTC instants differ by the offset change.
    expect(TimeHelper::renderInTimezone(Carbon::parse($before->scheduled_at_utc), 'Africa/Cairo', 'H:i'))->toBe('17:00');
    expect(TimeHelper::renderInTimezone(Carbon::parse($after->scheduled_at_utc), 'Africa/Cairo', 'H:i'))->toBe('17:00');
    expect(Carbon::parse($before->scheduled_at_utc)->utc()->format('H:i'))->toBe('15:00'); // +2
    expect(Carbon::parse($after->scheduled_at_utc)->utc()->format('H:i'))->toBe('14:00');  // +3
});

// ── TC-5.13 / AC-5.7: southern-hemisphere boundary (opposite sign) ────────────
it('stores DST-correct UTC across a southern-hemisphere boundary', function () {
    $academy = $this->createAcademy(overrides: ['timezone' => 'America/Santiago']);
    $teacher = $this->createTeacher($academy);
    $student = $this->createStudent($academy);
    $this->assignTeacher($academy, $student, $teacher);
    $schedule = $this->createSchedule($academy, $student, $teacher, 'America/Santiago');
    $this->addSlot($academy, $schedule, 3, '17:00:00'); // Wednesdays 17:00 local

    $this->asAcademy($academy);
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-03-25'), Carbon::parse('2026-04-15'));

    $summer = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-03-25')->first();
    $winter = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-04-15')->first();

    expect(TimeHelper::renderInTimezone(Carbon::parse($summer->scheduled_at_utc), 'America/Santiago', 'H:i'))->toBe('17:00');
    expect(TimeHelper::renderInTimezone(Carbon::parse($winter->scheduled_at_utc), 'America/Santiago', 'H:i'))->toBe('17:00');
    // Opposite sign vs Cairo: the later (winter) instant is LATER in UTC.
    expect(Carbon::parse($summer->scheduled_at_utc)->utc()->format('H:i'))->toBe('20:00'); // -3
    expect(Carbon::parse($winter->scheduled_at_utc)->utc()->format('H:i'))->toBe('21:00'); // -4
});

// ── TC-5.15 / AC-5.9: a viewer in another timezone sees the converted local time ─
it('renders a stored UTC instant correctly for a viewer in another timezone', function () {
    Carbon::setTestNow('2026-05-20 06:00:00');
    $academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER', ['email' => 'owner-tz@test.local']);
    $teacher = $this->createTeacher($academy);
    $student = $this->createStudent($academy);
    $this->assignTeacher($academy, $student, $teacher);

    Sanctum::actingAs($owner);
    $this->putJson("/api/students/{$student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertCreated();

    $sessions = $this->getJson('/api/calendar?from=2026-06-01&to=2026-06-30')->assertOk()->json('sessions');
    $first = collect($sessions)->firstWhere('student_id', $student);

    // Stored UTC is unchanged (14:00Z for 17:00 Cairo in June)…
    $utc = Carbon::parse($first['scheduled_at_utc'])->utc();
    expect($utc->format('H:i'))->toBe('14:00');
    // …and a Riyadh viewer (UTC+3) renders it as 17:00, a London viewer (UTC+1 in June) as 15:00.
    expect(TimeHelper::renderInTimezone($utc, 'Asia/Riyadh', 'H:i'))->toBe('17:00');
    expect(TimeHelper::renderInTimezone($utc, 'Europe/London', 'H:i'))->toBe('15:00');
});

// ── TC-5.16 / AC-5.7: a non-existent spring-forward time resolves deterministically ─
it('generates a deterministic instant for a non-existent spring-forward time', function () {
    $academy = $this->createAcademy(overrides: ['timezone' => 'Europe/London']);
    $teacher = $this->createTeacher($academy);
    $student = $this->createStudent($academy);
    $this->assignTeacher($academy, $student, $teacher);
    $schedule = $this->createSchedule($academy, $student, $teacher, 'Europe/London');
    // London springs forward 2026-03-29 (Sunday) 01:00→02:00; 01:30 does not exist.
    $this->addSlot($academy, $schedule, 0, '01:30:00');

    $this->asAcademy($academy);
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-03-29'), Carbon::parse('2026-03-29'));

    $row = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-03-29')->first();
    expect($row)->not->toBeNull();
    // Deterministic: the instant renders as the next valid wall-clock (02:30 BST).
    expect(Carbon::parse($row->scheduled_at_utc)->utc()->toIso8601String())->toBe('2026-03-29T01:30:00+00:00');
    expect(TimeHelper::renderInTimezone(Carbon::parse($row->scheduled_at_utc), 'Europe/London', 'H:i'))->toBe('02:30');
});
