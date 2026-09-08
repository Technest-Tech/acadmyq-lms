<?php

declare(strict_types=1);

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
 * Schedule edits are FUTURE-ONLY and non-destructive (R-SCH-3, §4.5, AC-5.5/5.6). These tests
 * drive the SessionGenerator directly over a fixed window so the "past vs future" boundary is
 * deterministic: with now = mid-June, the first half of June is the past and is never rewritten.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-15 06:00:00'); // mid-month: a real past and a real future
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Edit Teacher']);
    $this->student = $this->createStudent($this->academy);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
    $this->window = [Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31')];
    $this->generator = app(SessionGenerator::class);
});

afterEach(fn () => Carbon::setTestNow());

/** Seed a "past" attended row by hand so we can prove edits never touch history. */
function seedPast(string $academy, string $student, string $teacher, string $schedule, string $slot, string $date, string $utc): string
{
    $id = (string) Str::uuid();
    DB::table('sessions')->insert([
        'id' => $id, 'academy_id' => $academy, 'student_id' => $student, 'teacher_id' => $teacher,
        'schedule_id' => $schedule, 'slot_id' => $slot, 'occurrence_local_date' => $date,
        'scheduled_at_utc' => $utc, 'duration_minutes' => 30, 'status' => 'ATTENDED',
    ]);

    return $id;
}

// ── TC-5.17 / AC-5.5: edit a slot time → future moves, past keeps old time ────
it('moves future untouched sessions to the new time and keeps past sessions', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $slot = $this->addSlot($this->academy, $schedule, 2, '17:00:00'); // Tuesday 17:00

    $this->asAcademy($this->academy);
    // A past Tuesday (06-09) at the OLD time, ATTENDED — must never change.
    $pastId = seedPast($this->academy, $this->student, $this->teacher, $schedule, $slot, '2026-06-09', '2026-06-09 14:00:00+00');

    $this->generator->generateForSchedule($schedule, ...$this->window);
    $futureBefore = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-23')->first();
    expect(Carbon::parse($futureBefore->scheduled_at_utc)->utc()->format('H:i'))->toBe('14:00'); // 17:00 Cairo

    // Edit: move the Tuesday slot to 18:00 in place (reuse the slot id, simulating PUT's keep).
    $this->asAcademy($this->academy);
    DB::table('schedule_slots')->where('id', $slot)->update(['start_time_local' => '18:00:00']);
    $this->generator->generateForSchedule($schedule, ...$this->window);

    $this->asAcademy($this->academy);
    $futureAfter = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-23')->first();
    expect(Carbon::parse($futureAfter->scheduled_at_utc)->utc()->format('H:i'))->toBe('15:00'); // 18:00 Cairo
    // Past row untouched.
    $past = DB::table('sessions')->where('id', $pastId)->first();
    expect($past->status)->toBe('ATTENDED');
    expect(Carbon::parse($past->scheduled_at_utc)->utc()->format('H:i'))->toBe('14:00');
});

it('applies a changed lesson duration to future sessions without rewriting attended history', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $slot = $this->addSlot($this->academy, $schedule, 2, '17:00:00', 30);

    $this->asAcademy($this->academy);
    $pastId = seedPast($this->academy, $this->student, $this->teacher, $schedule, $slot, '2026-06-09', '2026-06-09 14:00:00+00');
    $this->generator->generateForSchedule($schedule, ...$this->window);
    $futureId = DB::table('sessions')
        ->where('schedule_id', $schedule)
        ->where('occurrence_local_date', '2026-06-23')
        ->value('id');

    DB::table('schedule_slots')->where('id', $slot)->update(['duration_minutes' => 60]);
    $this->generator->generateForSchedule($schedule, ...$this->window);

    $this->asAcademy($this->academy);
    expect((int) DB::table('sessions')->where('id', $futureId)->value('duration_minutes'))->toBe(60)
        ->and((int) DB::table('sessions')->where('id', $pastId)->value('duration_minutes'))->toBe(30);
});

