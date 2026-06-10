<?php

declare(strict_types=1);

use App\Services\SessionGenerator;
use App\Support\RecurrenceCalculator;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Gen Teacher']);
    $this->student = $this->createStudent($this->academy);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
    $this->generator = app(SessionGenerator::class);
});

afterEach(fn () => Carbon::setTestNow());

/** Re-derive the intended set straight from the DB slots, to compare against generated rows. */
function expectedOccurrences(string $academy, string $scheduleId, string $tz, string $from, string $to): array
{
    $slots = DB::table('schedule_slots')->where('schedule_id', $scheduleId)->orderBy('id')
        ->get(['id', 'weekday', 'start_time_local', 'duration_minutes'])
        ->map(fn ($s) => ['id' => (string) $s->id, 'weekday' => (int) $s->weekday, 'start_time_local' => (string) $s->start_time_local, 'duration_minutes' => (int) $s->duration_minutes])
        ->all();

    return RecurrenceCalculator::occurrences($slots, $tz, $from, $to);
}

// ── TC-5.1 / AC-5.1: exact occurrences & correct UTC across a 2-month window ──
it('generates the exact occurrences with correct UTC instants', function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    foreach ([0, 2, 4] as $weekday) { // Sun, Tue, Thu
        $this->addSlot($this->academy, $schedule, $weekday, '17:00:00', 30);
    }

    $this->asAcademy($this->academy);
    $counts = $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31'));

    $expected = expectedOccurrences($this->academy, $schedule, 'Africa/Cairo', '2026-06-01', '2026-07-31');
    $this->asAcademy($this->academy);
    $rows = DB::table('sessions')->where('schedule_id', $schedule)->get();

    expect($rows)->toHaveCount(count($expected));
    expect($counts['created'])->toBe(count($expected));

    // Spot-check: first Tuesday in June 2026 at 17:00 Cairo (DST +3) is 14:00 UTC.
    $tue = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-02')->first();
    expect($tue)->not->toBeNull();
    expect(Carbon::parse($tue->scheduled_at_utc)->utc()->toIso8601String())->toBe('2026-06-02T14:00:00+00:00');
    // No billable side effects this sprint (AC-5.12).
    expect($rows->every(fn ($r) => $r->status === 'SCHEDULED' && ! $r->billed && ! $r->paid_to_teacher))->toBeTrue();
});

// ── TC-5.2 / AC-5.1: different times & durations per weekday ──────────────────
it('carries per-weekday times and durations onto the sessions', function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '16:00:00', 30); // Monday 30m
    $this->addSlot($this->academy, $schedule, 4, '17:00:00', 45); // Thursday 45m

    $this->asAcademy($this->academy);
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-07'));

    $mon = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-01')->first();
    $thu = DB::table('sessions')->where('schedule_id', $schedule)->where('occurrence_local_date', '2026-06-04')->first();

    expect($mon->duration_minutes)->toBe(30);
    expect((int) ($thu->duration_minutes))->toBe(45);
    // 16:00 Cairo = 13:00 UTC; 17:00 Cairo = 14:00 UTC (June, +3).
    expect(Carbon::parse($mon->scheduled_at_utc)->utc()->format('H:i'))->toBe('13:00');
    expect(Carbon::parse($thu->scheduled_at_utc)->utc()->format('H:i'))->toBe('14:00');
});

// ── TC-5.3 / AC-5.1: partial first week — no past-dated rows ──────────────────
it('does not back-fill past occurrences within the window', function () {
    // "Now" is mid-week, after the Wed 17:00 slot has already passed in UTC.
    Carbon::setTestNow('2026-06-03 15:00:00'); // 06-03 17:00 Cairo = 14:00 UTC < now
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1); // Monday
    $this->addSlot($this->academy, $schedule, 3); // Wednesday

    $this->asAcademy($this->academy);
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-30'));

    $dates = DB::table('sessions')->where('schedule_id', $schedule)->orderBy('occurrence_local_date')->pluck('occurrence_local_date');
    // 06-01 (Mon) and 06-03 (Wed) are in the past → skipped; first is 06-08 (Mon).
    expect($dates->first())->toBe('2026-06-08');
    expect($dates->contains('2026-06-01'))->toBeFalse();
    expect($dates->contains('2026-06-03'))->toBeFalse();
});

