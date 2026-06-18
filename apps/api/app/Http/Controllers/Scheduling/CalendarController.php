<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The weekly calendar feed (§5.5, AC-5.9). Returns the academy's sessions in a `[from, to]`
 * window. A TEACHER sees ONLY their own sessions — and is rejected if they ask for another
 * teacher's via `?teacherId=` (§3.6, TC-5.26). An Owner/Super-Admin may scope to any teacher in
 * the academy; RLS guarantees they can never reach another academy's rows (TC-5.27). Instants
 * are stored/returned in UTC; the viewer renders them in their own timezone (the stored UTC
 * never changes, AC-5.15).
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
            'from' => $fromUtc->toIso8601String(),
            'to' => $toUtc->toIso8601String(),
        ]);
    }
}
