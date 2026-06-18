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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-rc@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'RC Teacher']);
    $this->student = $this->createStudent($this->academy);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);

    // A Tuesday schedule materialised across June–July.
    $this->schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $this->schedule, 2); // Tuesday 17:00
    $this->asAcademy($this->academy);
    app(SessionGenerator::class)->generateForSchedule($this->schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31'));
});

afterEach(fn () => Carbon::setTestNow());

function tuesdaySession(string $schedule, string $date)
{
    return DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', $date)->first();
}

// ── TC-5.8 / AC-5.3: reschedule isolates to two rows; siblings untouched ──────
it('reschedules one occurrence and leaves every sibling unchanged', function () {
    $target = tuesdaySession($this->schedule, '2026-06-09');
    $siblingsBefore = DB::table('sessions')->where('schedule_id', $this->schedule)->where('id', '!=', $target->id)
        ->orderBy('id')->get()->toArray();

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/sessions/{$target->id}/reschedule", [
        'local_datetime' => '2026-06-10 18:00', 'timezone' => 'Africa/Cairo', 'reason' => 'family travel',
    ])->assertCreated();

    $successorId = $res->json('sessionId');

    $this->asAcademy($this->academy);
    $original = DB::table('sessions')->where('id', $target->id)->first();
    $successor = DB::table('sessions')->where('id', $successorId)->first();

    expect($original->status)->toBe('RESCHEDULED');
    expect($successor->status)->toBe('SCHEDULED');
    expect($successor->original_session_id)->toBe($target->id);
    expect($successor->schedule_id)->toBeNull(); // successor is standalone
    // New instant: 18:00 Cairo (June, +3) = 15:00 UTC.
    expect(Carbon::parse($successor->scheduled_at_utc)->utc()->toIso8601String())->toBe('2026-06-10T15:00:00+00:00');

    // Every other sibling is byte-for-byte unchanged.
    $siblingsAfter = DB::table('sessions')->where('schedule_id', $this->schedule)->where('id', '!=', $target->id)
        ->orderBy('id')->get()->toArray();
    expect($siblingsAfter)->toEqual($siblingsBefore);
});

// ── Idempotency: a session can only be rescheduled once; retries mint no duplicate ──
it('rejects rescheduling an already-rescheduled occurrence and creates no second successor', function () {
    $target = tuesdaySession($this->schedule, '2026-06-09');

    Sanctum::actingAs($this->owner);
    // First reschedule succeeds and spawns exactly one successor.
    $first = $this->postJson("/api/sessions/{$target->id}/reschedule", [
        'local_datetime' => '2026-06-10 18:00', 'timezone' => 'Africa/Cairo',
    ])->assertCreated();
    $successorId = $first->json('sessionId');

    // A second reschedule of the SAME (now RESCHEDULED) origin is rejected — no new row appears.
    $this->postJson("/api/sessions/{$target->id}/reschedule", [
        'local_datetime' => '2026-06-11 18:00', 'timezone' => 'Africa/Cairo',
    ])->assertStatus(422);

    $this->asAcademy($this->academy);
    // Only the single successor exists; the origin is still RESCHEDULED, not re-touched.
    expect(DB::table('sessions')->where('original_session_id', $target->id)->count())->toBe(1);
    expect(DB::table('sessions')->where('original_session_id', $target->id)->value('id'))->toBe($successorId);
    expect(DB::table('sessions')->where('id', $target->id)->value('status'))->toBe('RESCHEDULED');
});

// ── TC-5.9 / AC-5.3 / §4.5: regeneration never resurrects a rescheduled row ───
it('does not recreate or duplicate a rescheduled occurrence on regeneration', function () {
    $target = tuesdaySession($this->schedule, '2026-06-09');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$target->id}/reschedule", ['local_datetime' => '2026-06-10 18:00', 'timezone' => 'Africa/Cairo'])->assertCreated();

    $this->asAcademy($this->academy);
    $countBefore = DB::table('sessions')->where('schedule_id', $this->schedule)->count();
    app(SessionGenerator::class)->generateForSchedule($this->schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31'));
    $countAfter = DB::table('sessions')->where('schedule_id', $this->schedule)->count();

    // The RESCHEDULED original is "touched" → not removed, not duplicated. No 06-09 SCHEDULED reborn.
    expect($countAfter)->toBe($countBefore);
    expect(DB::table('sessions')->where('schedule_id', $this->schedule)->where('occurrence_local_date', '2026-06-09')->where('status', 'SCHEDULED')->exists())->toBeFalse();
    expect(DB::table('sessions')->where('id', $target->id)->value('status'))->toBe('RESCHEDULED');
});

