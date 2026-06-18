<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Student progress reports: a TEACHER writes a free-text monthly report about one of their own
 * students and submits it for the OWNER to review (the Notifications "Student Reports" tab) —
 * the same request → approve/reject workflow as CancellationRequestController.
 *
 * A teacher only ever sees/creates reports for students assigned to them; the review queue and
 * the approve/reject endpoints are OWNER-only (student_report.review). Every transition is
 * audited and RLS scopes every row to the academy.
 */
final class StudentProgressReportController extends Controller
{
    use InteractsWithScheduling;

    /**
     * GET /api/student-reports/students — the calling teacher's active students, for the report
     * form's picker. student_report.submit.
     */
    public function students(): JsonResponse
    {
        Gate::authorize('student_report.submit');

        $teacherId = $this->requireCallerTeacherId();

        $students = DB::table('student_teacher_assignments as a')
            ->join('students as s', 's.id', '=', 'a.student_id')
            ->where('a.teacher_id', $teacherId)
            ->whereNull('a.ended_at')
            ->whereNull('s.deleted_at')
            ->orderBy('s.full_name')
            ->get(['s.id', 's.full_name']);

        return response()->json(['students' => $students]);
    }

    /**
     * GET /api/student-reports — the calling teacher's own reports, newest first, with the
     * student name and any owner decision. student_report.submit.
     */
    public function index(): JsonResponse
    {
        Gate::authorize('student_report.submit');

        $teacherId = $this->requireCallerTeacherId();

        $rows = DB::table('student_progress_reports as r')
            ->leftJoin('students as s', 's.id', '=', 'r.student_id')
            ->leftJoin('users as ru', 'ru.id', '=', 'r.reviewed_by_user_id')
            ->where('r.teacher_id', $teacherId)
            ->select($this->rowColumns())
            ->orderByDesc('r.created_at')
            ->limit(200)
            ->get()
            ->map(fn ($r) => $this->shapeRow($r));

        return response()->json(['reports' => $rows]);
    }

