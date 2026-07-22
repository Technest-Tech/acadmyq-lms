<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Payroll;
use App\Support\AuthContext;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Sprint 8 payout surface. Covers the owner's all-teachers list + detail, the teacher's own
 * self-view, period finalize, and the per-currency profit summary. All endpoints run through
 * auth:sanctum + tenant.context; RLS is the backstop for every DB::table() call. Teacher reads
 * are additionally row-filtered to their own `teacher_id` (Sprint 2 §3.6, AC-8.8).
 */
final class PayoutController extends Controller
{
    // -------------------------------------------------------------------------
    // GET /api/payouts  — owner: all teachers' payouts
    // -------------------------------------------------------------------------

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('payout.read');

        $query = DB::table('payouts as p')
            ->leftJoin('teachers as t', 't.id', '=', 'p.teacher_id')
            ->select([
                'p.id',
                'p.teacher_id',
                'p.period_year',
                'p.period_month',
                'p.total_minor',
                'p.currency',
                'p.finalized_at',
                'p.created_at',
                DB::raw('t.full_name as teacher_name'),
                DB::raw("case when p.finalized_at is null then 'OPEN' else 'FINALIZED' end as status"),
            ]);

        $result = DataTable::paginate($query, $request, [
            'searchable' => [],
            'filters' => [
                'teacher_id' => fn ($q, $v) => $q->where('p.teacher_id', $v),
                'period_year' => fn ($q, $v) => $q->where('p.period_year', (int) $v),
                'period_month' => fn ($q, $v) => $q->where('p.period_month', (int) $v),
                'status' => function ($q, $v): void {
                    if ($v === 'OPEN') {
                        $q->whereNull('p.finalized_at');
                    } elseif ($v === 'FINALIZED') {
                        $q->whereNotNull('p.finalized_at');
                    }
                },
            ],
            'sortable' => [
                'period' => DB::raw('p.period_year * 100 + p.period_month'),
                'period_year' => 'p.period_year',
                'period_month' => 'p.period_month',
                'total_minor' => 'p.total_minor',
                'teacher_name' => 't.full_name',
                'created_at' => 'p.created_at',
            ],
            'defaultSort' => '-period',
            'idColumn' => 'p.id',
        ]);

        return response()->json([
            'rows' => $result['rows'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pageSize' => $result['pageSize'],
        ]);
    }

    // -------------------------------------------------------------------------
    // GET /api/me/payouts  — teacher: own payout statements
    // -------------------------------------------------------------------------

