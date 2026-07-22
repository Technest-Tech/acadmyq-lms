<?php

declare(strict_types=1);

namespace App\Http\Controllers\Crm;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\Phone;
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
 * walked through a fixed five-step pipeline (NEW → CONTACTED → INTERESTED → WON/LOST) on a
 * board or list; every touch lands on the lead's activity timeline (who, what, when) so a
 * beginner on the sales desk can always pick up where a colleague left off.
 *
 * Two capabilities gate the surface: `crm.read` (board, list, stats, timeline) and
 * `crm.manage` (add, move, note, convert, delete). Both are OWNER-only by default and meant
 * to be delegated to sales/support staff through a custom role. RLS scopes every query to
 * the current academy.
 *
 * Converting mirrors trials: the student is created first through the normal student flow,
 * then POST /convert records the linkage (converted_student_id + WON) — after which the
 * lead is locked except for notes, like a CONVERTED trial.
 */
final class LeadController extends Controller
{
    use InteractsWithScheduling;

    private const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'WON', 'LOST'];

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
                    $open = fn ($qq) => $qq->whereNotIn('l.status', ['WON', 'LOST']);
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

        $open = fn () => $base()->whereNotIn('status', ['WON', 'LOST']);
        $dueToday = (int) $open()->where('follow_up_at', $today)->count();
        $overdue = (int) $open()->where('follow_up_at', '<', $today)->count();

        // Conversion rate over leads that reached an outcome: won ÷ (won + lost).
        $resolved = $counts['won'] + $counts['lost'];
        $conversionRate = $resolved > 0 ? round(($counts['won'] / $resolved) * 100) : 0;

        return response()->json($counts + [
            'total' => array_sum($counts),
            'open' => $counts['new'] + $counts['contacted'] + $counts['interested'],
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

        $this->logActivity($academyId, $leadId, 'CREATED');
        if (! empty($data['note'])) {
            $this->logActivity($academyId, $leadId, 'NOTE', body: $data['note']);
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

        return response()->json([
            'lead' => $this->presentLead($lead),
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
            $this->logActivity($academyId, $id, 'STATUS_CHANGE', meta: [
                'from' => (string) $lead->status,
                'to' => (string) $after['status'],
                'lost_reason' => $after['status'] === 'LOST' ? ($after['lost_reason'] ?? $lead->lost_reason) : null,
            ]);
        }
        if (array_key_exists('follow_up_at', $after)) {
            $this->logActivity($academyId, $id, 'FOLLOW_UP_SET', meta: [
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

        $activityId = $this->logActivity($academyId, $id, 'NOTE', body: trim($data['body']));

        $activity = DB::table('crm_lead_activities as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.created_by')
            ->where('a.id', $activityId)
            ->first(['a.id', 'a.type', 'a.body', 'a.meta', 'a.created_at', 'u.full_name as author_name']);

        return response()->json(['activity' => $this->presentActivity($activity)], 201);
    }

    /**
     * POST /api/crm/leads/{id}/convert — link the lead to the real student it became.
     * The student is created first via the normal student flow (POST /students); this endpoint
     * records the linkage and moves the lead to WON. Already-converted leads are rejected.
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
            'status' => 'WON',
            'lost_reason' => null,
            'updated_at' => now(),
        ]);

        $this->logActivity($academyId, $id, 'CONVERTED', meta: ['student_id' => $data['student_id']]);

        Audit::log('crm_lead.convert', 'crm_lead', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['converted_student_id' => $data['student_id'], 'status' => 'WON'],
            before: ['status' => $lead->status]);

        return response()->json(['ok' => true, 'studentId' => $data['student_id']]);
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

    /** Append one timeline row; returns its id. */
    private function logActivity(string $academyId, string $leadId, string $type, ?string $body = null, ?array $meta = null): string
    {
        $id = (string) Str::uuid();
        DB::table('crm_lead_activities')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'lead_id' => $leadId,
            'type' => $type,
            'body' => $body,
            'meta' => $meta === null ? null : json_encode($meta),
            'created_by' => $this->ctx()->userId,
        ]);

        return $id;
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
