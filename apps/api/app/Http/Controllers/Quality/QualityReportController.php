<?php

declare(strict_types=1);

namespace App\Http\Controllers\Quality;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\TeacherQuality;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Quality REPORTS — one evaluation of one teacher against the academy's rubric, either SESSION-
 * scoped (this lesson) or MONTHLY-scoped (the period's whole pay). The report holds a percent; the
 * money is a derived payout deduction {@see TeacherQuality} keeps in step.
 *
 * Two audiences, deliberately separated:
 *   • owner/support — `teacher_quality.read` / `.manage` over every teacher.
 *   • the teacher   — `teacher_quality.read_own` over THEMSELVES only (`/api/me/quality-reports`),
 *     self-scoped here rather than by RLS, which pins the academy but not the person.
 */
final class QualityReportController extends Controller
{
    use InteractsWithScheduling;

    public function __construct(private readonly TeacherQuality $quality) {}

    /** GET /api/quality/reports — every report in the academy, newest first. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.read');

        $result = DataTable::paginate($this->baseQuery(), $request, [
            'idColumn'   => 'r.id',
            'searchable' => ['te.full_name', 'r.note'],
            'sortable'   => [
                'created_at' => 'r.created_at',
                'teacher'    => 'te.full_name',
                'percent'    => 'r.total_bp',
            ],
            'filters' => [
                'teacher_id' => fn ($q, $value) => $q->where('r.teacher_id', $value),
                'scope'      => fn ($q, $value) => $q->where('r.scope', strtoupper((string) $value)),
                'period'     => function ($q, $value) {
                    // "YYYY-MM" — the statement a report bites into.
                    [$year, $month] = array_pad(explode('-', (string) $value), 2, null);
                    if ($year !== null && $month !== null) {
                        $q->where('r.period_year', (int) $year)->where('r.period_month', (int) $month);
                    }
                },
            ],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): object => $this->presentRow($r));

        return response()->json($result);
    }

    /** GET /api/quality/reports/{id} — one report with its full answer sheet. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.read');

        return response()->json($this->reportPayload($id));
    }

    /**
     * POST /api/quality/reports — judge a teacher against the rubric.
     *
     * `items` is the answer sheet the UI ticked: every criterion considered, met or not. Only the
     * unmet ones cost anything.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $data = $request->validate([
            'teacher_id'         => ['required', 'uuid'],
            'scope'              => ['required', Rule::in(TeacherQuality::SCOPES)],
            'session_id'         => ['nullable', 'uuid', 'required_if:scope,SESSION'],
            'period_year'        => ['nullable', 'integer', 'min:2000', 'max:2100', 'required_if:scope,MONTHLY'],
            'period_month'       => ['nullable', 'integer', 'min:1', 'max:12', 'required_if:scope,MONTHLY'],
            'note'               => ['nullable', 'string', 'max:2000'],
            'items'              => ['required', 'array', 'min:1'],
            'items.*.criterion_id' => ['required', 'uuid'],
            'items.*.met'          => ['required', 'boolean'],
        ]);

        $ctx        = $this->ctx();
        $academyId  = $this->currentAcademyId();
        $authorName = $ctx->userId !== null
            ? DB::table('users')->where('id', $ctx->userId)->value('full_name')
            : null;

        $reportId = $this->quality->createReport(
            academyId: $academyId,
            teacherId: $data['teacher_id'],
            scope: $data['scope'],
            sessionId: $data['session_id'] ?? null,
            year: isset($data['period_year']) ? (int) $data['period_year'] : null,
            month: isset($data['period_month']) ? (int) $data['period_month'] : null,
            answers: $data['items'],
            note: $data['note'] ?? null,
            actorUserId: $ctx->userId,
            actorName: $authorName !== null ? (string) $authorName : null,
            actorRole: $ctx->role,
        );

        return response()->json(['reportId' => $reportId], 201);
    }

    /** DELETE /api/quality/reports/{id} — withdraw a report and the deduction it caused. */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $this->quality->deleteReport($id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['ok' => true]);
    }

    /**
     * GET /api/quality/reports/summary — the page's headline tiles for one period.
     *
     * `avg_score` is the flip side of the docked percent: 100 means every report in the period
     * found nothing wrong. It is an average over reports, not over teachers, so it answers "how
     * well is delivery going right now", not "who is worst" — the table below it answers that.
     */
    public function summary(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.read');

        $academyId = $this->currentAcademyId();
        $now       = Carbon::now($this->academyTimezone($academyId));
        $year      = (int) $request->integer('year', $now->year);
        $month     = (int) $request->integer('month', $now->month);

        $scoped = DB::table('teacher_quality_reports')
            ->where('period_year', $year)
            ->where('period_month', $month);

        $reportCount     = (clone $scoped)->count();
        $avgBp           = (float) ((clone $scoped)->avg('total_bp') ?? 0);
        $teachersFlagged = (clone $scoped)->where('total_bp', '>', 0)->distinct()->count('teacher_id');

        // What the period's reports actually cost, straight off the derived rows — never re-derived
        // here, so the tile can't drift from the statements.
        $docked = DB::table('payout_adjustments as pa')
            ->join('payouts as p', 'p.id', '=', 'pa.payout_id')
            ->where('pa.source', 'QUALITY')
            ->where('p.period_year', $year)
            ->where('p.period_month', $month)
            ->groupBy('pa.currency')
            ->select('pa.currency', DB::raw('sum(pa.amount_minor) as amount_minor'))
            ->get()
            ->map(fn (object $r): array => [
                'currency'     => (string) $r->currency,
                'amount_minor' => (int) $r->amount_minor,
            ])
            ->values()
            ->all();

        return response()->json([
            'year'             => $year,
            'month'            => $month,
            'report_count'     => $reportCount,
            'teachers_flagged' => $teachersFlagged,
            // A display statistic, not money — a float average is fine here.
            'avg_score' => round(100 - ($avgBp / 100), 1),
            'docked'    => $docked,
        ]);
    }

    /**
     * GET /api/quality/teachers/{id}/sessions — the teacher's recent lessons, for the SESSION-scope
     * picker. Deliberately narrow: only lessons that already happened can be judged.
     */
    public function teacherSessions(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.read');

        $timezone = $this->academyTimezone($this->currentAcademyId());

        $sessions = DB::table('sessions as se')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teacher_quality_reports as r', 'r.session_id', '=', 'se.id')
            ->where('se.teacher_id', $id)
            ->where('se.scheduled_at_utc', '<=', now()->format('Y-m-d H:i:sP'))
            ->where('se.scheduled_at_utc', '>=', now()->subDays(60)->format('Y-m-d H:i:sP'))
            ->whereNotIn('se.status', ['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT', 'RESCHEDULED'])
            ->orderByDesc('se.scheduled_at_utc')
            ->limit(100)
            ->get([
                'se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status',
                'st.full_name as student_name', 'r.id as report_id',
            ])
            ->map(fn (object $s): array => [
                'id'               => (string) $s->id,
                'scheduled_at_utc' => Carbon::parse($s->scheduled_at_utc)->utc()->toIso8601String(),
                'local_date'       => Carbon::parse($s->scheduled_at_utc)->setTimezone($timezone)->format('Y-m-d H:i'),
                'duration_minutes' => (int) $s->duration_minutes,
                'status'           => (string) $s->status,
                'student_name'     => $s->student_name,
                // Already judged — the UI greys it out rather than letting the unique index 500.
                'has_report'       => $s->report_id !== null,
            ])
            ->values()
            ->all();

        return response()->json(['sessions' => $sessions]);
    }

    // -------------------------------------------------------------------------
    // Teacher self-service
    // -------------------------------------------------------------------------

    /**
     * GET /api/me/quality-reports — the reports written about the CALLING teacher.
     *
     * Self-scoped here, not by RLS: RLS pins the academy, which would hand a teacher every
     * colleague's reports. The teacher_id filter below is the only thing standing between them.
     */
    public function mine(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.read_own');

        $teacherId = $this->callerTeacherId();
        if ($teacherId === null) {
            return response()->json(['rows' => [], 'total' => 0, 'page' => 1, 'pageSize' => 0]);
        }

        $result = DataTable::paginate($this->baseQuery()->where('r.teacher_id', $teacherId), $request, [
            'idColumn'    => 'r.id',
            'sortable'    => ['created_at' => 'r.created_at'],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): object => $this->presentRow($r));

        return response()->json($result);
    }

    /** GET /api/me/quality-reports/{id} — one of the calling teacher's own reports, in full. */
    public function mineShow(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.read_own');

        $teacherId = $this->callerTeacherId();
        $report    = DB::table('teacher_quality_reports')->where('id', $id)->first(['teacher_id']);

        if ($report === null) {
            abort(404, 'Report not found.');
        }
        if ($teacherId === null || (string) $report->teacher_id !== $teacherId) {
            abort(403, 'Not your report.');
        }

        return response()->json($this->reportPayload($id));
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /** Reports joined to the names a row needs. RLS scopes it to the academy. */
    private function baseQuery(): \Illuminate\Database\Query\Builder
    {
        return DB::table('teacher_quality_reports as r')
            ->leftJoin('teachers as te', 'te.id', '=', 'r.teacher_id')
            ->leftJoin('sessions as se', 'se.id', '=', 'r.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('payout_adjustments as pa', 'pa.quality_report_id', '=', 'r.id')
            ->select([
                'r.id', 'r.teacher_id', 'r.scope', 'r.session_id', 'r.period_year', 'r.period_month',
                'r.total_bp', 'r.note', 'r.author_name', 'r.created_at',
                'te.full_name as teacher_name',
                'st.full_name as student_name',
                'se.scheduled_at_utc',
                // The derived cost. NULL when the percent bites into nothing yet (no pay accrued),
                // which is a real state, not a missing row.
                'pa.amount_minor', 'pa.currency',
            ]);
    }

    private function presentRow(object $r): object
    {
        $r->id         = (string) $r->id;
        $r->teacher_id = (string) $r->teacher_id;
        // Storage is basis points (exact integer money math); the wire speaks percent.
        $r->total_percent = ((int) $r->total_bp) / 100;
        unset($r->total_bp);
        $r->period_year  = (int) $r->period_year;
        $r->period_month = (int) $r->period_month;
        $r->amount_minor = $r->amount_minor !== null ? (int) $r->amount_minor : null;
        $r->created_at   = Carbon::parse($r->created_at)->utc()->toIso8601String();

        if ($r->scheduled_at_utc !== null) {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();
        }

        return $r;
    }

    /** @return array{report: object, items: list<array<string, mixed>>} */
    private function reportPayload(string $id): array
    {
        $report = $this->baseQuery()->where('r.id', $id)->first();

        if ($report === null) {
            abort(404, 'Report not found.');
        }

        $items = DB::table('teacher_quality_report_items')
            ->where('report_id', $id)
            ->orderBy('category_name')
            ->orderBy('criterion_name')
            ->get(['id', 'category_name', 'criterion_name', 'discount_bp', 'met'])
            ->map(fn (object $i): array => [
                'id'               => (string) $i->id,
                'category_name'    => (string) $i->category_name,
                'criterion_name'   => (string) $i->criterion_name,
                'discount_percent' => ((int) $i->discount_bp) / 100,
                'met'              => (bool) $i->met,
            ])
            ->values()
            ->all();

        return ['report' => $this->presentRow($report), 'items' => $items];
    }
}