    public function mePayouts(Request $request): JsonResponse
    {
        Gate::authorize('payout.read_own');

        $teacherId = $this->ownTeacherId();
        if ($teacherId === null) {
            // No teacher record linked to this login → an empty (but well-formed) list.
            return response()->json(['rows' => [], 'total' => 0, 'page' => 1, 'pageSize' => 25]);
        }

        $query = DB::table('payouts as p')
            ->where('p.teacher_id', $teacherId)
            ->select([
                'p.id',
                'p.teacher_id',
                'p.period_year',
                'p.period_month',
                'p.total_minor',
                'p.currency',
                'p.finalized_at',
                'p.created_at',
                DB::raw("case when p.finalized_at is null then 'OPEN' else 'FINALIZED' end as status"),
            ]);

        $result = DataTable::paginate($query, $request, [
            'searchable' => [],
            'filters' => [
                'period_year' => fn ($q, $v) => $q->where('p.period_year', (int) $v),
                'period_month' => fn ($q, $v) => $q->where('p.period_month', (int) $v),
            ],
            'sortable' => [
                'period' => DB::raw('p.period_year * 100 + p.period_month'),
                'total_minor' => 'p.total_minor',
                'created_at' => 'p.created_at',
            ],
            'defaultSort' => '-period',
            'idColumn' => 'p.id',
        ]);

        return response()->json([
            'rows' => $result['rows'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pageSize' => $result['pageSize'],
        ]);
    }

    // -------------------------------------------------------------------------
    // GET /api/payouts/{id}  — owner (any) or teacher (own only)
    // -------------------------------------------------------------------------

    public function show(string $id): JsonResponse
    {
        $ctx = app(AuthContext::class);
        $canReadAll = $ctx->can('payout.read');
        $canReadOwn = $ctx->can('payout.read_own');

        if (! $canReadAll && ! $canReadOwn) {
            abort(403);
        }

        $payout = DB::table('payouts as p')
            ->leftJoin('teachers as t', 't.id', '=', 'p.teacher_id')
            ->where('p.id', $id)
            ->select([
                'p.id',
                'p.academy_id',
                'p.teacher_id',
                'p.period_year',
                'p.period_month',
                'p.total_minor',
                'p.rewards_minor',
                'p.deductions_minor',
                'p.currency',
                'p.finalized_at',
                'p.notes',
                'p.created_at',
                DB::raw('t.full_name as teacher_name'),
                DB::raw("case when p.finalized_at is null then 'OPEN' else 'FINALIZED' end as status"),
            ])
            ->first();

        if ($payout === null) {
            abort(404, 'Payout not found.');
        }

        // Sessions subtotal = net − rewards + deductions (the per-session gross before adjustments).
        $payout->sessions_minor = (int) $payout->total_minor
            - (int) $payout->rewards_minor
            + (int) $payout->deductions_minor;

        // Teacher self-scope (§3.6): without payout.read, you may only open your own statement.
        if (! $canReadAll) {
            $ownTeacherId = $this->ownTeacherId();
            if ($ownTeacherId === null || (string) $payout->teacher_id !== $ownTeacherId) {
                abort(403);
            }
        }

        $lineItems = DB::table('payout_line_items as li')
            ->leftJoin('sessions as se', 'se.id', '=', 'li.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('session_reports as sr', 'sr.session_id', '=', 'li.session_id')
            ->where('li.payout_id', $id)
            ->orderBy('li.session_date')
            ->orderBy('li.created_at')
            ->select([
                'li.id',
                'li.session_id',
                'li.amount_minor',
                'li.currency',
                'li.session_date',
                DB::raw('st.full_name as student_name'),
                DB::raw("case when sr.whatsapp_sent_at is not null then 'SENT' when sr.filled_at is not null then 'FILLED' else 'MISSING' end as report_status"),
            ])
            ->get();

        // `source` tells the statement WHO moved this money: a human typing on this page (MANUAL),
        // a quality report (QUALITY), or the unmarked-lesson sweep (AUTO_UNREPORTED). The teacher
        // reads this statement, so "the system docked you" must never look like "your manager did".
        // It also drives the row's actions — a derived row can't be deleted from here.
        $adjustments = DB::table('payout_adjustments')
            ->where('payout_id', $id)
            ->orderBy('created_at')
            ->select([
                'id',
                'type',
                'source',
                'amount_minor',
                'currency',
                'reason',
                'details',
                'session_id',
                'quality_report_id',
                'created_at',
            ])
            ->get();

        return response()->json([
            'payout' => $payout,
            'lineItems' => $lineItems,
            'adjustments' => $adjustments,
        ]);
    }

    // -------------------------------------------------------------------------
    // POST /api/payouts/{id}/adjustments  — add a reward or deduction
    // -------------------------------------------------------------------------

    public function addAdjustment(Request $request, string $id): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $validated = $request->validate([
            'type' => ['required', 'string', 'in:REWARD,DEDUCTION'],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'max:200'],
            'details' => ['nullable', 'string', 'max:2000'],
        ]);

        $ctx = app(AuthContext::class);

        $adjustmentId = app(Payroll::class)->addAdjustment(
            $id,
            (string) $ctx->academyId,
            $validated['type'],
            (int) $validated['amount_minor'],
            $validated['reason'],
            $validated['details'] ?? null,
            (string) $ctx->userId,
            $ctx->role,
        );

        return response()->json(['ok' => true, 'id' => $adjustmentId], 201);
    }