// ── TC-5.18 / AC-5.5: add a slot (new weekday) → new future sessions appear ────
it('creates future sessions for an added weekday without disturbing existing ones', function () {
    Sanctum::actingAs($this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-add@test.local']));

    // Start with a Tuesday-only schedule via PUT.
    $this->putJson("/api/students/{$this->student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertCreated();

    $this->asAcademy($this->academy);
    $tuesdayIds = DB::table('sessions')->where('student_id', $this->student)->orderBy('id')->pluck('id');

    // Add Thursday alongside Tuesday.
    $this->putJson("/api/students/{$this->student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [
            ['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30],
            ['weekday' => 4, 'start_time_local' => '17:00', 'duration_minutes' => 30],
        ],
    ])->assertOk();

    $this->asAcademy($this->academy);
    // Thursdays now exist…
    expect(DB::table('sessions')->where('student_id', $this->student)->where('occurrence_local_date', '2026-06-18')->exists())->toBeTrue();
    // …and the original Tuesday rows are untouched (same ids preserved).
    $tuesdayIdsAfter = DB::table('sessions')->where('student_id', $this->student)
        ->whereIn('id', $tuesdayIds)->pluck('id');
    expect($tuesdayIdsAfter->sort()->values()->all())->toEqual($tuesdayIds->sort()->values()->all());
});

// ── TC-5.19 / AC-5.5: remove a slot via PUT → future untouched gone, touched remain ─
it('drops a weekday via PUT: future untouched removed, reported session preserved', function () {
    Sanctum::actingAs($this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-drop@test.local']));

    $this->putJson("/api/students/{$this->student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [
            ['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30],
            ['weekday' => 4, 'start_time_local' => '17:00', 'duration_minutes' => 30],
        ],
    ])->assertCreated();

    $this->asAcademy($this->academy);
    $reportedThu = DB::table('sessions')->where('student_id', $this->student)->where('occurrence_local_date', '2026-06-18')->first();
    DB::table('session_reports')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $reportedThu->id, 'values' => '{}',
    ]);
    $otherThu = DB::table('sessions')->where('student_id', $this->student)->where('occurrence_local_date', '2026-06-25')->first();

    // Drop Thursday.
    $this->putJson("/api/students/{$this->student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $otherThu->id)->exists())->toBeFalse();        // untouched → removed
    expect(DB::table('sessions')->where('id', $reportedThu->id)->exists())->toBeTrue();       // reported → preserved
    expect(DB::table('sessions')->where('id', $reportedThu->id)->value('slot_id'))->toBeNull(); // detached safely
});

// ── TC-5.20 / AC-5.5 / §4.5: a future session with a report is preserved ──────
it('preserves a future session that already has a report when the schedule is edited', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $slot = $this->addSlot($this->academy, $schedule, 2, '17:00:00');

    $this->asAcademy($this->academy);
    $this->generator->generateForSchedule($schedule, ...$this->window);
    $reported = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-23')->first();
    DB::table('session_reports')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $reported->id, 'values' => '{"surah_from":"1"}',
    ]);

    // Edit the slot time; the reported session must NOT move.
    $this->asAcademy($this->academy);
    DB::table('schedule_slots')->where('id', $slot)->update(['start_time_local' => '19:00:00']);
    $this->generator->generateForSchedule($schedule, ...$this->window);

    $this->asAcademy($this->academy);
    $after = DB::table('sessions')->where('id', $reported->id)->first();
    expect(Carbon::parse($after->scheduled_at_utc)->utc()->format('H:i'))->toBe('14:00'); // still 17:00 Cairo, not 19:00
});

// ── TC-5.21 / AC-5.6: delete schedule → future untouched removed, past kept ───
it('deletes the schedule: future untouched removed, past and touched preserved', function () {
    Sanctum::actingAs($this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-del@test.local']));

    $this->putJson("/api/students/{$this->student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertCreated();

    $this->asAcademy($this->academy);
    $schedule = DB::table('schedules')->where('student_id', $this->student)->value('id');
    $slot = DB::table('schedule_slots')->where('schedule_id', $schedule)->value('id');
    // A past attended Tuesday and a future cancelled Tuesday — both must survive deletion.
    $pastId = seedPast($this->academy, $this->student, $this->teacher, (string) $schedule, (string) $slot, '2026-06-09', '2026-06-09 14:00:00+00');
    $futureCancel = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-30')->first();
    DB::table('sessions')->where('id', $futureCancel->id)->update(['status' => 'CANCELLED_BY_STUDENT']);
    $futureUntouched = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-23')->first();

    $this->deleteJson("/api/students/{$this->student}/schedule")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $pastId)->exists())->toBeTrue();              // past kept
    expect(DB::table('sessions')->where('id', $futureCancel->id)->exists())->toBeTrue();    // touched kept
    expect(DB::table('sessions')->where('id', $futureUntouched->id)->exists())->toBeFalse(); // untouched removed
    expect(DB::table('schedules')->where('id', $schedule)->value('is_active'))->toBeFalsy();
});
