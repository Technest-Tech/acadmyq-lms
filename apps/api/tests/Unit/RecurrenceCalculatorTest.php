<?php

declare(strict_types=1);

use App\Support\RecurrenceCalculator;
use App\Support\TimeHelper;

/**
 * Unit coverage for the pure recurrence/timezone core (§4, §12 "build it as a separately
 * unit-tested module first"). No DB — every assertion is on the enumerated occurrence set and
 * its per-date UTC conversion, the part where the DST bugs live.
 */
function slot(string $id, int $weekday, string $start = '17:00:00', int $duration = 30): array
{
    return ['id' => $id, 'weekday' => $weekday, 'start_time_local' => $start, 'duration_minutes' => $duration];
}

// ── TC-5.1: Sun/Tue/Thu over a window → exact dates & UTC instants ────────────
it('enumerates the exact matching dates with correct UTC instants', function () {
    // 0=Sun, 2=Tue, 4=Thu. June 2026, Cairo (DST, UTC+3 → 17:00 local = 14:00 UTC).
    $slots = [slot('a', 0), slot('b', 2), slot('c', 4)];
    $occ = RecurrenceCalculator::occurrences($slots, 'Africa/Cairo', '2026-06-01', '2026-06-14');

    // Two weeks: each of Sun/Tue/Thu appears twice = 6 occurrences.
    expect($occ)->toHaveCount(6);

    $dates = array_map(fn ($o) => $o['occurrence_local_date'], $occ);
    expect($dates)->toBe([
        '2026-06-02', // Tue
        '2026-06-04', // Thu
        '2026-06-07', // Sun
        '2026-06-09', // Tue
        '2026-06-11', // Thu
        '2026-06-14', // Sun
    ]);

    // Every instant is the correct UTC for 17:00 Cairo on its date.
    foreach ($occ as $o) {
        expect($o['scheduled_at_utc']->toIso8601String())
            ->toBe(TimeHelper::toUtc($o['occurrence_local_date'].' 17:00', 'Africa/Cairo')->toIso8601String());
        expect(TimeHelper::renderInTimezone($o['scheduled_at_utc'], 'Africa/Cairo', 'H:i'))->toBe('17:00');
    }
});

// ── TC-5.2: different times & durations per weekday ──────────────────────────
it('carries per-weekday times and durations independently', function () {
    $slots = [
        slot('mon', 1, '16:00:00', 30),
        slot('thu', 4, '17:00:00', 45),
    ];
    $occ = RecurrenceCalculator::occurrences($slots, 'Africa/Cairo', '2026-06-01', '2026-06-07');

    $mon = collect($occ)->firstWhere('occurrence_local_date', '2026-06-01'); // Monday
    $thu = collect($occ)->firstWhere('occurrence_local_date', '2026-06-04'); // Thursday

    expect($mon['duration_minutes'])->toBe(30);
    expect(TimeHelper::renderInTimezone($mon['scheduled_at_utc'], 'Africa/Cairo', 'H:i'))->toBe('16:00');
    expect($thu['duration_minutes'])->toBe(45);
    expect(TimeHelper::renderInTimezone($thu['scheduled_at_utc'], 'Africa/Cairo', 'H:i'))->toBe('17:00');
});

// ── TC-5.3: partial first week (window starts mid-week) ──────────────────────
it('only emits matching weekdays inside the window (partial first week)', function () {
    // Window starts Wed 2026-06-03; a Mon(1)+Wed(3) schedule should skip the already-past Mon.
    $slots = [slot('mon', 1), slot('wed', 3)];
    $occ = RecurrenceCalculator::occurrences($slots, 'Africa/Cairo', '2026-06-03', '2026-06-08');

    $dates = array_map(fn ($o) => $o['occurrence_local_date'], $occ);
    expect($dates)->toBe(['2026-06-03', '2026-06-08']); // Wed, then next Mon — no 06-01 Mon.
});

// ── TC-5.4: a weekday with no slot produces nothing ──────────────────────────
it('produces no occurrence for a weekday that has no slot', function () {
    $slots = [slot('fri', 5)]; // Friday only
    $occ = RecurrenceCalculator::occurrences($slots, 'Africa/Cairo', '2026-06-01', '2026-06-04'); // Mon..Thu

    expect($occ)->toBe([]);
});