    /**
     * POST /api/student-reports — submit a new monthly report for one of the teacher's students.
     * student_report.submit. Rejected/approved reports are immutable; to redo a month the teacher
     * submits a NEW report, so only one PENDING report may exist per (student, month) at a time.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('student_report.submit');

        $academyId = $this->currentAcademyId();
        $teacherId = $this->requireCallerTeacherId();

        $data = $request->validate([
            'student_id' => ['required', 'uuid'],
            'period_month' => ['required', 'date'],
            'title' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string', 'max:5000'],
        ]);

        // The student must be currently assigned to this teacher (RLS already pins the academy).
        $assigned = DB::table('student_teacher_assignments')
            ->where('teacher_id', $teacherId)
            ->where('student_id', $data['student_id'])
            ->whereNull('ended_at')
            ->exists();
        if (! $assigned) {
            throw ValidationException::withMessages([
                'student_id' => ['That student is not assigned to you. / هذا الطالب غير مُسند إليك.'],
            ]);
        }

        // Normalize to the first of the covered month so a month is a single canonical date.
        $periodMonth = Carbon::parse($data['period_month'])->startOfMonth()->toDateString();

        if (DB::table('student_progress_reports')
            ->where('student_id', $data['student_id'])
            ->where('teacher_id', $teacherId)
            ->where('period_month', $periodMonth)
            ->where('status', 'PENDING')
            ->exists()) {
            throw ValidationException::withMessages([
                'period_month' => ['A report for this student and month is already awaiting review. / يوجد تقرير لهذا الطالب وهذا الشهر بانتظار المراجعة بالفعل.'],
            ]);
        }

        $id = (string) Str::uuid();
        DB::table('student_progress_reports')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'student_id' => $data['student_id'],
            'teacher_id' => $teacherId,
            'created_by_user_id' => $this->ctx()->userId,
            'period_month' => $periodMonth,
            'title' => $data['title'],
            'body' => $data['body'],
            'status' => 'PENDING',
        ]);

        Audit::log('student_report.submitted', 'student_progress_report', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'student_id' => $data['student_id'],
            'period_month' => $periodMonth,
            'title' => $data['title'],
        ]);

        return response()->json(['reportId' => $id, 'status' => 'PENDING'], 201);
    }

    /**
     * GET /api/student-reports/review — the owner's review queue: every report in the academy,
     * PENDING first then newest. Optional ?status= filter. student_report.review (owner-only).
     */
    public function review(Request $request): JsonResponse
    {
        Gate::authorize('student_report.review');

        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(['PENDING', 'APPROVED', 'REJECTED'])],
        ]);

        $query = DB::table('student_progress_reports as r')
            ->leftJoin('students as s', 's.id', '=', 'r.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'r.teacher_id')
            ->leftJoin('users as ru', 'ru.id', '=', 'r.reviewed_by_user_id')
            ->select(array_merge($this->rowColumns(), ['te.full_name as teacher_name']))
            ->orderByRaw("case when r.status = 'PENDING' then 0 else 1 end")
            ->orderByDesc('r.created_at');

        if (! empty($data['status'])) {
            $query->where('r.status', $data['status']);
        }

        $rows = $query->limit(200)->get()->map(fn ($r) => $this->shapeRow($r));

        return response()->json(['reports' => $rows]);
    }

    /** POST /api/student-reports/{id}/approve — owner accepts the report. student_report.review. */
    public function approve(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student_report.review');

        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:500']]);

        return $this->decide($id, approve: true, note: $data['note'] ?? null);
    }

    /** POST /api/student-reports/{id}/reject — owner declines the report. student_report.review. */
    public function reject(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student_report.review');

        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:500']]);

        return $this->decide($id, approve: false, note: $data['note'] ?? null);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function decide(string $id, bool $approve, ?string $note): JsonResponse
    {
        $academyId = $this->currentAcademyId();

        return DB::transaction(function () use ($id, $approve, $note, $academyId) {
            $report = DB::table('student_progress_reports')->where('id', $id)->lockForUpdate()->first();
            if ($report === null) {
                abort(404, 'Report not found.');
            }
            if ($report->status !== 'PENDING') {
                throw ValidationException::withMessages([
                    'report' => ['This report has already been reviewed. / تمت مراجعة هذا التقرير من قبل.'],
                ]);
            }

            $status = $approve ? 'APPROVED' : 'REJECTED';
            DB::table('student_progress_reports')->where('id', $id)->update([
                'status' => $status,
                'reviewed_by_user_id' => $this->ctx()->userId,
                'reviewed_at' => now(),
                'review_note' => $note,
                'seen_by_teacher_at' => null, // re-surface the fresh decision to the teacher
                'updated_at' => now(),
            ]);

            Audit::log($approve ? 'student_report.approved' : 'student_report.rejected',
                'student_progress_report', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                before: ['status' => 'PENDING'],
                after: ['status' => $status, 'note' => $note]);

            return response()->json(['ok' => true, 'status' => $status]);
        });
    }

    /** The teacher row id for the calling user, or a 403 if the caller is not a teacher. */
    private function requireCallerTeacherId(): string
    {
        $teacherId = $this->callerTeacherId();
        if ($teacherId === null) {
            abort(403, 'Only a teacher can write student reports.');
        }

        return $teacherId;
    }

    /** @return list<string> the shared select list for a report row. */
    private function rowColumns(): array
    {
        return [
            'r.id', 'r.student_id', 'r.teacher_id', 'r.period_month', 'r.title', 'r.body',
            'r.status', 'r.review_note', 'r.reviewed_at', 'r.seen_by_teacher_at', 'r.created_at',
            's.full_name as student_name', 'ru.full_name as reviewed_by_name',
        ];
    }

    private function shapeRow(object $r): object
    {
        $r->period_month = Carbon::parse($r->period_month)->toDateString();
        $r->created_at = Carbon::parse($r->created_at)->utc()->toIso8601String();
        $r->reviewed_at = $r->reviewed_at !== null ? Carbon::parse($r->reviewed_at)->utc()->toIso8601String() : null;

        return $r;
    }
}