// ── TC-5.4 / AC-5.1: a weekday with no slot produces nothing ──────────────────
it('produces no session for a weekday without a slot', function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 5); // Friday only

    $this->asAcademy($this->academy);
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-04')); // Mon..Thu

    expect(DB::table('sessions')->where('schedule_id', $schedule)->count())->toBe(0);
});

// ── TC-5.5 / AC-5.2: re-running is idempotent (no duplicates, stable counts) ──
it('is idempotent on re-run', function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 2); // Tuesday

    $this->asAcademy($this->academy);
    $first = $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31'));
    $countAfterFirst = DB::table('sessions')->where('schedule_id', $schedule)->count();

    $this->asAcademy($this->academy);
    $second = $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31'));
    $countAfterSecond = DB::table('sessions')->where('schedule_id', $schedule)->count();

    expect($first['created'])->toBeGreaterThan(0);
    expect($second['created'])->toBe(0);
    expect($second['removed'])->toBe(0);
    expect($countAfterSecond)->toBe($countAfterFirst);
});

// ── TC-5.6 / AC-5.2: extending the window adds only the new month ─────────────
it('adds only the new month when the window is extended', function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 2); // Tuesday

    $this->asAcademy($this->academy);
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-30'));
    $juneCount = DB::table('sessions')->where('schedule_id', $schedule)->count();

    $this->asAcademy($this->academy);
    $extended = $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-07-31'));
    $totalCount = DB::table('sessions')->where('schedule_id', $schedule)->count();

    $julyTuesdays = DB::table('sessions')->where('schedule_id', $schedule)
        ->where('occurrence_local_date', '>=', '2026-07-01')->count();

    expect($extended['created'])->toBe($julyTuesdays);
    expect($extended['removed'])->toBe(0);
    expect($totalCount)->toBe($juneCount + $julyTuesdays);
});

// ── TC-5.7 / AC-5.2: the unique occurrence index backstops concurrency ────────
it('rejects a duplicate occurrence at the database level', function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $slotId = $this->addSlot($this->academy, $schedule, 2); // Tuesday

    $this->asAcademy($this->academy);
    $this->generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-30'));

    $existing = DB::table('sessions')->where('schedule_id', $schedule)->first();

    // Two concurrent runs would each try to insert the same (schedule, date, slot); the partial
    // unique index makes the second a hard error rather than a duplicate row. Wrapped in a
    // savepoint (nested transaction) so the constraint violation rolls back only this insert and
    // the surrounding test transaction stays usable.
    $this->asAcademy($this->academy);
    expect(fn () => DB::transaction(fn () => DB::table('sessions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'teacher_id' => $this->teacher,
        'schedule_id' => $schedule,
        'slot_id' => $slotId,
        'occurrence_local_date' => $existing->occurrence_local_date,
        'scheduled_at_utc' => $existing->scheduled_at_utc,
        'duration_minutes' => 30,
        'status' => 'SCHEDULED',
    ])))->toThrow(QueryException::class);

    // insertOrIgnore (what the generator uses) silently no-ops instead of duplicating.
    $this->asAcademy($this->academy);
    $ignored = DB::table('sessions')->insertOrIgnore([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy, 'student_id' => $this->student, 'teacher_id' => $this->teacher,
        'schedule_id' => $schedule, 'slot_id' => $slotId,
        'occurrence_local_date' => $existing->occurrence_local_date, 'scheduled_at_utc' => $existing->scheduled_at_utc,
        'duration_minutes' => 30, 'status' => 'SCHEDULED',
    ]);
    expect($ignored)->toBe(0);
});
