<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\CountryClocks;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Which clock a weekly timetable is tied to, and moving it from one clock to another WITHOUT moving
 * a single lesson.
 *
 * A timetable says "Sundays at 20:00" on some clock (`schedules.timezone`). Tied to the academy's
 * clock, the lesson keeps its hour for the teacher and shifts for a student abroad every time either
 * country changes its clocks. Tied to the student's country, it keeps its hour for the student and
 * the teacher's hour follows. After Egypt's change on 30 Oct 2026 three academies moved timetables
 * and lessons by hand, an hour at a time, to get the second behaviour.
 *
 * Re-tying rewrites each day and time as the SAME instants read on the new clock (Sunday 20:00 Cairo
 * is Sunday 21:00 Riyadh in winter), so nothing moves on the day it is done; from the next clock
 * change on, the lessons follow the new clock. The slot rows keep their ids and every lesson keeps
 * its slot, so history, marks and money are untouched.
 */
final class ScheduleAnchor
{
    private const WEEK = 10080; // minutes

    public function __construct(private readonly SessionGenerator $generator) {}

    /**
     * A slot's day and time as they read on another clock, as of `$at`.
     *
     * @return array{weekday:int, time:string} time is "H:i"
     */
    public static function onClock(int $weekday, string $time, string $fromTimezone, string $toTimezone, ?Carbon $at = null): array
    {
        $delta = self::gapMinutes($fromTimezone, $toTimezone, $at);
        $position = self::wrap($weekday * 1440 + self::minutes($time) + $delta);

        return [
            'weekday' => intdiv($position, 1440),
            'time' => sprintf('%02d:%02d', intdiv($position % 1440, 60), $position % 60),
        ];
    }

    /** Minutes the second clock is ahead of the first, as of `$at` (Cairo → Riyadh in winter: 60). */
    public static function gapMinutes(string $fromTimezone, string $toTimezone, ?Carbon $at = null): int
    {
        $at ??= Carbon::now();

        return CountryClocks::offsetMinutes($toTimezone, $at) - CountryClocks::offsetMinutes($fromTimezone, $at);
    }

    /**
     * Tie one timetable to another clock, keeping every lesson where it is today.
     *
     * Runs inside the caller's tenant context and transaction.
     *
     * @return array{moved:bool, from:string, to:string, slots:list<array{weekday:int, start_time_local:string}>}
     */
    public function move(string $scheduleId, string $timezone, ?Carbon $now = null): array
    {
        $now ??= Carbon::now();
        $schedule = DB::table('schedules')->where('id', $scheduleId)->lockForUpdate()->first();
        if ($schedule === null) {
            return ['moved' => false, 'from' => '', 'to' => $timezone, 'slots' => []];
        }

        $from = (string) $schedule->timezone;
        if ($from === $timezone) {
            return ['moved' => false, 'from' => $from, 'to' => $timezone, 'slots' => []];
        }

        $delta = self::gapMinutes($from, $timezone, $now);
        $slots = DB::table('schedule_slots')->where('schedule_id', $scheduleId)->get(['id', 'weekday', 'start_time_local']);

        // Where each slot sits now and where it goes, as minutes into the week.
        $pending = [];
        foreach ($slots as $slot) {
            $at = (int) $slot->weekday * 1440 + self::minutes((string) $slot->start_time_local);
            $pending[(string) $slot->id] = [
                'at' => $at,
                'to' => self::wrap($at + $delta),
                // How many days the slot's date moves (Saturday 23:30 → Sunday 00:30 is +1).
                'days' => (int) floor(($at + $delta) / 1440) - (int) $slot->weekday,
            ];
        }
        $dayShift = array_filter(array_map(fn (array $p) => $p['days'], $pending));

        // (schedule, weekday, time) is unique and checked row by row, so a slot may only move onto a
        // place another slot has already left: two lessons an hour apart, shifted an hour, would
        // otherwise collide halfway through.
        $written = [];
        while ($pending !== []) {
            $occupied = array_column($pending, 'at');
            $progress = false;
            foreach ($pending as $id => $p) {
                if ($p['to'] !== $p['at'] && in_array($p['to'], $occupied, true)) {
                    continue;
                }
                DB::table('schedule_slots')->where('id', $id)->update([
                    'weekday' => intdiv($p['to'], 1440),
                    'start_time_local' => sprintf('%02d:%02d:00', intdiv($p['to'] % 1440, 60), $p['to'] % 60),
                    'updated_at' => $now->format('Y-m-d H:i:sP'),
                ]);
                $written[] = ['weekday' => intdiv($p['to'], 1440), 'start_time_local' => sprintf('%02d:%02d', intdiv($p['to'] % 1440, 60), $p['to'] % 60)];
                unset($pending[$id]);
                $progress = true;
            }
            if (! $progress) {
                // A full ring of slots each waiting on the next: not a timetable anyone has.
                throw new \RuntimeException('Timetable slots could not be re-tied without colliding.');
            }
        }

        // A lesson's "local date" is its date on the timetable's clock, and the generator finds a
        // lesson by it (date + slot). Read on the new clock a late-night lesson falls on the next
        // day, so its date moves with its slot: the lesson is then found and kept, not replaced.
        foreach ($dayShift as $slotId => $days) {
            DB::update(
                'update sessions set occurrence_local_date = occurrence_local_date + ?::int
                 where slot_id = ? and occurrence_local_date is not null',
                [$days, $slotId],
            );
        }
        // A lesson whose slot was since retimed has no slot to go by: file it by its own instant.
        DB::update(
            'update sessions set occurrence_local_date = (scheduled_at_utc at time zone ?)::date
             where schedule_id = ? and slot_id is null and occurrence_local_date is not null',
            [$timezone, $scheduleId],
        );

        DB::table('schedules')->where('id', $scheduleId)->update([
            'timezone' => $timezone,
            'version' => DB::raw('version + 1'),
            'updated_at' => $now->format('Y-m-d H:i:sP'),
        ]);

        // Lessons already planned beyond the next clock change now follow the new clock.
        [$windowStart, $windowEnd] = SessionGenerator::defaultWindow($now);
        $this->generator->generateForSchedule($scheduleId, $windowStart, $windowEnd, $now);

        usort($written, fn ($a, $b) => [$a['weekday'], $a['start_time_local']] <=> [$b['weekday'], $b['start_time_local']]);

        return ['moved' => true, 'from' => $from, 'to' => $timezone, 'slots' => $written];
    }

    private static function minutes(string $time): int
    {
        [$h, $m] = array_map('intval', array_slice(explode(':', $time), 0, 2) + [0, 0]);

        return $h * 60 + $m;
    }

    private static function wrap(int $position): int
    {
        return (($position % self::WEEK) + self::WEEK) % self::WEEK;
    }
}
