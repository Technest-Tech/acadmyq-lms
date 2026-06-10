<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\Reports\ReportValidator;
use App\Services\Reports\WhatsAppReportBuilder;
use App\Support\Audit;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
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
        $clean = ReportValidator::validate((string) $session->academy_id, $input['values'] ?? []);

        $existing = DB::table('session_reports')->where('session_id', $sessionId)->first();
        $before = $existing !== null ? (json_decode($existing->values, true) ?: []) : [];
        $merged = array_merge($before, $clean);

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
