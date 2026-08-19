<?php

declare(strict_types=1);

namespace App\Http\Controllers\Crm;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\LeadTimeline;
use App\Support\Phone;
use App\Support\TrialBooking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * CRM / Leads (CRM module, entitled:crm). A prospective student is captured as a lead and
 * walked through one pipeline from first contact to first invoice:
 *
 *     NEW → CONTACTED → INTERESTED → TRIAL → SUBSCRIBED        (+ LOST from anywhere)
 *
 * Every touch lands on the lead's activity timeline (who, what, when) so a beginner on the
 * sales desk can always pick up where a colleague left off.
 *
 * The last two stages are not labels a card can simply be dragged onto — each one is backed by
 * a real record, and the server is what guarantees it:
 *
 *   • TRIAL      — booked through POST /leads/{id}/trial (teacher + instant + duration). That
 *                  writes a `trials` row linked to the lead, which is what puts the trial on the
 *                  academy calendar and into the trials statistics. A bare PATCH to TRIAL with
 *                  no trial behind it is refused.
 *   • SUBSCRIBED — reached only through POST /leads/{id}/convert, which links the real student
 *                  the lead became. That is what makes them appear on the Students page, so a
 *                  bare PATCH to SUBSCRIBED is refused too: the student details come first.
 *
 * Two capabilities gate the surface: `crm.read` (board, list, stats, timeline) and
 * `crm.manage` (add, move, note, book a trial, convert, delete). Both are OWNER-only by default
 * and meant to be delegated to sales/support staff through a custom role. RLS scopes every query
 * to the current academy.
 */
final class LeadController extends Controller
{
    use InteractsWithScheduling;

