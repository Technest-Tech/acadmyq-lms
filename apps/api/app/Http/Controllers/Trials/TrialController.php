<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trials;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\LeadTimeline;
use App\Support\TrialBooking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Free Trials (Free-Trials module) — the READ side of the taster lesson: every trial the academy
 * has run, what came of it, and the numbers that say whether trials are working.
 *
 * Booking now belongs to the CRM: a trial exists because a lead reached the TRIAL stage, so the
 * teacher-and-slot form lives next to the person it is for (POST /crm/leads/{id}/trial), and this
 * surface is where you watch the pipeline, record outcomes, cancel, and convert. POST /api/trials
 * remains as the module's own booking endpoint for a trial that has no lead behind it.
 *
 * Two capabilities gate it: `trial.read` (list, stats) and `trial.manage` (book, record outcome,
 * cancel, convert). Both are OWNER-only; RLS scopes every query to the current academy.
 *
 * Every write here flows back to the CRM when the trial came from a lead: an outcome, a
 * cancellation and a conversion all land on that lead's timeline, and converting moves the lead
 * to SUBSCRIBED — so the two screens can never disagree about what happened to a person.
 */
final class TrialController extends Controller
{
    use InteractsWithScheduling;

    /** Outcomes an owner may set directly; CONVERTED is reached only through convert(). */
    private const EDITABLE_STATUSES = ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];

    /** GET /api/trials — server-driven pipeline of trials joined to teacher, student and lead. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('trial.read');

        $query = DB::table('trials as tr')
            ->leftJoin('teachers as t', 't.id', '=', 'tr.teacher_id')
            ->leftJoin('students as s', 's.id', '=', 'tr.student_id')
            ->leftJoin('crm_leads as cl', 'cl.id', '=', 'tr.lead_id')
            ->whereNull('tr.deleted_at')
            ->select([
                'tr.id', 'tr.teacher_id', 'tr.student_id', 'tr.lead_id', 'tr.lead_name',
                'tr.lead_whatsapp', 'tr.lead_email', 'tr.timezone', 'tr.scheduled_at_utc',
                'tr.duration_minutes', 'tr.status', 'tr.outcome_notes',
                'tr.converted_student_id', 'tr.created_at',
                't.full_name as teacher_name',
                's.full_name as student_name',
                'cl.full_name as crm_lead_name',
                'cl.source as crm_source',
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'tr.id',
            'searchable' => ['tr.lead_name', 's.full_name', 'tr.lead_whatsapp', 'tr.lead_email'],
            'sortable' => [
                'scheduled' => 'tr.scheduled_at_utc',
                'created_at' => 'tr.created_at',
                'status' => 'tr.status',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('tr.status', strtoupper((string) $value)),
                'teacher_id' => fn ($q, $value) => $q->where('tr.teacher_id', (string) $value),
                // Where the trial came from: the CRM pipeline, or booked directly here.
                'origin' => fn ($q, $value) => strtolower((string) $value) === 'crm'
                    ? $q->whereNotNull('tr.lead_id')
                    : $q->whereNull('tr.lead_id'),
                'upcoming' => fn ($q, $value) => (string) $value === '1'
                    ? $q->where('tr.status', 'SCHEDULED')->where('tr.scheduled_at_utc', '>=', now()->format('Y-m-d H:i:sP'))
                    : null,
            ],
            'defaultSort' => '-scheduled',
        ]);

        $result['rows'] = $result['rows']->map(function (object $r): object {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();
            $r->created_at = Carbon::parse($r->created_at)->utc()->toIso8601String();
            $r->duration_minutes = (int) $r->duration_minutes;
            $r->display_name = $r->student_name ?? $r->crm_lead_name ?? $r->lead_name;
            $r->is_lead = $r->student_id === null;
            $r->from_crm = $r->lead_id !== null;

            return $r;
        });

        return response()->json($result);
    }

    /** GET /api/trials/summary — headline stats for the page (counts + conversion rate). */
    public function summary(): JsonResponse
    {
        Gate::authorize('trial.read');

        $base = fn () => DB::table('trials')->whereNull('deleted_at');

        $byStatus = $base()
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $scheduled = (int) ($byStatus['SCHEDULED'] ?? 0);
        $completed = (int) ($byStatus['COMPLETED'] ?? 0);
        $noShow = (int) ($byStatus['NO_SHOW'] ?? 0);
        $cancelled = (int) ($byStatus['CANCELLED'] ?? 0);
        $converted = (int) ($byStatus['CONVERTED'] ?? 0);

        // Conversion rate over trials that reached an outcome (i.e. excludes still-scheduled and
        // cancelled): converted ÷ (converted + completed-but-not-converted + no-show).
        $resolved = $converted + $completed + $noShow;
        $conversionRate = $resolved > 0 ? round(($converted / $resolved) * 100) : 0;

        $upcoming = (int) $base()
            ->where('status', 'SCHEDULED')
            ->where('scheduled_at_utc', '>=', now()->format('Y-m-d H:i:sP'))
            ->count();

        // "Today" is the academy's day, not the server's — an academy in Cairo reading this at
        // 01:00 UTC is still looking at yesterday's trials otherwise.
        $timezone = $this->academyTimezone($this->currentAcademyId());
        $dayStart = Carbon::now($timezone)->startOfDay();
        $today = (int) $base()
            ->whereIn('status', ['SCHEDULED', 'COMPLETED', 'NO_SHOW'])
            ->whereBetween('scheduled_at_utc', [
                $dayStart->copy()->utc()->format('Y-m-d H:i:sP'),
                $dayStart->copy()->addDay()->utc()->format('Y-m-d H:i:sP'),
            ])
            ->count();

        // A trial that missed its slot and was never resolved — the queue of "what happened?"
        // work this page exists to surface.
        $awaitingOutcome = (int) $base()
            ->where('status', 'SCHEDULED')
            ->where('scheduled_at_utc', '<', now()->format('Y-m-d H:i:sP'))
            ->count();

        $fromCrm = (int) $base()->whereNotNull('lead_id')->count();

        return response()->json([
            'total' => $scheduled + $completed + $noShow + $cancelled + $converted,
            'scheduled' => $scheduled,
            'upcoming' => $upcoming,
            'today' => $today,
            'awaiting_outcome' => $awaitingOutcome,
            'completed' => $completed,
            'no_show' => $noShow,
            'cancelled' => $cancelled,
            'converted' => $converted,
            'from_crm' => $fromCrm,
            'conversion_rate' => $conversionRate,
        ]);
    }

    /**
     * POST /api/trials — book a trial for an existing student OR a prospect captured inline.
     * The CRM's own booking path (POST /crm/leads/{id}/trial) writes through the same
     * {@see TrialBooking} so both produce identical rows; this one exists for a trial with no
     * lead behind it — an existing student trying a second teacher, say.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'teacher_id' => ['required', 'uuid'],
            'student_id' => ['sometimes', 'nullable', 'uuid'],
            'lead_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'lead_whatsapp' => ['sometimes', 'nullable', 'string', 'max:32'],
            'lead_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
            'outcome_notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $startUtc = $this->resolveInstant($data, $timezone);
        $duration = (int) $data['duration_minutes'];

        $trialId = TrialBooking::book($academyId, [
            'teacher_id' => $data['teacher_id'],
            'student_id' => $data['student_id'] ?? null,
            'lead_name' => $data['lead_name'] ?? null,
            'lead_whatsapp' => $data['lead_whatsapp'] ?? null,
            'lead_email' => $data['lead_email'] ?? null,
            'timezone' => $timezone,
            'duration_minutes' => $duration,
            'outcome_notes' => $data['outcome_notes'] ?? null,
        ], $startUtc, $this->ctx()->userId, $this->ctx()->role);

        return response()->json([
            'trialId' => $trialId,
            'warnings' => $this->schedulingWarnings((string) $data['teacher_id'], $startUtc, $duration, $timezone, excludeTrialId: $trialId),
        ], 201);
    }

    /** PATCH /api/trials/{id} — record an outcome, edit notes, or reschedule the slot. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $trial = DB::table('trials')->where('id', $id)->whereNull('deleted_at')->first();
        if ($trial === null) {
            abort(404, 'Trial not found.');
        }
        if ((string) $trial->status === 'CONVERTED') {
            throw ValidationException::withMessages(['status' => ['A converted trial can no longer be changed.']]);
        }

        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(self::EDITABLE_STATUSES)],
            'outcome_notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'],
        ]);

        $after = [];
        $before = [];
        if (array_key_exists('status', $data) && $data['status'] !== null && (string) $data['status'] !== (string) $trial->status) {
            $before['status'] = $trial->status;
            $after['status'] = $data['status'];
        }
        if (array_key_exists('outcome_notes', $data) && (string) $data['outcome_notes'] !== (string) $trial->outcome_notes) {
            $before['outcome_notes'] = $trial->outcome_notes;
            $after['outcome_notes'] = $data['outcome_notes'];
        }

        // Reschedule: a new instant (explicit UTC or local wall-clock) and/or a new duration.
        if (! empty($data['scheduled_at_utc']) || ! empty($data['local_datetime'])) {
            $timezone = $data['timezone'] ?? (string) $trial->timezone;
            $newStart = $this->resolveInstant($data, $timezone);
            $before['scheduled_at_utc'] = Carbon::parse($trial->scheduled_at_utc)->utc()->toIso8601String();
            $after['scheduled_at_utc'] = $newStart->format('Y-m-d H:i:sP');
            $after['timezone'] = $timezone;
        }
        if (! empty($data['duration_minutes']) && (int) $data['duration_minutes'] !== (int) $trial->duration_minutes) {
            $before['duration_minutes'] = (int) $trial->duration_minutes;
            $after['duration_minutes'] = (int) $data['duration_minutes'];
        }

        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('trials')->where('id', $id)->update($after + ['updated_at' => now()]);
        Audit::log('trial.update', 'trial', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        // The lead this trial came from must hear about it — the CRM board is where someone
        // decides what to do next, and "she came and loved it" is that decision's whole input.
        if (isset($after['status'])) {
            $this->noteOnLead($trial, LeadTimeline::TRIAL_OUTCOME, [
                'trial_id' => $id,
                'status' => (string) $after['status'],
            ], $after['outcome_notes'] ?? $trial->outcome_notes);
        } elseif (isset($after['scheduled_at_utc'])) {
            $this->noteOnLead($trial, LeadTimeline::TRIAL_BOOKED, [
                'trial_id' => $id,
                'rescheduled' => true,
                'scheduled_at_utc' => Carbon::parse($after['scheduled_at_utc'])->utc()->toIso8601String(),
                'duration_minutes' => (int) ($after['duration_minutes'] ?? $trial->duration_minutes),
            ]);
        }

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /**
     * POST /api/trials/{id}/convert — link a completed lead trial to the real student it became.
     * The student is created first via the normal student-creation flow (POST /students), so this
     * endpoint only records the linkage: stamp `converted_student_id`, adopt `student_id`, and move
     * the trial to CONVERTED. Idempotency: a trial that is already CONVERTED is rejected.
     *
     * A trial that came from a lead carries that lead across with it: the lead is linked to the
     * same student and lands on SUBSCRIBED, because converting the trial and subscribing the lead
     * are the same event seen from two screens.
     */
    public function convert(Request $request, string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $trial = DB::table('trials')->where('id', $id)->whereNull('deleted_at')->first();
        if ($trial === null) {
            abort(404, 'Trial not found.');
        }
        if ((string) $trial->status === 'CONVERTED') {
            throw ValidationException::withMessages(['trial' => ['This trial has already been converted.']]);
        }

        $data = $request->validate([
            'student_id' => ['required', 'uuid'],
        ]);
        if (DB::table('students')->where('id', $data['student_id'])->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['student_id' => ['Unknown or inactive student.']]);
        }

        DB::table('trials')->where('id', $id)->update([
            'student_id' => $trial->student_id ?? $data['student_id'],
            'converted_student_id' => $data['student_id'],
            'status' => 'CONVERTED',
            'updated_at' => now(),
        ]);
        Audit::log('trial.convert', 'trial', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['converted_student_id' => $data['student_id'], 'status' => 'CONVERTED'],
            before: ['status' => $trial->status]);

        if ($trial->lead_id !== null) {
            $subscribed = DB::table('crm_leads')
                ->where('id', $trial->lead_id)
                ->whereNull('deleted_at')
                ->whereNull('converted_student_id')
                ->update([
                    'converted_student_id' => $data['student_id'],
                    'status' => 'SUBSCRIBED',
                    'lost_reason' => null,
                    'updated_at' => now(),
                ]);
            if ($subscribed > 0) {
                LeadTimeline::log($academyId, (string) $trial->lead_id, LeadTimeline::CONVERTED,
                    meta: ['student_id' => $data['student_id'], 'trial_id' => $id],
                    userId: $this->ctx()->userId);
            }
        }

        return response()->json(['ok' => true, 'studentId' => $data['student_id']]);
    }

    /** DELETE /api/trials/{id} — cancel a trial (kept in the pipeline as CANCELLED, not removed). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $trial = DB::table('trials')->where('id', $id)->whereNull('deleted_at')->first();
        if ($trial === null) {
            abort(404, 'Trial not found.');
        }
        if ((string) $trial->status === 'CONVERTED') {
            throw ValidationException::withMessages(['trial' => ['A converted trial cannot be cancelled.']]);
        }

        DB::table('trials')->where('id', $id)->update(['status' => 'CANCELLED', 'updated_at' => now()]);
        Audit::log('trial.cancel', 'trial', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => 'CANCELLED'], before: ['status' => $trial->status]);

        $this->noteOnLead($trial, LeadTimeline::TRIAL_OUTCOME, [
            'trial_id' => $id,
            'status' => 'CANCELLED',
        ]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * Mirror something that happened to a trial onto the CRM lead it belongs to. A no-op for a
     * trial booked straight from this page (no lead) — the link is what makes it meaningful.
     *
     * @param  array<string,mixed>  $meta
     */
    private function noteOnLead(object $trial, string $type, array $meta, ?string $body = null): void
    {
        if ($trial->lead_id === null) {
            return;
        }

        LeadTimeline::log(
            (string) $trial->academy_id,
            (string) $trial->lead_id,
            $type,
            $body,
            $meta,
            $this->ctx()->userId,
        );
    }
}
