<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\Invoicing;
use App\Services\Payroll;
use App\Services\Reports\ReportValidator;
use App\Services\Reports\WhatsAppReportBuilder;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\ReportFields;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The custom session-report surface (Sprint 6 §6). It renders/stores the academy's dynamic
 * report fields (Sprint 3), composes the manual WhatsApp message, and serves the per-student
 * report archive. Like the scheduling controllers it runs inside the request's tenant context
 * (RLS scopes every query) and shares the "RLS-plus-filter" teacher scoping (§3.6): a TEACHER
 * may only act on sessions they teach; Owners/support act on any session in the academy (R-BIL-4).
 */
final class SessionReportController extends Controller
{
    use InteractsWithScheduling;

    /**
     * PUT /api/sessions/{id}/report — create or update the report (validated against the
     * academy's active fields). Values are MERGED over the existing report so a deactivated
     * field's historical value survives an edit (deactivate-not-delete, AC-6.6). gated by
     * session.write_report (+ teacher filter). Editing a session in a CLOSED invoice period is
     * blocked (immutability, §2 out-of-scope boundary).
     */
    public function put(Request $request, string $sessionId): JsonResponse
    {
        Gate::authorize('session.write_report');

        $session = $this->findOwnedSession($sessionId);
        $this->assertPeriodOpen($session);

        $input = $request->validate(['values' => ['sometimes', 'array']]);

        $existing = DB::table('session_reports')->where('session_id', $sessionId)->first();
        $before = $existing !== null ? (json_decode($existing->values, true) ?: []) : [];
        $submitted = $input['values'] ?? [];

        // Merge existing values so previously-filled required fields stay satisfied on edits.
        // The validator also skips required-field checks when report_text is present (free-text mode).
        $clean = ReportValidator::validate((string) $session->academy_id, array_merge($before, $submitted));
        $merged = array_merge($before, $clean);
        // A field sent back empty was cleared on the form (a score tapped off, a line wiped): drop
        // it, or the merge above would quietly keep the old answer.
        foreach ($submitted as $key => $value) {
            if (($value === null || $value === '') && ! array_key_exists($key, $clean) && ! in_array($key, ['report_text', 'is_free_trial'], true)) {
                unset($merged[$key]);
            }
        }

        // Reserved free-text keys aren't academy field definitions, so the validator strips them.
        // Persist them explicitly: report_text holds the free-text report body and is_free_trial
        // flags a trial lesson (stored as ATTENDED on the session, surfaced as "Free" in the UI).
        if (array_key_exists('report_text', $submitted)) {
            $merged['report_text'] = (string) $submitted['report_text'];
        }
        if (array_key_exists('is_free_trial', $submitted)) {
            $merged['is_free_trial'] = (bool) $submitted['is_free_trial'];
        }

        DB::table('session_reports')->updateOrInsert(
            ['session_id' => $sessionId],
            [
                'academy_id' => $session->academy_id,
                'values' => json_encode($merged, JSON_UNESCAPED_UNICODE),
                'filled_by_user_id' => $this->ctx()->userId,
                'filled_at' => now(),
                'updated_at' => now(),
            ]
        );

        // A free-trial lesson is free for the student, the teacher, AND the academy. The UI
        // records attendance BEFORE saving this report, so by now any invoice/payout line was
        // already priced at the full rate. When the trial flag flips, re-derive both money
        // documents from this new truth (zero them, or restore the real price if un-flagged).
        $wasFreeTrial = (bool) ($before['is_free_trial'] ?? false);
        $nowFreeTrial = (bool) ($merged['is_free_trial'] ?? false);
        if ($wasFreeTrial !== $nowFreeTrial) {
            app(Invoicing::class)->repriceFreeTrial($session);
            app(Payroll::class)->repriceFreeTrial($session);
        }

        // The report now exists, so any "report overdue / reminder" alert for this session is
        // resolved — clear it from the Notifications feed (idempotent; no-op when none exist).
        DB::table('notifications')
            ->where('session_id', $sessionId)
            ->whereIn('type', ['REPORT_OVERDUE', 'REPORT_REMINDER'])
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        Audit::log('session.report_filled', 'session_report', $sessionId, (string) $session->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['values' => $merged],
            before: $existing !== null ? ['values' => $before] : null);

        return response()->json(['ok' => true, 'values' => $merged]);
    }

