<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * The pure recurrence/timezone core of the Sprint 5 generator (§4 — "the crux"), deliberately
 * DB-free so it can be unit-tested in isolation against the DST edge cases before any session
 * row is written (§12).
 *
 * Given a schedule's weekly slots and a local-date window, it enumerates the concrete
 * occurrences, converting EACH occurrence's local wall-clock time to UTC *independently*
 * (TimeHelper::toUtc) so a DST transition inside the window shifts the UTC instant by exactly
 * the offset change while the local time it represents stays put (§4.3, TC-5.12/5.13/5.14).
 *
 * Conventions held constant here and nowhere re-derived (§3.9):
 *  - Weekday: 0=Sunday … 6=Saturday. Carbon's `dayOfWeek` uses the identical numbering.
 *  - Window bounds are inclusive LOCAL calendar dates ("Y-m-d").
 *  - Non-existent spring-forward wall-clock times resolve deterministically to the next valid
 *    instant — this is PHP/Carbon's native normalisation of a gap, asserted by TC-5.16.
 */
final class RecurrenceCalculator
{
    /**
     * Enumerate occurrences for the window, one per (slot, matching date).
     *
     * @param  list<array{id:string, weekday:int, start_time_local:string, duration_minutes:int}>  $slots
     * @param  string  $windowStart  inclusive local date "Y-m-d"
     * @param  string  $windowEnd  inclusive local date "Y-m-d"
     * @return list<array{
     *   slot_id:string,
     *   weekday:int,
     *   occurrence_local_date:string,
     *   scheduled_at_utc:Carbon,
     *   duration_minutes:int
     * }>  ordered by occurrence instant then slot
     */
    public static function occurrences(array $slots, string $timezone, string $windowStart, string $windowEnd): array
    {
        if ($slots === []) {
            return [];
        }

        // Group slots by weekday so each date only inspects the slots that can match it.
        $byWeekday = [];
        foreach ($slots as $slot) {
            $byWeekday[$slot['weekday']][] = $slot;
        }

        $occurrences = [];

        // Iterate the window as plain calendar dates (date-only, so no tz/DST ambiguity on the
        // cursor itself — the only conversion that matters is the per-occurrence one below).
        $cursor = Carbon::parse($windowStart)->startOfDay();
        $end = Carbon::parse($windowEnd)->startOfDay();

        while ($cursor->lessThanOrEqualTo($end)) {
            $weekday = $cursor->dayOfWeek; // 0=Sun … 6=Sat
            $localDate = $cursor->format('Y-m-d');

            foreach ($byWeekday[$weekday] ?? [] as $slot) {
                // Per-date local→UTC: a wall clock on this exact date, converted with this
                // date's offset (DST-correct). Normalises a spring-forward gap forward.
                $localNaive = $localDate.' '.self::normaliseTime($slot['start_time_local']);
                $utc = TimeHelper::toUtc($localNaive, $timezone);

                $occurrences[] = [
                    'slot_id' => $slot['id'],
                    'weekday' => $weekday,
                    'occurrence_local_date' => $localDate,
                    'scheduled_at_utc' => $utc,
                    'duration_minutes' => $slot['duration_minutes'],
                ];
            }

            $cursor->addDay();
        }

        usort($occurrences, static function (array $a, array $b): int {
            return $a['scheduled_at_utc']->equalTo($b['scheduled_at_utc'])
                ? strcmp($a['slot_id'], $b['slot_id'])
                : ($a['scheduled_at_utc']->lessThan($b['scheduled_at_utc']) ? -1 : 1);
        });

        return $occurrences;
    }

    /** Accept "17:00" or "17:00:00" TIME values uniformly as "H:i:s". */
    private static function normaliseTime(string $time): string
    {
        return substr_count($time, ':') === 1 ? $time.':00' : $time;
    }
}
