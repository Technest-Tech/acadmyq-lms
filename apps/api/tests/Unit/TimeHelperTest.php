<?php

declare(strict_types=1);

use App\Support\TimeHelper;

it('converts a local wall-clock time to the correct UTC instant', function (): void {
    // TC-0.6 — Africa/Cairo is UTC+2 (no DST since 2015 baseline; +3 during summer DST).
    $utc = TimeHelper::toUtc('2026-06-10 18:00', 'Africa/Cairo');

    // June 2026: Egypt observes DST (+03:00), so 18:00 Cairo == 15:00 UTC.
    expect($utc->toIso8601String())->toBe('2026-06-10T15:00:00+00:00');
});

it('renders a UTC instant as wall-clock in a target timezone', function (): void {
    // TC-0.7
    $utc = TimeHelper::toUtc('2026-06-10 15:00', 'UTC');

    expect(TimeHelper::renderInTimezone($utc, 'Asia/Riyadh'))
        ->toBe('2026-06-10 18:00'); // Riyadh is UTC+3, no DST.
});

it('round-trips across a DST boundary without drift', function (): void {
    // TC-0.8 — Europe/London springs forward on 2026-03-29 01:00 -> 02:00.
    // A time after the transition must round-trip back to the same wall clock.
    $tz = 'Europe/London';
    $local = '2026-06-15 12:30';

    $utc = TimeHelper::toUtc($local, $tz);
    $rendered = TimeHelper::renderInTimezone($utc, $tz);

    expect($rendered)->toBe($local);
});
