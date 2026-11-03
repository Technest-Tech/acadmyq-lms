<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * GET /api/dashboard/centre — the numbers a learning centre's home screen opens on, in one call:
 * today's classes (group and private) and how many still have no sheet, this week's attendance,
 * the groups running and their free seats, and the lesson subscriptions about to run out.
 *
 * Money stays with the accounting overview (GET /accounting/overview) and payroll with the
 * profit summary — this endpoint never repeats a figure another screen owns. Behind
 * `entitled:centre`: a Quran academy has no centre dashboard and never calls it.
 */
final class CentreDashboardController extends Controller
{
    use InteractsWithScheduling;

    /** A subscription counts as "ending soon" within this many days of its end date. */
    private const ENDING_SOON_DAYS = 7;

    public function show(): JsonResponse
    {
        Gate::any(['group.read', 'session.read']) ?: abort(403);

        $academyId = $this->currentAcademyId();
        $tz = $this->academyTimezone($academyId);
        $now = CarbonImmutable::now($tz);
        $today = $now->toDateString();
        $weekFrom = $now->startOfWeek(CarbonImmutable::SATURDAY)->toDateString();
        $weekTo = $now->endOfWeek(CarbonImmutable::FRIDAY)->toDateString();
        $nowUtc = $now->utc()->format('Y-m-d H:i:sP');

        // ── Today: every class on the academy's calendar day, and the ones with no outcome yet ──
        $groupToday = DB::table('class_group_lessons as l')
            ->join('class_groups as g', 'g.id', '=', 'l.group_id')
            ->where('l.status', '<>', 'CANCELLED')
            ->whereRaw('(l.scheduled_at_utc at time zone g.timezone)::date = ?::date', [$today])
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where l.status = 'SCHEDULED' and l.scheduled_at_utc < ?) as unmarked", [$nowUtc])
            ->first();

        // A private lesson's statuses are the session_status enum: cancelled or moved ones are not
        // a class on today's list.
        $privateToday = DB::table('sessions as se')
            ->whereNotIn('se.status', ['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT', 'RESCHEDULED'])
            ->whereNull('se.hidden_at')
            ->whereRaw('(se.scheduled_at_utc at time zone ?)::date = ?::date', [$tz, $today])
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where se.status = 'SCHEDULED' and se.scheduled_at_utc < ?) as unmarked", [$nowUtc])
            ->first();

        // ── This week: the sheets that were marked, and who was on them ──────────────────────
        $week = DB::table('class_group_attendance as a')
            ->join('class_group_lessons as l', 'l.id', '=', 'a.lesson_id')
            ->where('l.status', 'HELD')
            ->whereBetween('l.occurrence_local_date', [$weekFrom, $weekTo])
            ->selectRaw("count(*) filter (where a.status in ('PRESENT','LATE')) as present")
            ->selectRaw("count(*) filter (where a.status in ('ABSENT','EXCUSED')) as absent")
            ->selectRaw('count(distinct l.id) as held')
            ->first();
        $marked = (int) $week->present + (int) $week->absent;

        // ── Groups: running now, their active members, and the seats still open ───────────────
        $groups = DB::table('class_groups as g')
            ->where('g.status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('g.start_date')->orWhere('g.start_date', '<=', $today))
            ->where(fn ($q) => $q->whereNull('g.end_date')->orWhere('g.end_date', '>=', $today))
            ->selectRaw('count(*) as running')
            ->selectRaw('coalesce(sum(g.capacity), 0) as capacity')
            ->selectRaw('coalesce(sum((select count(*) from class_group_members m where m.group_id = g.id and m.status = \'ACTIVE\')), 0) as members')
            ->selectRaw('coalesce(sum(greatest(g.capacity - (select count(*) from class_group_members m where m.group_id = g.id and m.status = \'ACTIVE\'), 0)) filter (where g.capacity is not null), 0) as free_seats')
            ->first();

        // ── Subscriptions (lesson_packages in lessons): open, and the ones about to run out ───
        $soon = $now->addDays(self::ENDING_SOON_DAYS)->toDateString();
        $subs = DB::table('lesson_packages as p')
            ->where('p.status', 'ACTIVE')
            ->selectRaw('count(*) as open')
            ->selectRaw(
                'count(*) filter (where (p.expires_on is not null and p.expires_on between ?::date and ?::date)'
                .' or (p.minutes_total + coalesce(p.carried_over_minutes, 0) - p.minutes_consumed) <= coalesce(p.lesson_minutes, 60)) as ending_soon',
                [$today, $soon],
            )
            ->first();

        return response()->json([
            'today' => [
                'date' => $today,
                'group_lessons' => (int) $groupToday->total,
                'group_unmarked' => (int) $groupToday->unmarked,
                'private_lessons' => (int) $privateToday->total,
                'private_unmarked' => (int) $privateToday->unmarked,
            ],
            'week' => [
                'from' => $weekFrom,
                'to' => $weekTo,
                'held' => (int) $week->held,
                'present' => (int) $week->present,
                'absent' => (int) $week->absent,
                'attendance_rate' => $marked > 0 ? round((int) $week->present / $marked, 3) : null,
            ],
            'groups' => [
                'running' => (int) $groups->running,
                'members' => (int) $groups->members,
                'capacity' => (int) $groups->capacity,
                'free_seats' => (int) $groups->free_seats,
            ],
            'subscriptions' => [
                'open' => (int) $subs->open,
                'ending_soon' => (int) $subs->ending_soon,
                'ending_soon_days' => self::ENDING_SOON_DAYS,
            ],
        ]);
    }
}
