<?php

declare(strict_types=1);

namespace App\Http\Controllers\Enrolment;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\Enrolment\EnrolmentForm;
use App\Support\Audit;
use App\Support\TrialBooking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The enrolment inbox (docs/centre-profile, Phase 2 §6): what the public form collected, worked
 * through by the staff. A request is NEW when it lands, CONTACTED once someone called back,
 * PLACEMENT_BOOKED when a placement lesson was booked from here (a `trials` row — the trials board
 * runs it from there), ENROLLED once that trial is converted to a student, or CLOSED whenever the
 * conversation ends without one.
 *
 * Reading is `trial.read`, every change is `trial.manage`: the inbox is the front of the same
 * pipeline the trials board is the middle of, so the same people work both. Behind `entitled:centre`.
 */
final class EnrolmentRequestController extends Controller
{
    use InteractsWithScheduling;

    /** The inbox is a working list, not an archive: enough for a busy season, never the whole history. */
    private const LIMIT = 500;

    /** GET /api/enrolment/requests?status=&q= — the inbox, newest first, with the per-status counts. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('trial.read');

        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(EnrolmentForm::STATUSES)],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);

        $query = $this->baseQuery();
        if (! empty($data['status'])) {
            $query->where('r.status', $data['status']);
        }
        if (! empty($data['q'])) {
            $needle = '%'.mb_strtolower(trim((string) $data['q'])).'%';
            $query->where(function ($q) use ($needle): void {
                $q->whereRaw('lower(r.student_name) like ?', [$needle])
                    ->orWhereRaw('lower(coalesce(r.guardian_name, \'\')) like ?', [$needle])
                    ->orWhere('r.phone', 'like', $needle);
            });
        }

        $rows = $query->orderByDesc('r.created_at')->limit(self::LIMIT)->get()
            ->map(fn (object $r): array => $this->present($r))
            ->values();

        return response()->json([
            'rows' => $rows,
            'counts' => $this->counts(),
        ]);
    }

    /** GET /api/enrolment/requests/summary — `{new}` for the sidebar badge. */
    public function summary(): JsonResponse
    {
        Gate::authorize('trial.read');

        return response()->json(['new' => (int) ($this->counts()['NEW'] ?? 0)]);
    }

    /** PATCH /api/enrolment/requests/{id} — move it along (any status) and/or write the staff note. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $row = $this->find($id);
        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(EnrolmentForm::STATUSES)],
            'staff_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $after = [];
        $before = [];
        if (! empty($data['status']) && (string) $data['status'] !== (string) $row->status) {
            $before['status'] = $row->status;
            $after['status'] = $data['status'];
            $after['status_changed_at'] = now();
        }
        if (array_key_exists('staff_note', $data)) {
            $note = $data['staff_note'] === null ? null : trim((string) $data['staff_note']);
            $note = $note === '' ? null : $note;
            if ($note !== $row->staff_note) {
                $before['staff_note'] = $row->staff_note;
                $after['staff_note'] = $note;
            }
        }

        // TODO(course-term): a request for a FULL group could be put on that group's waiting list from
        // here (GroupWaitlist::add with the request's name + phone, or its student once created) —
        // docs/centre-profile Phase 2 §2 left the inbox → waitlist link for later.
        if ($after !== []) {
            DB::table('enrolment_requests')->where('id', $id)->update($after + [
                'handled_by' => $this->ctx()->userId,
                'updated_at' => now(),
            ]);
            Audit::log('enrolment.request_updated', 'enrolment_request', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role,
                after: array_diff_key($after, ['status_changed_at' => true]), before: $before);
        }

        return response()->json(['request' => $this->present($this->baseQuery()->where('r.id', $id)->first())]);
    }

    /**
     * POST /api/enrolment/requests/{id}/placement — book the placement lesson. The trial is made by
     * the SAME TrialBooking the trials board uses (the lead's name and phone travel from the
     * request), so it shows up on that board, the agenda and the calendar like any other; the
     * request then points at it and reads PLACEMENT_BOOKED. One transaction: a refused booking
     * leaves the request exactly as it was.
     */
    public function placement(Request $request, string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $row = $this->find($id);
        if ((string) $row->status === 'ENROLLED') {
            throw ValidationException::withMessages(['status' => ['This request is already enrolled.']]);
        }
        if ($row->trial_id !== null) {
            $live = DB::table('trials')->where('id', $row->trial_id)->whereNull('deleted_at')
                ->whereIn('status', ['SCHEDULED', 'COMPLETED'])->exists();
            if ($live) {
                throw ValidationException::withMessages(['trial' => ['A placement lesson is already booked for this request.']]);
            }
        }

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'teacher_id' => ['required', 'uuid'],
            'local_datetime' => ['required', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
        ]);

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $startUtc = $this->resolveInstant($data, $timezone);
        $duration = (int) $data['duration_minutes'];

        // What the visitor asked for rides on the trial's notes, where the teacher reads it.
        $asked = array_filter([
            $row->subject_name ?? $row->subject_text,
            $row->level_text,
            $row->guardian_name !== null ? 'ولي الأمر: '.$row->guardian_name : null,
        ]);