// ── Calendar/day views hide the RESCHEDULED marker so a move isn't a duplicate ──
it('does not show the rescheduled original on the calendar or day view, only the successor', function () {
    $target = tuesdaySession($this->schedule, '2026-06-09'); // Tue 17:00 Cairo = 14:00 UTC
    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/sessions/{$target->id}/reschedule", [
        'local_datetime' => '2026-06-10 18:00', 'timezone' => 'Africa/Cairo',
    ])->assertCreated();
    $successorId = $res->json('sessionId');

    // Calendar window spanning both the old (06-09) and new (06-10) days.
    $calendar = $this->getJson('/api/calendar?from=2026-06-09&to=2026-06-10')->assertOk();
    $ids = collect($calendar->json('sessions'))->pluck('id');
    expect($ids)->toContain($successorId);          // the moved occurrence shows...
    expect($ids)->not->toContain($target->id);      // ...the old RESCHEDULED marker does not.

    // Same for the attendance day view (default, no status filter).
    $day = $this->getJson('/api/sessions/day?from=2026-06-09T00:00:00Z&to=2026-06-11T00:00:00Z')->assertOk();
    $dayIds = collect($day->json('sessions'))->pluck('id');
    expect($dayIds)->toContain($successorId);
    expect($dayIds)->not->toContain($target->id);

    // An explicit ?status=RESCHEDULED still surfaces it for a history view.
    $hist = $this->getJson('/api/sessions/day?from=2026-06-09T00:00:00Z&to=2026-06-11T00:00:00Z&status=RESCHEDULED')->assertOk();
    expect(collect($hist->json('sessions'))->pluck('id'))->toContain($target->id);
});

// ── TC-5.10 / AC-5.4: cancels set the right non-billable status; others unchanged ─
it('cancels by teacher and by student with the correct non-billable status', function () {
    $a = tuesdaySession($this->schedule, '2026-06-09');
    $b = tuesdaySession($this->schedule, '2026-06-16');
    $othersBefore = DB::table('sessions')->where('schedule_id', $this->schedule)->whereNotIn('id', [$a->id, $b->id])->orderBy('id')->get()->toArray();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$a->id}/cancel", ['cancelled_by' => 'teacher', 'reason' => 'sick'])->assertOk();
    $this->postJson("/api/sessions/{$b->id}/cancel", ['cancelled_by' => 'student'])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $a->id)->value('status'))->toBe('CANCELLED_BY_TEACHER');
    expect(DB::table('sessions')->where('id', $b->id)->value('status'))->toBe('CANCELLED_BY_STUDENT');
    expect(DB::table('sessions')->where('id', $a->id)->value('status_reason'))->toBe('sick');
    expect(DB::table('sessions')->where('id', $a->id)->value('billed'))->toBeFalsy(); // no billing (AC-5.12)

    $othersAfter = DB::table('sessions')->where('schedule_id', $this->schedule)->whereNotIn('id', [$a->id, $b->id])->orderBy('id')->get()->toArray();
    expect($othersAfter)->toEqual($othersBefore);
});

// ── TC-5.11 / AC-5.5 / §4.5: cancelled/rescheduled survive a later schedule edit ─
it('preserves cancelled and rescheduled sessions when the schedule is later edited', function () {
    $cancel = tuesdaySession($this->schedule, '2026-06-09');
    $resched = tuesdaySession($this->schedule, '2026-06-16');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$cancel->id}/cancel", ['cancelled_by' => 'teacher'])->assertOk();
    $this->postJson("/api/sessions/{$resched->id}/reschedule", ['local_datetime' => '2026-06-17 18:00', 'timezone' => 'Africa/Cairo'])->assertCreated();

    // Edit the schedule: move Tuesday to Wednesday entirely (removes the Tue slot).
    $this->putJson("/api/students/{$this->student}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertOk();

    $this->asAcademy($this->academy);
    // Both touched rows are preserved verbatim.
    expect(DB::table('sessions')->where('id', $cancel->id)->value('status'))->toBe('CANCELLED_BY_TEACHER');
    expect(DB::table('sessions')->where('id', $resched->id)->value('status'))->toBe('RESCHEDULED');
});