    private const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'TRIAL', 'SUBSCRIBED', 'LOST'];

    /** Stages a lead is no longer being worked in — no follow-up is "due" on them. */
    private const CLOSED_STATUSES = ['SUBSCRIBED', 'LOST'];

    /** Durations the trial form offers; the DB accepts 1–600, this is the sane set. */
    private const TRIAL_DURATIONS = [15, 30, 45, 60, 90, 120];

    private const SOURCES = ['FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'REFERRAL', 'WALK_IN', 'PHONE', 'WEBSITE', 'OTHER'];

    /** Leads a board column holds at most — beyond this the list view is the right tool. */
    private const BOARD_COLUMN_CAP = 200;

    /** GET /api/crm/leads — the server-driven list view. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('crm.read');

        $today = $this->academyToday();

        $query = DB::table('crm_leads as l')
            ->leftJoin('students as s', 's.id', '=', 'l.converted_student_id')
            ->whereNull('l.deleted_at')
            ->select([
                'l.id', 'l.full_name', 'l.whatsapp_phone', 'l.source', 'l.interested_in',
                'l.status', 'l.lost_reason', 'l.follow_up_at', 'l.converted_student_id',
                'l.created_at',
                's.full_name as student_name',
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'l.id',
            'searchable' => ['l.full_name', 'l.whatsapp_phone', 'l.interested_in'],
            'sortable' => [
                'created_at' => 'l.created_at',
                'follow_up' => 'l.follow_up_at',
                'status' => 'l.status',
                'name' => 'l.full_name',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('l.status', strtoupper((string) $value)),
                'source' => fn ($q, $value) => $q->where('l.source', strtoupper((string) $value)),
                // "Due" = an open lead whose follow-up date has arrived (or passed).
                'due' => function ($q, $value) use ($today) {
                    $open = fn ($qq) => $qq->whereNotIn('l.status', self::CLOSED_STATUSES);
                    match (strtolower((string) $value)) {
                        'today' => $open($q)->where('l.follow_up_at', $today),
                        'overdue' => $open($q)->where('l.follow_up_at', '<', $today),
                        default => $open($q)->where('l.follow_up_at', '<=', $today),
                    };
                },
            ],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): object => $this->presentLead($r));
        $this->attachTrials($result['rows']->all());
        $result['today'] = $today;

        return response()->json($result);
    }

    /** GET /api/crm/leads/board — every open pipeline column in one payload. */
    public function board(): JsonResponse
    {
        Gate::authorize('crm.read');

        $today = $this->academyToday();

        $rows = DB::table('crm_leads as l')
            ->leftJoin('students as s', 's.id', '=', 'l.converted_student_id')
            ->whereNull('l.deleted_at')
            ->orderByRaw('(l.follow_up_at is null) asc, l.follow_up_at asc, l.created_at desc')
            ->get([
                'l.id', 'l.full_name', 'l.whatsapp_phone', 'l.source', 'l.interested_in',
                'l.status', 'l.lost_reason', 'l.follow_up_at', 'l.converted_student_id',
                'l.created_at',
                's.full_name as student_name',
            ]);

        $this->attachTrials($rows->all());

        $columns = array_fill_keys(self::STATUSES, []);
        $counts = array_fill_keys(self::STATUSES, 0);
        foreach ($rows as $row) {
            $status = (string) $row->status;
            $counts[$status]++;
            if (count($columns[$status]) < self::BOARD_COLUMN_CAP) {
                $columns[$status][] = $this->presentLead($row);
            }
        }

        return response()->json([
            'columns' => $columns,
            'counts' => $counts,
            'today' => $today,
        ]);
    }

    /** GET /api/crm/leads/summary — headline stats for the page. */
    public function summary(): JsonResponse
    {
        Gate::authorize('crm.read');

        $today = $this->academyToday();
        $base = fn () => DB::table('crm_leads')->whereNull('deleted_at');

        $byStatus = $base()
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $counts = [];
        foreach (self::STATUSES as $status) {
            $counts[strtolower($status)] = (int) ($byStatus[$status] ?? 0);
        }

        $open = fn () => $base()->whereNotIn('status', self::CLOSED_STATUSES);
        $dueToday = (int) $open()->where('follow_up_at', $today)->count();
        $overdue = (int) $open()->where('follow_up_at', '<', $today)->count();

        // Conversion rate over leads that reached an outcome: subscribed ÷ (subscribed + lost).
        $resolved = $counts['subscribed'] + $counts['lost'];
        $conversionRate = $resolved > 0 ? round(($counts['subscribed'] / $resolved) * 100) : 0;

        return response()->json($counts + [
            'total' => array_sum($counts),
            // "Open" is every lead still being worked — a booked trial very much included.
            'open' => $counts['new'] + $counts['contacted'] + $counts['interested'] + $counts['trial'],
            'due_today' => $dueToday,
            'overdue' => $overdue,
            'conversion_rate' => $conversionRate,
            'today' => $today,
        ]);
    }

    /** POST /api/crm/leads — capture a new lead. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('crm.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'whatsapp_phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'source' => ['required', Rule::in(self::SOURCES)],
            'interested_in' => ['sometimes', 'nullable', 'string', 'max:255'],
            'follow_up_at' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $leadId = (string) Str::uuid();
        DB::table('crm_leads')->insert([
            'id' => $leadId,
            'academy_id' => $academyId,
            'full_name' => trim($data['full_name']),
            'whatsapp_phone' => Phone::normalize($data['whatsapp_phone'] ?? null, 'whatsapp_phone'),
            'source' => $data['source'],
            'interested_in' => $data['interested_in'] ?? null,
            'follow_up_at' => $data['follow_up_at'] ?? null,
            'created_by' => $this->ctx()->userId,
        ]);

        $this->logActivity($academyId, $leadId, LeadTimeline::CREATED);
        if (! empty($data['note'])) {
            $this->logActivity($academyId, $leadId, LeadTimeline::NOTE, body: $data['note']);
        }

        Audit::log('crm_lead.create', 'crm_lead', $leadId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $data['full_name'],
            'source' => $data['source'],
            'follow_up_at' => $data['follow_up_at'] ?? null,
        ]);

        return response()->json(['leadId' => $leadId], 201);
    }

    /** GET /api/crm/leads/{id} — one lead plus its full activity timeline. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('crm.read');

        $lead = DB::table('crm_leads as l')
            ->leftJoin('students as s', 's.id', '=', 'l.converted_student_id')
            ->where('l.id', $id)
            ->whereNull('l.deleted_at')
            ->first([
                'l.id', 'l.full_name', 'l.whatsapp_phone', 'l.source', 'l.interested_in',
                'l.status', 'l.lost_reason', 'l.follow_up_at', 'l.converted_student_id',
                'l.created_at',
                's.full_name as student_name',
            ]);
        if ($lead === null) {
            abort(404, 'Lead not found.');
        }

        $activities = DB::table('crm_lead_activities as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.created_by')
            ->where('a.lead_id', $id)
            ->orderByDesc('a.created_at')
            ->get(['a.id', 'a.type', 'a.body', 'a.meta', 'a.created_at', 'u.full_name as author_name'])
            ->map(fn (object $a): object => $this->presentActivity($a));

        $presented = $this->presentLead($lead);
        $this->attachTrials([$presented]);

        return response()->json([
            'lead' => $presented,
            'activities' => $activities,
            'today' => $this->academyToday(),
        ]);
    }

    /** PATCH /api/crm/leads/{id} — edit details, move status, or (re)set the follow-up. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('crm.manage');

        $academyId = $this->currentAcademyId();
        $lead = DB::table('crm_leads')->where('id', $id)->whereNull('deleted_at')->first();
        if ($lead === null) {
            abort(404, 'Lead not found.');
        }
        if ($lead->converted_student_id !== null) {
            throw ValidationException::withMessages(['status' => ['A converted lead can no longer be changed.']]);
        }

        $data = $request->validate([
            'full_name' => ['sometimes', 'string', 'max:255'],
            'whatsapp_phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'source' => ['sometimes', Rule::in(self::SOURCES)],
            'interested_in' => ['sometimes', 'nullable', 'string', 'max:255'],
            'status' => ['sometimes', Rule::in(self::STATUSES)],
            'lost_reason' => ['sometimes', 'nullable', 'string', 'max:500'],
            'follow_up_at' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ]);

        if (array_key_exists('whatsapp_phone', $data)) {
            $data['whatsapp_phone'] = Phone::normalize($data['whatsapp_phone'], 'whatsapp_phone');
        }

        // The two backed stages are not reachable by a bare status write — each needs its record
        // first. Dragging a card is allowed to ASK for the details (the UI opens the right form);
        // it is never allowed to skip them.
        $target = $data['status'] ?? null;
        if ($target === 'SUBSCRIBED') {
            throw ValidationException::withMessages([
                'status' => ['Add the student details first — subscribing a lead creates their student record.'],
            ]);
        }
        if ($target === 'TRIAL' && ! $this->hasLiveTrial($id)) {
            throw ValidationException::withMessages([
                'status' => ['Book the trial first — a lead only reaches this stage with a trial on the calendar.'],
            ]);
        }

        $after = [];
        $before = [];
        foreach (['full_name', 'whatsapp_phone', 'source', 'interested_in', 'status', 'lost_reason', 'follow_up_at'] as $field) {
            if (! array_key_exists($field, $data)) {
                continue;
            }
            $new = is_string($data[$field]) ? trim($data[$field]) : $data[$field];
            if ((string) $new !== (string) $lead->{$field}) {
                $before[$field] = $lead->{$field};
                $after[$field] = $new === '' && $field !== 'full_name' ? null : $new;
            }
        }

        // A lost reason only makes sense on a LOST lead; leaving LOST clears it.
        $newStatus = $after['status'] ?? (string) $lead->status;
        if ($newStatus !== 'LOST' && ($lead->lost_reason !== null || isset($after['lost_reason']))) {
            $before['lost_reason'] = $lead->lost_reason;
            $after['lost_reason'] = null;
        }

        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('crm_leads')->where('id', $id)->update($after + ['updated_at' => now()]);

        if (isset($after['status'])) {
            $this->logActivity($academyId, $id, LeadTimeline::STATUS_CHANGE, meta: [
                'from' => (string) $lead->status,
                'to' => (string) $after['status'],
                'lost_reason' => $after['status'] === 'LOST' ? ($after['lost_reason'] ?? $lead->lost_reason) : null,
            ]);
        }
        if (array_key_exists('follow_up_at', $after)) {
            $this->logActivity($academyId, $id, LeadTimeline::FOLLOW_UP_SET, meta: [
                'follow_up_at' => $after['follow_up_at'],
            ]);
        }

        Audit::log('crm_lead.update', 'crm_lead', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /** POST /api/crm/leads/{id}/notes — append a note to the timeline (allowed even after convert). */
    public function addNote(Request $request, string $id): JsonResponse
    {
        Gate::authorize('crm.manage');

        $academyId = $this->currentAcademyId();
        $lead = DB::table('crm_leads')->where('id', $id)->whereNull('deleted_at')->first(['id']);
        if ($lead === null) {
            abort(404, 'Lead not found.');
        }

        $data = $request->validate([
            'body' => ['required', 'string', 'max:2000'],
        ]);

        $activityId = $this->logActivity($academyId, $id, LeadTimeline::NOTE, body: trim($data['body']));

        $activity = DB::table('crm_lead_activities as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.created_by')
            ->where('a.id', $activityId)
            ->first(['a.id', 'a.type', 'a.body', 'a.meta', 'a.created_at', 'u.full_name as author_name']);

        return response()->json(['activity' => $this->presentActivity($activity)], 201);
    }

    /**
     * POST /api/crm/leads/{id}/convert — link the lead to the real student it became, i.e. the
     * SUBSCRIBED stage. The student is created first via the normal student flow (POST /students)
     * so every required detail is collected by the one form that owns them; this endpoint records
     * the linkage. Any trial the lead sat in is adopted by that student too, so the person's
     * history survives the moment they stop being a prospect. Already-converted leads are
     * rejected.
     */
    public function convert(Request $request, string $id): JsonResponse
    {
        Gate::authorize('crm.manage');

        $academyId = $this->currentAcademyId();
        $lead = DB::table('crm_leads')->where('id', $id)->whereNull('deleted_at')->first();
        if ($lead === null) {
            abort(404, 'Lead not found.');
        }
        if ($lead->converted_student_id !== null) {
            throw ValidationException::withMessages(['lead' => ['This lead has already been converted.']]);
        }

        $data = $request->validate([
            'student_id' => ['required', 'uuid'],
        ]);
        if (DB::table('students')->where('id', $data['student_id'])->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['student_id' => ['Unknown or inactive student.']]);
        }

        DB::table('crm_leads')->where('id', $id)->update([
            'converted_student_id' => $data['student_id'],
            'status' => 'SUBSCRIBED',
            'lost_reason' => null,
            'updated_at' => now(),
        ]);

        // The trials this lead sat in belong to the student now — the trials page and the
        // student's own history should both name a person, not a ghost prospect.
        DB::table('trials')
            ->where('lead_id', $id)
            ->whereNull('student_id')
            ->whereNull('deleted_at')
            ->update(['student_id' => $data['student_id'], 'updated_at' => now()]);

        $this->logActivity($academyId, $id, LeadTimeline::CONVERTED, meta: ['student_id' => $data['student_id']]);

        Audit::log('crm_lead.convert', 'crm_lead', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['converted_student_id' => $data['student_id'], 'status' => 'SUBSCRIBED'],
            before: ['status' => $lead->status]);

        return response()->json(['ok' => true, 'studentId' => $data['student_id']]);
    }

    /**
     * POST /api/crm/leads/{id}/trial — move a lead into the TRIAL stage by actually booking one.
     *
     * This is the CRM's own write path into `trials` (gated by entitled:crm + crm.manage), not a
     * call into the Trials module — a sales desk that can work leads can book the taster that
     * sells them, without needing the trials capability of its own. The row it writes is the same
     * row the Trials module writes (one writer: {@see TrialBooking}), so the booking lands on the
     * calendar, in the trials pipeline and in the trials statistics the moment it is made.
     *
     * Conflicts and out-of-hours slots come back as WARNINGS, never a block (§3.7): the academy
     * knows things the roster does not.
     */
    public function bookTrial(Request $request, string $id): JsonResponse
    {
        Gate::authorize('crm.manage');

        $academyId = $this->currentAcademyId();
        $lead = DB::table('crm_leads')->where('id', $id)->whereNull('deleted_at')->first();
        if ($lead === null) {
            abort(404, 'Lead not found.');
        }
        if ($lead->converted_student_id !== null) {
            throw ValidationException::withMessages([
                'lead' => ['This lead is already a student — book their lessons from the calendar.'],
            ]);
        }

        $data = $request->validate([
            'teacher_id' => ['required', 'uuid'],
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $startUtc = $this->resolveInstant($data, $timezone);
        $duration = (int) $data['duration_minutes'];

        $trialId = TrialBooking::book($academyId, [
            'teacher_id' => $data['teacher_id'],
            'lead_id' => $id,
            // The trial carries a snapshot of the contact details so the teacher taking it, and
            // the trials page, can read them without joining back to the CRM.
            'lead_name' => $lead->full_name,
            'lead_whatsapp' => $lead->whatsapp_phone,
            'timezone' => $timezone,
            'duration_minutes' => $duration,
            'outcome_notes' => $data['notes'] ?? null,
        ], $startUtc, $this->ctx()->userId, $this->ctx()->role);

        $teacherName = (string) DB::table('teachers')->where('id', $data['teacher_id'])->value('full_name');

        // Booking a trial IS the move into the stage — including for a lead someone had written
        // off, which a booked trial revives.
        if ((string) $lead->status !== 'TRIAL') {
            DB::table('crm_leads')->where('id', $id)->update([
                'status' => 'TRIAL',
                'lost_reason' => null,
                'updated_at' => now(),
            ]);
            $this->logActivity($academyId, $id, LeadTimeline::STATUS_CHANGE, meta: [
                'from' => (string) $lead->status,
                'to' => 'TRIAL',
                'lost_reason' => null,
            ]);
        }

        $this->logActivity($academyId, $id, LeadTimeline::TRIAL_BOOKED, body: $data['notes'] ?? null, meta: [
            'trial_id' => $trialId,
            'teacher_id' => (string) $data['teacher_id'],
            'teacher_name' => $teacherName,
            'scheduled_at_utc' => $startUtc->toIso8601String(),
            'duration_minutes' => $duration,
        ]);

        Audit::log('crm_lead.trial_booked', 'crm_lead', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['trial_id' => $trialId, 'status' => 'TRIAL', 'scheduled_at_utc' => $startUtc->toIso8601String()],
            before: ['status' => $lead->status]);

        return response()->json([
            'trialId' => $trialId,
            'warnings' => $this->schedulingWarnings((string) $data['teacher_id'], $startUtc, $duration, $timezone),
        ], 201);
    }

    /**
     * GET /api/crm/teachers — the roster the trial form picks from.
     *
     * The CRM carries its own (tiny) teacher read so a delegated sales role never needs
     * `teacher.read` — which would open the full teacher surface (rates, payouts, profiles) to
     * someone whose whole job is booking a taster lesson.
     */
    public function teachers(): JsonResponse
    {
        Gate::authorize('crm.read');

        $teachers = DB::table('teachers')
            ->whereNull('deleted_at')
            ->orderBy('full_name')
            ->get(['id', 'full_name', 'specialization']);

        return response()->json([
            'teachers' => $teachers,
            'durations' => self::TRIAL_DURATIONS,
            'timezone' => $this->academyTimezone($this->currentAcademyId()),
        ]);
    }

    /** DELETE /api/crm/leads/{id} — soft-delete (mistaken entries; history stays queryable). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('crm.manage');

        $academyId = $this->currentAcademyId();
        $lead = DB::table('crm_leads')->where('id', $id)->whereNull('deleted_at')->first();
        if ($lead === null) {
            abort(404, 'Lead not found.');
        }

        DB::table('crm_leads')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        Audit::log('crm_lead.delete', 'crm_lead', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['full_name' => $lead->full_name, 'status' => $lead->status]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Today in the academy's timezone — the reference point for due/overdue follow-ups. */
    private function academyToday(): string
    {
        return Carbon::now($this->academyTimezone($this->currentAcademyId()))->toDateString();
    }

    /** Append one timeline row as the acting user; returns its id. */
    private function logActivity(string $academyId, string $leadId, string $type, ?string $body = null, ?array $meta = null): string
    {
        return LeadTimeline::log($academyId, $leadId, $type, $body, $meta, $this->ctx()->userId);
    }

    /** True when the lead has a trial that still counts — i.e. one that was not cancelled. */
    private function hasLiveTrial(string $leadId): bool
    {
        return DB::table('trials')
            ->where('lead_id', $leadId)
            ->whereNull('deleted_at')
            ->where('status', '!=', 'CANCELLED')
            ->exists();
    }

    /**
     * Hang each lead's current trial off the row the client renders, so a board card can show
     * "Tue 17:00 · Ms Noor" without a request per card. "Current" = the newest trial that still
     * counts; a lead whose only trial was cancelled still shows it (that IS the state), it just
     * ranks last.
     *
     * @param  list<object>  $leads
     */
    private function attachTrials(array $leads): void
    {
        $ids = array_values(array_filter(array_map(fn (object $l) => $l->id ?? null, $leads)));
        if ($ids === []) {
            return;
        }

        $rows = DB::table('trials as tr')
            ->leftJoin('teachers as te', 'te.id', '=', 'tr.teacher_id')
            ->whereIn('tr.lead_id', $ids)
            ->whereNull('tr.deleted_at')
            ->orderByRaw("(tr.status = 'CANCELLED') asc")
            ->orderByDesc('tr.scheduled_at_utc')
            ->get([
                'tr.id', 'tr.lead_id', 'tr.teacher_id', 'tr.scheduled_at_utc',
                'tr.duration_minutes', 'tr.status', 'tr.outcome_notes',
                'te.full_name as teacher_name',
            ]);

        $byLead = [];
        foreach ($rows as $row) {
            // Ordered best-first, so the first row seen for a lead is the one to show.
            $byLead[(string) $row->lead_id] ??= $row;
        }

        foreach ($leads as $lead) {
            $trial = $byLead[(string) $lead->id] ?? null;
            $lead->trial_id = $trial?->id;
            $lead->trial_status = $trial?->status;
            $lead->trial_teacher_id = $trial?->teacher_id;
            $lead->trial_teacher_name = $trial?->teacher_name;
            $lead->trial_notes = $trial?->outcome_notes;
            $lead->trial_duration_minutes = $trial === null ? null : (int) $trial->duration_minutes;
            $lead->trial_scheduled_at_utc = $trial === null
                ? null
                : Carbon::parse($trial->scheduled_at_utc)->utc()->toIso8601String();
        }
    }

    /** Normalise a lead row for the client (ISO timestamps; date stays a plain Y-m-d string). */
    private function presentLead(object $lead): object
    {
        $lead->created_at = Carbon::parse($lead->created_at)->utc()->toIso8601String();

        return $lead;
    }

    /** Normalise an activity row: decode meta, ISO timestamp. */
    private function presentActivity(object $activity): object
    {
        $activity->meta = is_string($activity->meta) ? (json_decode($activity->meta, true) ?: null) : $activity->meta;
        $activity->created_at = Carbon::parse($activity->created_at)->utc()->toIso8601String();

        return $activity;
    }
}