        $trialId = DB::transaction(function () use ($row, $data, $academyId, $timezone, $startUtc, $duration, $asked): string {
            $trialId = TrialBooking::book($academyId, [
                'teacher_id' => (string) $data['teacher_id'],
                'lead_name' => (string) $row->student_name,
                'lead_whatsapp' => (string) $row->phone,
                'lead_email' => $row->email,
                'timezone' => $timezone,
                'duration_minutes' => $duration,
                'outcome_notes' => $asked === [] ? null : 'طلب تسجيل — '.implode(' · ', $asked),
            ], $startUtc, $this->ctx()->userId, $this->ctx()->role);

            DB::table('enrolment_requests')->where('id', $row->id)->update([
                'trial_id' => $trialId,
                'status' => 'PLACEMENT_BOOKED',
                'status_changed_at' => now(),
                'handled_by' => $this->ctx()->userId,
                'updated_at' => now(),
            ]);
            Audit::log('enrolment.placement_booked', 'enrolment_request', (string) $row->id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['status' => 'PLACEMENT_BOOKED', 'trial_id' => $trialId], before: ['status' => $row->status]);

            return $trialId;
        });

        return response()->json([
            'trialId' => $trialId,
            'warnings' => $this->schedulingWarnings((string) $data['teacher_id'], $startUtc, $duration, $timezone, excludeTrialId: $trialId),
            'request' => $this->present($this->baseQuery()->where('r.id', $id)->first()),
        ], 201);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function find(string $id): object
    {
        $row = $this->baseQuery()->where('r.id', $id)->first();
        if ($row === null) {
            abort(404, 'Request not found.');
        }

        return $row;
    }

    /** Every request joined to the subject it named, the trial it became and the student it ended as. */
    private function baseQuery()
    {
        return DB::table('enrolment_requests as r')
            ->leftJoin('specializations as sp', 'sp.id', '=', 'r.subject_id')
            ->leftJoin('trials as tr', 'tr.id', '=', 'r.trial_id')
            ->leftJoin('teachers as tt', 'tt.id', '=', 'tr.teacher_id')
            ->leftJoin('students as s', 's.id', '=', 'r.student_id')
            ->leftJoin('users as u', 'u.id', '=', 'r.handled_by')
            ->select([
                'r.id', 'r.student_name', 'r.guardian_name', 'r.phone', 'r.email', 'r.age',
                'r.subject_id', 'r.subject_text', 'r.level_text', 'r.preferred_days', 'r.preferred_time',
                'r.message', 'r.source', 'r.status', 'r.staff_note', 'r.trial_id', 'r.student_id',
                'r.status_changed_at', 'r.created_at',
                'sp.name as subject_name',
                'tr.scheduled_at_utc as trial_scheduled_at_utc', 'tr.status as trial_status', 'tr.deleted_at as trial_deleted_at',
                'tt.full_name as trial_teacher_name',
                's.full_name as student_full_name',
                'u.full_name as handled_by_name',
            ]);
    }

    /** @return array<string,int> */
    private function counts(): array
    {
        $counts = array_fill_keys(EnrolmentForm::STATUSES, 0);
        foreach (DB::table('enrolment_requests')->select('status', DB::raw('count(*) as c'))->groupBy('status')->get() as $b) {
            $counts[(string) $b->status] = (int) $b->c;
        }

        return $counts;
    }

    private function present(object $r): array
    {
        $trialGone = $r->trial_id !== null && ($r->trial_deleted_at !== null || $r->trial_status === 'CANCELLED');

        return [
            'id' => $r->id,
            'student_name' => $r->student_name,
            'guardian_name' => $r->guardian_name,
            'phone' => $r->phone,
            'email' => $r->email,
            'age' => $r->age !== null ? (int) $r->age : null,
            'subject_id' => $r->subject_id,
            'subject' => $r->subject_name ?? $r->subject_text,
            'level' => $r->level_text,
            'preferred_days' => self::pgIntArray($r->preferred_days),
            'preferred_time' => $r->preferred_time,
            'message' => $r->message,
            'source' => $r->source,
            'status' => $r->status,
            'staff_note' => $r->staff_note,
            'handled_by' => $r->handled_by_name,
            'trial' => $r->trial_id === null ? null : [
                'id' => $r->trial_id,
                'scheduled_at_utc' => $r->trial_scheduled_at_utc !== null ? Carbon::parse($r->trial_scheduled_at_utc)->utc()->toIso8601String() : null,
                'status' => $trialGone ? 'CANCELLED' : $r->trial_status,
                'teacher_name' => $r->trial_teacher_name,
            ],
            'student' => $r->student_id === null ? null : ['id' => $r->student_id, 'name' => $r->student_full_name],
            'status_changed_at' => Carbon::parse($r->status_changed_at)->utc()->toIso8601String(),
            'created_at' => Carbon::parse($r->created_at)->utc()->toIso8601String(),
        ];
    }

    /** `{1,3}` as Postgres hands an int array back → [1, 3]. */
    public static function pgIntArray(mixed $raw): array
    {
        if (is_array($raw)) {
            return array_map('intval', $raw);
        }
        $inner = trim((string) $raw, '{}');
        if ($inner === '') {
            return [];
        }

        return array_map('intval', explode(',', $inner));
    }
}