    /**
     * POST /api/sessions/{id}/report/whatsapp-sent — record that the manual WhatsApp report was
     * sent (timestamp + channel) and return the built message. NO automated delivery happens here
     * (MVP boundary, §6.4); Sprint 10 owns sending. gated by session.write_report (+ teacher filter).
     */
    public function whatsappSent(Request $request, WhatsAppReportBuilder $builder, string $sessionId): JsonResponse
    {
        Gate::authorize('session.write_report');

        // Dispatching the report to the guardian is an academy-admin action — the Teacher writes
        // the report but doesn't send it. Block the back door regardless of what the UI sends.
        if ($this->ctx()->role === 'TEACHER') {
            throw ValidationException::withMessages([
                'report' => ['Only the academy can send the report to the guardian. / لا يمكن سوى للأكاديمية إرسال التقرير لولي الأمر.'],
            ]);
        }

        $session = $this->findOwnedSession($sessionId);
        $report = DB::table('session_reports')->where('session_id', $sessionId)->first();
        if ($report === null) {
            throw ValidationException::withMessages([
                'report' => ['Write the report before marking it sent. / اكتب التقرير قبل تعليمه كمُرسَل.'],
            ]);
        }

        DB::table('session_reports')->where('session_id', $sessionId)->update([
            'whatsapp_sent_at' => now(),
            'whatsapp_channel' => 'MANUAL_WHATSAPP',
            'updated_at' => now(),
        ]);

        Audit::log('session.report_whatsapp_sent', 'session_report', $sessionId, (string) $session->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['whatsapp_sent_at' => now()->toIso8601String(), 'whatsapp_channel' => 'MANUAL_WHATSAPP'],
            before: ['whatsapp_sent_at' => $report->whatsapp_sent_at]);

        return response()->json([
            'ok' => true,
            'sentAt' => now()->toIso8601String(),
            'channel' => 'MANUAL_WHATSAPP',
            'message' => $builder->build($session, $report),
        ]);
    }