    // -------------------------------------------------------------------------
    // DELETE /api/payouts/{id}/adjustments/{adjustmentId}  — remove one
    // -------------------------------------------------------------------------

    public function removeAdjustment(string $id, string $adjustmentId): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $ctx = app(AuthContext::class);

        app(Payroll::class)->removeAdjustment(
            $adjustmentId,
            (string) $ctx->academyId,
            (string) $ctx->userId,
            $ctx->role,
        );

        return response()->json(['ok' => true]);
    }

    // -------------------------------------------------------------------------
    // POST /api/payouts/finalize  — finalize a whole period
    // -------------------------------------------------------------------------

    public function finalize(Request $request): JsonResponse
    {
        Gate::authorize('payout.finalize');

        $validated = $request->validate([
            'year' => ['required', 'integer'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
        ]);

        $ctx = app(AuthContext::class);

        $finalized = app(Payroll::class)->finalizePeriodPayouts(
            (string) $ctx->academyId,
            (int) $validated['year'],
            (int) $validated['month'],
            (string) $ctx->userId,
            $ctx->role,
        );

        return response()->json(['finalized' => $finalized]);
    }

    // -------------------------------------------------------------------------
    // GET /api/reports/profit-summary  — owner: per-currency revenue − payouts
    // -------------------------------------------------------------------------

    /**
     * Per-period, per-currency profit = revenue − payouts (decision §6). Revenue is the sum of
     * amounts actually paid (amount_paid_minor) on Sprint-7 invoices that are
     * CLOSED/PAID/PARTIALLY_PAID for the period — money received, not money owed; payouts is the sum of
     * payout totals for the period. Grouped by currency, NEVER summed across currencies (R-INV-7
     * analogue, AC-8.9). RLS scopes both reads to the current academy.
     */
    public function profitSummary(Request $request): JsonResponse
    {
        Gate::authorize('payout.read');

        $validated = $request->validate([
            'year' => ['required', 'integer'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
        ]);

        $year = (int) $validated['year'];
        $month = (int) $validated['month'];

        $revenue = DB::table('invoices')
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->whereIn('status', ['CLOSED', 'PAID', 'PARTIALLY_PAID'])
            ->groupBy('currency')
            ->select('currency', DB::raw('sum(amount_paid_minor) as revenue_minor'))
            ->get();

        $payouts = DB::table('payouts')
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->groupBy('currency')
            ->select('currency', DB::raw('sum(total_minor) as payouts_minor'))
            ->get();

        $byCurrency = [];
        foreach ($revenue as $r) {
            $byCurrency[$r->currency] = [
                'currency' => $r->currency,
                'revenue_minor' => (int) $r->revenue_minor,
                'payouts_minor' => 0,
            ];
        }
        foreach ($payouts as $p) {
            if (! isset($byCurrency[$p->currency])) {
                $byCurrency[$p->currency] = [
                    'currency' => $p->currency,
                    'revenue_minor' => 0,
                    'payouts_minor' => 0,
                ];
            }
            $byCurrency[$p->currency]['payouts_minor'] = (int) $p->payouts_minor;
        }

        $rows = array_values(array_map(static function (array $row): array {
            $row['profit_minor'] = $row['revenue_minor'] - $row['payouts_minor'];

            return $row;
        }, $byCurrency));

        return response()->json([
            'year' => $year,
            'month' => $month,
            'rows' => $rows,
        ]);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /** The teacher row id linked to the current login, or null if none (§3.6). */
    private function ownTeacherId(): ?string
    {
        $ctx = app(AuthContext::class);

        $id = DB::table('teachers')
            ->where('user_id', $ctx->userId)
            ->whereNull('deleted_at')
            ->value('id');

        return $id !== null ? (string) $id : null;
    }
}
