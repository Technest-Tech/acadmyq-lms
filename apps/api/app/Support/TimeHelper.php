<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * Time conventions (Master Spec §6.3): store UTC, render in a target timezone.
 *
 * Recurring schedules are stored as rules; concrete sessions as UTC datetimes.
 * These helpers are the single boundary for local<->UTC conversion so the
 * convention is applied consistently.
 */
final class TimeHelper
{
    /**
     * Interpret a wall-clock string as local time in $timezone and convert to UTC.
     *
     * @param  string  $localTime  e.g. "2026-06-10 18:00"
     * @param  string  $timezone  IANA tz, e.g. "Africa/Cairo"
     */
    public static function toUtc(string $localTime, string $timezone): Carbon
    {
        return Carbon::parse($localTime, $timezone)->utc();
    }

    /**
     * Render a UTC instant as a wall-clock string in $timezone.
     *
     * @param  string  $format  defaults to ISO-like "Y-m-d H:i"
     */
    public static function renderInTimezone(Carbon $utc, string $timezone, string $format = 'Y-m-d H:i'): string
    {
        return $utc->copy()->setTimezone($timezone)->format($format);
    }
}
