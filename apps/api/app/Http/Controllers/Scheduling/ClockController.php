<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\ScheduleAnchor;
use App\Support\Audit;
use App\Support\CountryClocks;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Clocks: the academy's own, the ones its students live on, and what happens to lessons when any
 * of them changes.
 *
 * Most students of an online academy live abroad. A timetable tied to the academy's clock moves on
 * the student's clock whenever EITHER country changes its time (Egypt 30 Oct 2026: every Gulf
 * student's lesson came an hour later at home, and the desks moved lessons by hand). These
 * endpoints say who is in that position, warn before the next change, and tie timetables to the
 * student's own clock so the change takes care of itself.
 */
final class ClockController extends Controller
{
    use InteractsWithScheduling;

    /** How far back a change is still worth showing, and how far ahead it is announced. */
    private const BACK_DAYS = 14;

    private const AHEAD_DAYS = 60;

    public function __construct(private readonly ScheduleAnchor $anchor) {}

    /** GET /api/clock/zones — the academy's clock and every country's, for the timetable form. */
    public function zones(): JsonResponse
    {
        Gate::authorize('schedule.read');
        $timezone = $this->academyTimezone($this->currentAcademyId());

        return response()->json([
            'timezone' => $timezone,
            'country' => $this->academyCountry($timezone),
            'countries' => CountryClocks::catalogue(),
        ]);
    }

    /**
     * GET /api/clock/changes — clock changes around now in any country this academy teaches in, how
     * many timetables each one moves, and the students abroad still tied to the academy's clock.
     */
    public function changes(): JsonResponse
    {
        Gate::authorize('schedule.manage');

        $academyId = $this->currentAcademyId();
        $academyTz = $this->academyTimezone($academyId);
        $academyCountry = $this->academyCountry($academyTz);
        $now = Carbon::now();

        $timetables = $this->liveTimetables($academyTz, $academyCountry);

        // Every clock in play: the academy's, the ones timetables are tied to, the ones students live on.
        $zones = [$academyTz => true];
        foreach ($timetables as $t) {
            $zones[$t['timezone']] = true;
            if ($t['home'] !== null) {
                $zones[$t['home']] = true;
            }
        }

        // One entry per calendar day: a country's zones all change that day, hours apart.
        $days = [];
        $from = $now->copy()->subDays(self::BACK_DAYS)->getTimestamp();
        $to = $now->copy()->addDays(self::AHEAD_DAYS)->getTimestamp();
        foreach (array_keys($zones) as $zone) {
            foreach (CountryClocks::changes($zone, $from, $to) as $change) {
                $date = Carbon::createFromTimestamp($change['at'], $zone)->format('Y-m-d');
                $days[$date] ??= ['date' => $date, 'first' => $change['at'], 'last' => $change['at'], 'places' => []];
                $days[$date]['first'] = min($days[$date]['first'], $change['at']);
                $days[$date]['last'] = max($days[$date]['last'], $change['at']);
                $country = CountryClocks::countryOf($zone) ?? $zone;
                $days[$date]['places'][$country.'|'.$change['shift_minutes']] ??= [
                    'country' => $country,
                    'timezone' => $zone,
                    'shift_minutes' => $change['shift_minutes'],
                    'is_academy' => $zone === $academyTz,
                ];
            }
        }
        ksort($days);

        $changes = [];
        foreach ($days as $day) {
            $before = Carbon::createFromTimestamp($day['first'] - 3600);
            $after = Carbon::createFromTimestamp($day['last'] + 3600);
            $jump = fn (string $zone): int => CountryClocks::offsetMinutes($zone, $after) - CountryClocks::offsetMinutes($zone, $before);

            $onAcademy = [];
            $forStudent = [];
            foreach ($timetables as $t) {
                $tied = $jump($t['timezone']);
                $academyMoves = $jump($academyTz) - $tied;
                if ($academyMoves !== 0) {
                    $onAcademy[] = $academyMoves;
                }
                if ($t['home'] !== null) {
                    $studentMoves = $jump($t['home']) - $tied;
                    if ($studentMoves !== 0) {
                        $forStudent[] = $studentMoves;
                    }
                }
            }

            $places = array_values($day['places']);
            $isAcademy = (bool) array_filter($places, fn (array $p) => $p['is_academy']);
            if ($onAcademy === [] && $forStudent === [] && ! $isAcademy) {
                continue; // a change that touches no lesson here
            }

            $changes[] = [
                'date' => $day['date'],
                'past' => $day['last'] < $now->getTimestamp(),
                'places' => $places,
                // Timetables tied to another clock: their lessons move on the ACADEMY's clock.
                'moving_on_academy_clock' => count($onAcademy),
                'academy_shift_minutes' => self::usual($onAcademy),
                // Students whose own clock moves against the one their timetable is tied to.
                'moving_for_student' => count($forStudent),
                'student_shift_minutes' => self::usual($forStudent),
            ];
        }

        return response()->json([
            'timezone' => $academyTz,
            'country' => $academyCountry,
            'changes' => $changes,
            'abroad' => $this->abroad($timetables, $academyTz, $academyCountry, $now),
            'no_country' => count(array_filter($timetables, fn (array $t) => $t['country'] === null)),
        ]);
    }