// ── TC-5.12: DST boundary, northern hemisphere — local fixed, UTC shifts ─────
it('keeps the local wall-clock fixed across a Cairo DST boundary (UTC shifts)', function () {
    // Egypt springs forward on the last Friday of April 2026 (2026-04-24): +02:00 → +03:00.
    $slots = [slot('fri', 5)]; // every Friday at 17:00 local
    $occ = RecurrenceCalculator::occurrences($slots, 'Africa/Cairo', '2026-04-17', '2026-05-01');

    $before = collect($occ)->firstWhere('occurrence_local_date', '2026-04-17'); // pre-DST
    $after = collect($occ)->firstWhere('occurrence_local_date', '2026-05-01');  // post-DST

    // Local time identical on both sides…
    expect(TimeHelper::renderInTimezone($before['scheduled_at_utc'], 'Africa/Cairo', 'H:i'))->toBe('17:00');
    expect(TimeHelper::renderInTimezone($after['scheduled_at_utc'], 'Africa/Cairo', 'H:i'))->toBe('17:00');
    // …but the UTC instant differs by exactly the one-hour offset change.
    expect($before['scheduled_at_utc']->format('H:i'))->toBe('15:00'); // UTC+2
    expect($after['scheduled_at_utc']->format('H:i'))->toBe('14:00');  // UTC+3
});

// ── TC-5.13: DST boundary, SOUTHERN hemisphere (opposite sign) ───────────────
it('handles a southern-hemisphere DST boundary in the opposite direction', function () {
    // America/Santiago falls back around 2026-04-04 (autumn there): UTC-3 → UTC-4.
    $slots = [slot('wed', 3)]; // Wednesdays at 17:00 local
    $occ = RecurrenceCalculator::occurrences($slots, 'America/Santiago', '2026-03-25', '2026-04-15');

    $summer = collect($occ)->firstWhere('occurrence_local_date', '2026-03-25'); // DST (UTC-3)
    $winter = collect($occ)->firstWhere('occurrence_local_date', '2026-04-15'); // standard (UTC-4)

    expect(TimeHelper::renderInTimezone($summer['scheduled_at_utc'], 'America/Santiago', 'H:i'))->toBe('17:00');
    expect(TimeHelper::renderInTimezone($winter['scheduled_at_utc'], 'America/Santiago', 'H:i'))->toBe('17:00');
    // Sign flips relative to Cairo: the later (winter) instant is LATER in UTC, not earlier.
    expect($summer['scheduled_at_utc']->format('H:i'))->toBe('20:00'); // UTC-3
    expect($winter['scheduled_at_utc']->format('H:i'))->toBe('21:00'); // UTC-4
});

// ── TC-5.14: a no-DST timezone is consistent year-round ──────────────────────
it('keeps a constant offset for Asia/Riyadh on both sides of the year', function () {
    $slots = [slot('thu', 4)];
    $jan = RecurrenceCalculator::occurrences($slots, 'Asia/Riyadh', '2026-01-01', '2026-01-07');
    $jul = RecurrenceCalculator::occurrences($slots, 'Asia/Riyadh', '2026-07-01', '2026-07-07');

    expect($jan[0]['scheduled_at_utc']->format('H:i'))->toBe('14:00');
    expect($jul[0]['scheduled_at_utc']->format('H:i'))->toBe('14:00');
});

// ── TC-5.16: a non-existent spring-forward wall-clock resolves deterministically ─
it('resolves a non-existent spring-forward time to the next valid instant', function () {
    // Europe/London springs forward 2026-03-29 (Sunday) 01:00→02:00; local 01:30 does not exist.
    $slots = [slot('sun', 0, '01:30:00')];
    $occ = RecurrenceCalculator::occurrences($slots, 'Europe/London', '2026-03-29', '2026-03-29');

    expect($occ)->toHaveCount(1);
    // Deterministic instant; rendering it back lands on the first valid wall-clock after the gap.
    expect($occ[0]['scheduled_at_utc']->toIso8601String())->toBe('2026-03-29T01:30:00+00:00');
    expect(TimeHelper::renderInTimezone($occ[0]['scheduled_at_utc'], 'Europe/London', 'H:i'))->toBe('02:30');
});

// ── empty slots short-circuit ────────────────────────────────────────────────
it('returns nothing for a schedule with no slots', function () {
    expect(RecurrenceCalculator::occurrences([], 'Africa/Cairo', '2026-06-01', '2026-06-30'))->toBe([]);
});
