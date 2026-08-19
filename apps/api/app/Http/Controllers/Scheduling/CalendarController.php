<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The weekly calendar feed (§5.5, AC-5.9). Returns the academy's sessions in a `[from, to]`
 * window. A TEACHER sees ONLY their own sessions — and is rejected if they ask for another
 * teacher's via `?teacherId=` (§3.6, TC-5.26). An Owner/Super-Admin may scope to any teacher in
 * the academy; RLS guarantees they can never reach another academy's rows (TC-5.27). Instants
 * are stored/returned in UTC; the viewer renders them in their own timezone (the stored UTC
 * never changes, AC-5.15).
 *
 * The window carries a SECOND feed: booked trials. A trial is a real hour of a real teacher, but
 * it is never a `sessions` row (the person may not be a student yet — see the trials migration),
 * so it would otherwise be invisible on the calendar and double-booked by anyone reading it. It
 * travels as its own array rather than being disguised as a session: the client paints it, but
 * the session actions (attendance, reschedule, cancel) do not apply to it.
 *
 * Only SCHEDULED trials are returned — a completed, no-show, cancelled or converted trial is
 * history, and history for trials lives on the Trials page, not on the planning surface.
 */
final class CalendarController extends Controller
{
    use InteractsWithScheduling;

    /** GET /api/calendar?from=&to=&teacherId=&studentId= */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('session.read');

        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
            'teacherId' => ['sometimes', 'nullable', 'uuid'],
            'studentId' => ['sometimes', 'nullable', 'uuid'],
        ]);

        $fromUtc = Carbon::parse($data['from'])->utc();
        // `to` is an inclusive calendar day → take the end of that day so a session at any time
        // on the last day is included.
        $toUtc = Carbon::parse($data['to'])->endOfDay()->utc();

        $query = DB::table('sessions as se')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->whereBetween('se.scheduled_at_utc', [
                $fromUtc->format('Y-m-d H:i:sP'),
                $toUtc->format('Y-m-d H:i:sP'),
            ])
            // A RESCHEDULED row is the old occurrence, kept at its ORIGINAL time as a non-billable
            // audit marker (its SCHEDULED successor lives at the new time). Showing both made a
            // reschedule look like a duplicate, so hide the marker — the calendar shows only the
            // moved (successor) occurrence, i.e. a clean in-place move.
            ->where('se.status', '!=', 'RESCHEDULED')
            ->select([
                'se.id', 'se.student_id', 'se.teacher_id', 'se.schedule_id',
                'se.scheduled_at_utc', 'se.duration_minutes', 'se.status', 'se.status_reason',
                'se.original_session_id',
                'st.full_name as student_name', 'te.full_name as teacher_name',
            ])
            ->orderBy('se.scheduled_at_utc')->orderBy('se.id');

        // Teacher row-scope: own sessions only; an explicit foreign teacherId is forbidden.
        if ($this->ctx()->role === 'TEACHER') {
            $ownTeacherId = $this->callerTeacherId();
            if ($ownTeacherId === null) {
                abort(403, 'No teacher record for this user.');
            }
            if (! empty($data['teacherId']) && $data['teacherId'] !== $ownTeacherId) {
                abort(403, 'You may only view your own calendar.');
            }
            $query->where('se.teacher_id', $ownTeacherId);
        } elseif (! empty($data['teacherId'])) {
            $query->where('se.teacher_id', $data['teacherId']);
        }

        if (! empty($data['studentId'])) {
            $query->where('se.student_id', $data['studentId']);
        }

        $rows = $query->get()->map(function ($r) {
            // Normalise the stored instant to ISO-8601 UTC so the client renders in any timezone.
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();

            return $r;
        });

        return response()->json([
            'sessions' => $rows,
            'trials' => $this->trialsInWindow($fromUtc, $toUtc, $data),
            'from' => $fromUtc->toIso8601String(),
            'to' => $toUtc->toIso8601String(),
        ]);
    }

    /**
     * The booked trials inside the same window, scoped exactly like the sessions above: a TEACHER
     * sees only their own (the foreign-teacher rejection has already run), an Owner may narrow to
     * one teacher, and a student filter keeps only the trials booked for that student.
     *
     * @param  array<string,mixed>  $data  the validated query (teacherId / studentId)
     */
    private function trialsInWindow(Carbon $fromUtc, Carbon $toUtc, array $data): Collection
    {
        $query = DB::table('trials as tr')
            ->leftJoin('teachers as te', 'te.id', '=', 'tr.teacher_id')
            ->leftJoin('students as st', 'st.id', '=', 'tr.student_id')
            ->leftJoin('crm_leads as cl', 'cl.id', '=', 'tr.lead_id')
            ->whereNull('tr.deleted_at')
            ->where('tr.status', 'SCHEDULED')
            ->whereBetween('tr.scheduled_at_utc', [
                $fromUtc->format('Y-m-d H:i:sP'),
                $toUtc->format('Y-m-d H:i:sP'),
            ])
            ->select([
                'tr.id', 'tr.teacher_id', 'tr.student_id', 'tr.lead_id',
                'tr.scheduled_at_utc', 'tr.duration_minutes', 'tr.status',
                'te.full_name as teacher_name',
                'st.full_name as student_name',
                'cl.full_name as crm_lead_name',
                'tr.lead_name',
            ])
            ->orderBy('tr.scheduled_at_utc')->orderBy('tr.id');

        if ($this->ctx()->role === 'TEACHER') {
            $query->where('tr.teacher_id', (string) $this->callerTeacherId());
        } elseif (! empty($data['teacherId'])) {
            $query->where('tr.teacher_id', $data['teacherId']);
        }

        if (! empty($data['studentId'])) {
            $query->where('tr.student_id', $data['studentId']);
        }

        return $query->get()->map(function ($r) {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();
            $r->duration_minutes = (int) $r->duration_minutes;
            // Who the hour is for, in the order the name is most likely to be current.
            $r->display_name = $r->student_name ?? $r->crm_lead_name ?? $r->lead_name;

            return $r;
        });
    }
}