    /**
     * POST /api/clock/anchor — tie the given timetables to a clock (a student's country, or back to
     * the academy's). No lesson moves when it is done; they follow the new clock from then on.
     */
    public function anchor(Request $request): JsonResponse
    {
        Gate::authorize('schedule.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'schedule_ids' => ['required', 'array', 'min:1', 'max:1000'],
            'schedule_ids.*' => ['required', 'uuid'],
            'timezone' => ['required', 'string', 'max:64', 'timezone'],
        ]);

        $ids = DB::table('schedules')
            ->whereIn('id', $data['schedule_ids'])
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();

        $moved = DB::transaction(function () use ($ids, $data, $academyId): int {
            $moved = 0;
            foreach ($ids as $id) {
                $result = $this->anchor->move($id, (string) $data['timezone']);
                if (! $result['moved']) {
                    continue;
                }
                $moved++;
                Audit::log('schedule.reanchored', 'schedule', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                    before: ['timezone' => $result['from']],
                    after: ['timezone' => $result['to'], 'slots' => $result['slots']]);
            }

            return $moved;
        });

        return response()->json(['moved' => $moved, 'unchanged' => count($data['schedule_ids']) - $moved]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * Every live timetable with the clock it is tied to and the clock its student lives on.
     *
     * @return list<array{schedule_id:string, student_id:string, student_name:?string, teacher_name:?string, timezone:string, country:?string, home:?string}>
     */
    private function liveTimetables(string $academyTz, ?string $academyCountry): array
    {
        $rows = DB::table('schedules as sch')
            ->join('students as st', 'st.id', '=', 'sch.student_id')
            ->leftJoin('guardians as gd', 'gd.id', '=', 'st.guardian_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'sch.teacher_id')
            ->where('sch.is_active', true)
            ->whereNull('sch.deleted_at')
            ->whereNull('st.deleted_at')
            ->orderBy('st.full_name')
            ->get([
                'sch.id', 'sch.student_id', 'sch.timezone', 'st.full_name as student_name',
                'te.full_name as teacher_name', 'st.country as student_country', 'gd.country as guardian_country',
            ]);

        return $rows->map(function ($r) use ($academyTz, $academyCountry): array {
            $timezone = (string) $r->timezone;
            $country = CountryClocks::code($r->student_country) ?? CountryClocks::code($r->guardian_country);

            // Where the student's own clock is: the zone the timetable names when it is in their
            // country (somebody chose Vancouver over Toronto), else their country's usual one.
            $home = null;
            if ($country === null) {
                $home = $timezone !== $academyTz ? $timezone : null;
            } elseif ($country === $academyCountry) {
                $home = $academyTz;
            } elseif (CountryClocks::countryOf($timezone) === $country) {
                $home = $timezone;
            } else {
                $home = CountryClocks::usual($country);
            }

            return [
                'schedule_id' => (string) $r->id,
                'student_id' => (string) $r->student_id,
                'student_name' => $r->student_name,
                'teacher_name' => $r->teacher_name,
                'timezone' => $timezone,
                'country' => $country,
                'home' => $home,
            ];
        })->all();
    }

    /**
     * Students living outside the academy's country, by country: how many are still tied to the
     * academy's clock (and who), how many already follow their own.
     *
     * @param  list<array<string,mixed>>  $timetables
     * @return list<array<string,mixed>>
     */
    private function abroad(array $timetables, string $academyTz, ?string $academyCountry, Carbon $now): array
    {
        $groups = [];
        foreach ($timetables as $t) {
            if ($t['country'] === null || $t['country'] === $academyCountry) {
                continue;
            }
            $zones = CountryClocks::zones($t['country']);
            if ($zones === []) {
                continue;
            }
            $country = $t['country'];
            $groups[$country] ??= [
                'country' => $country,
                'zones' => $zones,
                'suggested' => $zones[0]['timezone'],
                // How far the student's clock is ahead of the academy's today, in minutes.
                'gap_minutes' => ScheduleAnchor::gapMinutes($academyTz, $zones[0]['timezone'], $now),
                'on_own_clock' => 0,
                'on_academy_clock' => [],
            ];
            if ($t['timezone'] === $academyTz) {
                $groups[$country]['on_academy_clock'][] = [
                    'schedule_id' => $t['schedule_id'],
                    'student_id' => $t['student_id'],
                    'student_name' => $t['student_name'],
                    'teacher_name' => $t['teacher_name'],
                ];
            } else {
                $groups[$country]['on_own_clock']++;
            }
        }

        usort($groups, fn (array $a, array $b) => count($b['on_academy_clock']) <=> count($a['on_academy_clock']));

        return $groups;
    }

    /** The academy's own country: the one it set, else the one its clock belongs to. */
    private function academyCountry(string $timezone): ?string
    {
        $set = DB::table('academies')->where('id', $this->currentAcademyId())->value('country');

        return CountryClocks::code($set !== null ? (string) $set : null) ?? CountryClocks::countryOf($timezone);
    }

    /**
     * The shift most of the lessons make (minutes), or null when none move.
     *
     * @param  list<int>  $shifts
     */
    private static function usual(array $shifts): ?int
    {
        if ($shifts === []) {
            return null;
        }
        $counts = array_count_values($shifts);
        arsort($counts);

        return (int) array_key_first($counts);
    }
}
