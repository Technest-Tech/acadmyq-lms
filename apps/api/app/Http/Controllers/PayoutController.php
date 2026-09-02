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
                // The statements a date window TOUCHES. A window is measured in days but a payout
                // is a month, so overlap is the only honest relation between them: `2026-06` and
                // `2026-07` are both "in" a window running from 25 June to 5 July. Compared as
                // year*100+month so a single integer orders and bounds the period.
                'period_from' => fn ($q, $v) => $q->whereRaw('p.period_year * 100 + p.period_month >= ?', [self::periodKey($v)]),
                'period_to' => fn ($q, $v) => $q->whereRaw('p.period_year * 100 + p.period_month <= ?', [self::periodKey($v)]),
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
    // GET /api/payouts/range  — what each teacher earned between two dates
    // -------------------------------------------------------------------------

    /**
     * Salaries for an arbitrary window, rather than for a calendar month.
     *
     * Payouts are month-bucketed by construction (one statement per teacher per month), so this
     * does NOT read `payouts.total_minor` — that figure belongs to a month and cannot answer
     * "the 10th to the 24th". It re-adds the parts instead:
     *
     *   • Lessons are sliced EXACTLY, on `payout_line_items.session_date` — the academy-local date
     *     the payroll engine already snapshotted onto every line, so a window never disagrees with
     *     the statement a line came from.
     *
     *   • Adjustments have no lesson to sit on, so they are anchored on the date they REFER to:
     *     the lesson's own date for the unmarked-lesson sweep (which is about one specific
     *     session), and otherwise the date the reward or deduction was recorded. A window
     *     therefore reports "adjustments recorded in this window", which is a fact you can point
     *     at — as opposed to pro-rating a month's adjustments across days, which would invent
     *     money that was never agreed.
     *
     * Amounts are never summed across currencies (§3.6); every figure is grouped per currency, and
     * a teacher paid in two currencies appears once per currency.
     *
     * Owner-only (`payout.read`). A teacher's own view stays the monthly statement list, because
     * what they are owed is settled per statement, not per arbitrary window.
     */
    public function range(Request $request): JsonResponse
    {
        Gate::authorize('payout.read');

        $validated = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
        ]);

        $from = (string) $validated['from'];
        $to = (string) $validated['to'];

        // Lessons: one row per (teacher, currency). `duration_minutes` comes off the session so the
        // window can report hours taught, which is the figure an owner checks a salary against.
        $lessons = DB::table('payout_line_items as li')
            ->join('payouts as p', 'p.id', '=', 'li.payout_id')
            ->leftJoin('teachers as t', 't.id', '=', 'p.teacher_id')
            ->leftJoin('sessions as se', 'se.id', '=', 'li.session_id')
            ->whereBetween('li.session_date', [$from, $to])
            ->groupBy('p.teacher_id', 't.full_name', 'li.currency')
            ->select([
                'p.teacher_id',
                'li.currency',
                DB::raw('t.full_name as teacher_name'),
                DB::raw('count(*) as sessions'),
                DB::raw('coalesce(sum(se.duration_minutes), 0) as minutes'),
                DB::raw('coalesce(sum(li.amount_minor), 0) as lessons_minor'),
                DB::raw('bool_or(p.finalized_at is null) as has_open'),
            ])
            ->get();

        // Adjustments, anchored as described above. The academy timezone converts the sweep's
        // session instant to the same local date the line items were stamped with.
        $adjustments = DB::table('payout_adjustments as adj')
            ->join('payouts as p', 'p.id', '=', 'adj.payout_id')
            ->join('academies as a', 'a.id', '=', 'adj.academy_id')
            ->leftJoin('sessions as se', 'se.id', '=', 'adj.session_id')
            ->whereRaw(
                'coalesce((se.scheduled_at_utc at time zone a.timezone)::date, adj.created_at::date) between ?::date and ?::date',
                [$from, $to],
            )
            ->groupBy('p.teacher_id', 'adj.currency', 'adj.type')
            ->select([
                'p.teacher_id',
                'adj.currency',
                'adj.type',
                DB::raw('coalesce(sum(adj.amount_minor), 0) as amount_minor'),
            ])
            ->get();

        /** @var array<string, array<string,mixed>> $rows keyed by "teacherId|CUR" */
        $rows = [];

        $key = static fn (?string $teacherId, string $currency): string => ($teacherId ?? '—').'|'.$currency;

        foreach ($lessons as $row) {
            $rows[$key($row->teacher_id, (string) $row->currency)] = [
                'teacher_id' => (string) $row->teacher_id,
                'teacher_name' => $row->teacher_name !== null ? (string) $row->teacher_name : null,
                'currency' => (string) $row->currency,
                'sessions' => (int) $row->sessions,
                'minutes' => (int) $row->minutes,
                'lessons_minor' => (int) $row->lessons_minor,
                'rewards_minor' => 0,
                'deductions_minor' => 0,
                'has_open' => (bool) $row->has_open,
            ];
        }

        foreach ($adjustments as $row) {
            $k = $key($row->teacher_id, (string) $row->currency);

            // A teacher can have an adjustment in the window with no lessons in it (a deduction
            // recorded after their last class, say) — they still belong on the list.
            $rows[$k] ??= [
                'teacher_id' => (string) $row->teacher_id,
                'teacher_name' => (string) DB::table('teachers')->where('id', $row->teacher_id)->value('full_name'),
                'currency' => (string) $row->currency,
                'sessions' => 0,
                'minutes' => 0,
                'lessons_minor' => 0,
                'rewards_minor' => 0,
                'deductions_minor' => 0,
                'has_open' => false,
            ];

            $field = $row->type === 'REWARD' ? 'rewards_minor' : 'deductions_minor';
            $rows[$k][$field] += (int) $row->amount_minor;
        }

        $teachers = array_values(array_map(static function (array $row): array {
            $row['net_minor'] = $row['lessons_minor'] + $row['rewards_minor'] - $row['deductions_minor'];

            return $row;
        }, $rows));

        // Biggest salary first — the list is read to check the payroll bill, not alphabetically.
        usort($teachers, static fn (array $a, array $b): int => $b['net_minor'] <=> $a['net_minor']);

        $currencies = [];
        foreach ($teachers as $row) {
            $cur = $row['currency'];
            $currencies[$cur] ??= [
                'currency' => $cur,
                'teachers' => 0,
                'sessions' => 0,
                'minutes' => 0,
                'lessons_minor' => 0,
                'rewards_minor' => 0,
                'deductions_minor' => 0,
                'net_minor' => 0,
            ];
            $currencies[$cur]['teachers']++;
            foreach (['sessions', 'minutes', 'lessons_minor', 'rewards_minor', 'deductions_minor', 'net_minor'] as $field) {
                $currencies[$cur][$field] += $row[$field];
            }
        }

        return response()->json([
            'from' => $from,
            'to' => $to,
            'currencies' => array_values($currencies),
            'teachers' => $teachers,
        ]);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * A `YYYY-MM` or `YYYY-MM-DD` string as the sortable integer `year * 100 + month`, the same
     * key the period sort uses. Anything unparseable collapses to 0 / 999912 at the callers'
     * comparison, which is why the bounds are applied as separate filters rather than a range.
     */
    private static function periodKey(string $value): int
    {
        [$year, $month] = array_pad(array_map('intval', explode('-', $value)), 2, 0);

        return $year * 100 + max(1, min(12, $month));
    }

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