    /**
     * GET /api/students/{id}/reports — the per-student report archive: past sessions and their
     * reports, paginated via the shared DataTable, within RLS scope (AC-6.11). A TEACHER sees
     * only sessions they taught (§3.6). session.read.
     */
    public function archive(Request $request, string $studentId): JsonResponse
    {
        Gate::authorize('session.read');

        $query = DB::table('sessions as se')
            ->leftJoin('session_reports as sr', 'sr.session_id', '=', 'se.id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->where('se.student_id', $studentId)
            ->where('se.scheduled_at_utc', '<=', now()->format('Y-m-d H:i:sP'))
            ->select([
                'se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status',
                'te.full_name as teacher_name',
                'sr.values as report_values', 'sr.filled_at', 'sr.whatsapp_sent_at',
            ]);

        if ($this->ctx()->role === 'TEACHER') {
            $ownTeacherId = $this->callerTeacherId();
            if ($ownTeacherId === null) {
                abort(403, 'No teacher record for this user.');
            }
            $query->where('se.teacher_id', $ownTeacherId);
        }

        $result = DataTable::paginate($query, $request, [
            'sortable' => ['date' => 'se.scheduled_at_utc', 'status' => 'se.status'],
            'filters' => ['status' => fn ($q, $v) => $q->where('se.status', $v)],
            'defaultSort' => '-date',
            'idColumn' => 'se.id',
        ]);

        $rows = $result['rows']->map(function ($r) {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();
            $r->report_values = $r->report_values !== null ? (json_decode($r->report_values, true) ?: []) : null;

            return $r;
        });

        return response()->json([
            'reports' => $rows,
            'total' => $result['total'],
            'page' => $result['page'],
            'pageSize' => $result['pageSize'],
        ]);
    }

    /**
     * A report "has something in it": any answer other than the trial flag that is not blank once
     * its markup is stripped. The popup saves a report row on every outcome (a cancellation sends
     * an empty `report_text`), so the row alone says nothing about whether a report was written.
     */
    private const HAS_CONTENT = <<<'SQL'
        exists (
          select 1 from jsonb_each_text(sr."values") kv
          where kv.key <> 'is_free_trial'
            and regexp_replace(coalesce(kv.value, ''), '<[^>]*>|&nbsp;|[[:space:]]', '', 'g') <> ''
        )
        SQL;

    /** Delivered lessons — the ones a report is owed for (FlagOverdueReportsJob, minus the unmarked). */
    private const OWES_REPORT = ['ATTENDED', 'FREE'];

    /**
     * GET /api/session-reports — the reports log: every private lesson's report, newest first, with
     * its answers, across all of the caller's students. Teachers asked for it: their old reports were
     * only reachable through a salary statement. A TEACHER sees only lessons they taught (§3.6);
     * everyone else with session.read sees the academy's, optionally narrowed to one teacher.
     *
     * `filter[tab]`: `written` (default) = lessons whose report has something in it; `missing` =
     * delivered lessons (ATTENDED/FREE) that have ended with nothing written. `counts` carries both
     * under the same filters and search, so the tabs agree with the list. `fields` is every report
     * field the academy ever defined (retired ones included), to label old answers.
     */
    public function log(Request $request): JsonResponse
    {
        Gate::authorize('session.read');

        $filter = $request->validate([
            'filter' => ['sometimes', 'array'],
            'filter.tab' => ['sometimes', 'nullable', Rule::in(['written', 'missing'])],
            'filter.student_id' => ['sometimes', 'nullable', 'uuid'],
            'filter.teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'filter.from' => ['sometimes', 'nullable', 'date'],
            'filter.to' => ['sometimes', 'nullable', 'date'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ])['filter'] ?? [];

        $now = now()->utc()->toIso8601String();
        $base = DB::table('sessions as se')
            ->leftJoin('session_reports as sr', 'sr.session_id', '=', 'se.id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            // A deleted or wound-down lesson is off every lesson list; a RESCHEDULED row is only the
            // old slot's marker (its successor carries the lesson).
            ->whereNull('se.hidden_at')
            ->where('se.status', '!=', 'RESCHEDULED')
            ->where('se.scheduled_at_utc', '<=', $now);

        if ($this->ctx()->role === 'TEACHER') {
            $ownTeacherId = $this->callerTeacherId();
            if ($ownTeacherId === null) {
                abort(403, 'No teacher record for this user.');
            }
            $base->where('se.teacher_id', $ownTeacherId);
        } elseif (! empty($filter['teacher_id'])) {
            $base->where('se.teacher_id', $filter['teacher_id']);
        }
        if (! empty($filter['student_id'])) {
            $base->where('se.student_id', $filter['student_id']);
        }
        // Window edges are instants the client built on the academy's clock (as /sessions/day).
        if (! empty($filter['from'])) {
            $base->where('se.scheduled_at_utc', '>=', Carbon::parse($filter['from'])->utc()->toIso8601String());
        }
        if (! empty($filter['to'])) {
            $base->where('se.scheduled_at_utc', '<', Carbon::parse($filter['to'])->utc()->toIso8601String());
        }
        // A student's name or any word in the report itself ("الملك", "تجويد").
        DataTable::search($base, (string) $request->query('search', ''), ['st.full_name', 'sr."values"']);

        $hasContent = self::HAS_CONTENT;
        $owes = "se.status in ('".implode("','", self::OWES_REPORT)."')";
        $ended = 'se.scheduled_at_utc + make_interval(mins => se.duration_minutes) <= ?';
        $missing = "({$owes} and {$ended} and (sr.id is null or not {$hasContent}))";

        $counts = (clone $base)
            ->selectRaw("count(*) filter (where sr.id is not null and {$hasContent}) as written", [])
            ->selectRaw("count(*) filter (where {$missing}) as missing", [$now])
            ->first();

        $list = clone $base;
        if (($filter['tab'] ?? 'written') === 'missing') {
            $list->whereRaw($missing, [$now]);
        } else {
            $list->whereNotNull('sr.id')->whereRaw($hasContent);
        }
        $list->select([
            'se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status',
            'se.student_id', 'st.full_name as student_name',
            'se.teacher_id', 'te.full_name as teacher_name',
            'sr.values as report_values', 'sr.created_at as written_at', 'sr.whatsapp_sent_at',
            'fu.full_name as written_by_name',
        ])
            // Who saved it last: the teacher, or someone in the office writing it for them.
            ->leftJoin('users as fu', 'fu.id', '=', 'sr.filled_by_user_id')
            ->selectRaw('(sr.filled_by_user_id is not null and sr.filled_by_user_id = te.user_id) as written_by_teacher');

        $result = DataTable::paginate($list, $request, [
            'sortable' => ['date' => 'se.scheduled_at_utc'],
            'defaultSort' => '-date',
            'defaultPageSize' => 20,
            'idColumn' => 'se.id',
        ]);

        $iso = fn ($v) => $v !== null ? Carbon::parse($v)->utc()->toIso8601String() : null;
        $rows = $result['rows']->map(function ($r) use ($iso) {
            $r->scheduled_at_utc = $iso($r->scheduled_at_utc);
            // `created_at` takes the database's own default — the one timestamp on a report that is
            // never bound naively (filled_at is, and is re-stamped on every edit).
            $r->written_at = $iso($r->written_at);
            $r->whatsapp_sent_at = $iso($r->whatsapp_sent_at);
            $r->written_by_teacher = (bool) $r->written_by_teacher;
            $r->report_values = $r->report_values !== null ? (json_decode($r->report_values, true) ?: []) : null;

            return $r;
        });

        return response()->json([
            'rows' => $rows,
            'total' => $result['total'],
            'page' => $result['page'],
            'pageSize' => $result['pageSize'],
            'counts' => ['written' => (int) ($counts->written ?? 0), 'missing' => (int) ($counts->missing ?? 0)],
            'fields' => ReportFields::map(
                DB::table('report_field_definitions')
                    ->where('academy_id', $this->currentAcademyId())
                    ->orderBy('sort_order')
                    ->get()
            ),
        ]);
    }

    /**
     * Block writing a report when the session's invoice has already closed (immutable period,
     * §2 boundary). The session→invoice link is its line item; a session with no line item (e.g.
     * a non-billable outcome, or not yet billed) has no closed period to respect.
     */
    private function assertPeriodOpen(object $session): void
    {
        $line = DB::table('invoice_line_items')->where('session_id', $session->id)->first();
        if ($line === null) {
            return;
        }

        $status = DB::table('invoices')->where('id', $line->invoice_id)->value('status');
        if ($status !== null && $status !== 'OPEN') {
            throw ValidationException::withMessages([
                'report' => ["This session's invoice is closed; its report can no longer be edited. / فاتورة هذه الحصة مُقفلة، لا يمكن تعديل تقريرها."],
            ]);
        }
    }
}
