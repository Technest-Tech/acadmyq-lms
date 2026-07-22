<?php

declare(strict_types=1);

namespace App\Http\Controllers\Quality;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\Payroll;
use App\Support\Audit;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Discounts & Awards — the teacher-first view of `payout_adjustments`.
 *
 * The payroll page already shows rewards/deductions per STATEMENT; this shows them per TEACHER,
 * across statements, next to the machinery that writes them automatically. Same ledger, same DB
 * triggers, same immutability — no second money system.
 *
 * The one thing this endpoint does that the payroll one cannot: it opens the teacher's statement
 * on demand. `POST /api/payouts/{id}/adjustments` needs a payout that already exists, which means
 * a teacher who has accrued nothing this month cannot be rewarded or docked. Here the period is
 * the address, so the statement is created if it isn't there yet.
 *
 * Gated on the existing `payout.read` / `payout.adjust` — an award or a discount IS a payout
 * adjustment, so it must not be reachable by anyone who couldn't already make one.
 */
final class TeacherAdjustmentController extends Controller
{
    use InteractsWithScheduling;

    public function __construct(private readonly Payroll $payroll) {}

    /** GET /api/quality/adjustments — every award/discount in the academy, newest first. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('payout.read');

        $result = DataTable::paginate($this->baseQuery(), $request, [
            'idColumn'   => 'pa.id',
            'searchable' => ['te.full_name', 'pa.reason', 'pa.details'],
            'sortable'   => [
                'created_at' => 'pa.created_at',
                'teacher'    => 'te.full_name',
                'amount'     => 'pa.amount_minor',
            ],
            'filters' => [
                'teacher_id' => fn ($q, $value) => $q->where('p.teacher_id', $value),
                'type'       => fn ($q, $value) => $q->where('pa.type', strtoupper((string) $value)),
                'source'     => fn ($q, $value) => $q->where('pa.source', strtoupper((string) $value)),
                'period'     => function ($q, $value) {
                    [$year, $month] = array_pad(explode('-', (string) $value), 2, null);
                    if ($year !== null && $month !== null) {
                        $q->where('p.period_year', (int) $year)->where('p.period_month', (int) $month);
                    }
                },
            ],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): object => $this->presentRow($r));

        return response()->json($result);
    }

    /**
     * GET /api/quality/adjustments/summary — the page's headline tiles for one period, split by
     * currency (teachers are paid in their own currency and the system never converts).
     */
    public function summary(Request $request): JsonResponse
    {
        Gate::authorize('payout.read');

        $academyId = $this->currentAcademyId();
        $now       = Carbon::now($this->academyTimezone($academyId));
        $year      = (int) $request->integer('year', $now->year);
        $month     = (int) $request->integer('month', $now->month);

        $rows = DB::table('payout_adjustments as pa')
            ->join('payouts as p', 'p.id', '=', 'pa.payout_id')
            ->where('p.period_year', $year)
            ->where('p.period_month', $month)
            ->groupBy('pa.currency', 'pa.type')
            ->select('pa.currency', 'pa.type', DB::raw('sum(pa.amount_minor) as amount_minor'), DB::raw('count(*) as row_count'))
            ->get();

        $byCurrency = [];
        foreach ($rows as $row) {
            $currency = (string) $row->currency;
            $byCurrency[$currency] ??= ['currency' => $currency, 'rewards_minor' => 0, 'deductions_minor' => 0];
            $key = $row->type === 'REWARD' ? 'rewards_minor' : 'deductions_minor';
            $byCurrency[$currency][$key] += (int) $row->amount_minor;
        }

        $autoCount = DB::table('payout_adjustments as pa')
            ->join('payouts as p', 'p.id', '=', 'pa.payout_id')
            ->where('p.period_year', $year)
            ->where('p.period_month', $month)
            ->where('pa.source', 'AUTO_UNREPORTED')
            ->count();

        return response()->json([
            'year'        => $year,
            'month'       => $month,
            'totals'      => array_values($byCurrency),
            'reward_count'    => (int) $rows->where('type', 'REWARD')->sum('row_count'),
            'deduction_count' => (int) $rows->where('type', 'DEDUCTION')->sum('row_count'),
            'auto_count'      => $autoCount,
        ]);
    }

    /**
     * POST /api/quality/teachers/{id}/adjustments — award or dock a teacher for a period.
     *
     * Opens the teacher's statement for the period if it doesn't exist yet, so a teacher with no
     * pay accrued can still be rewarded (or docked) — then delegates to the same
     * {@see Payroll::addAdjustment} the payroll page uses, keeping one code path over the money.
     */
    public function store(Request $request, string $id): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $data = $request->validate([
            'type'         => ['required', Rule::in(['REWARD', 'DEDUCTION'])],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'reason'       => ['required', 'string', 'max:200'],
            'details'      => ['nullable', 'string', 'max:2000'],
            'period_year'  => ['nullable', 'integer', 'min:2000', 'max:2100'],
            'period_month' => ['nullable', 'integer', 'min:1', 'max:12'],
        ]);

        $academyId = $this->currentAcademyId();

        $teacher = DB::table('teachers')->where('id', $id)->first(['id', 'full_name']);
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        $now   = Carbon::now($this->academyTimezone($academyId));
        $year  = isset($data['period_year']) ? (int) $data['period_year'] : (int) $now->year;
        $month = isset($data['period_month']) ? (int) $data['period_month'] : (int) $now->month;

        $payoutId = $this->payroll->ensureOpenPayoutFor($academyId, $id, $year, $month);
        if ($payoutId === null) {
            abort(404, 'Teacher not found.');
        }

        $ctx = $this->ctx();

        // addAdjustment rejects a finalized statement itself (422), so the immutability rule is
        // stated in exactly one place.
        $adjustmentId = $this->payroll->addAdjustment(
            payoutId: $payoutId,
            academyId: $academyId,
            type: $data['type'],
            amountMinor: (int) $data['amount_minor'],
            reason: $data['reason'],
            details: $data['details'] ?? null,
            actorUserId: (string) $ctx->userId,
            actorRole: $ctx->role,
        );

        return response()->json([
            'adjustmentId' => $adjustmentId,
            'payoutId'     => $payoutId,
        ], 201);
    }

    /**
     * DELETE /api/quality/adjustments/{id} — remove a hand-typed award/discount.
     *
     * Only MANUAL rows. The derived ones have an owner elsewhere and deleting them here would be a
     * lie:
     *   • QUALITY — the report is the reason the money moved; withdraw the report and the
     *     deduction cascades with it.
     *   • AUTO_UNREPORTED — the hourly sweep would simply write it again within the hour. {@see
     *     waive} posts a compensating award instead, which survives and shows both sides.
     */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $adjustment = DB::table('payout_adjustments')->where('id', $id)->first();
        if ($adjustment === null) {
            abort(404, 'Adjustment not found.');
        }

        if ($adjustment->source === 'QUALITY') {
            throw ValidationException::withMessages([
                'source' => ['This came from a quality report — delete the report itself to undo it. / نتج هذا عن تقرير جودة — احذف التقرير نفسه للتراجع عنه.'],
            ]);
        }

        if ($adjustment->source === 'AUTO_UNREPORTED') {
            throw ValidationException::withMessages([
                'source' => ['The system applied this automatically and would re-apply it. Waive it instead. / طبّق النظام هذا تلقائيًا وسيعيد تطبيقه. استخدم الإعفاء بدلًا من ذلك.'],
            ]);
        }

        $this->payroll->removeAdjustment($id, $this->currentAcademyId(), (string) $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['ok' => true]);
    }

    /**
     * POST /api/quality/adjustments/{id}/waive — cancel an automatic deduction the honest way.
     *
     * Deleting it cannot work: the sweep that wrote it would write it again within the hour. So the
     * deduction stands and a matching REWARD lands beside it — the statement nets to zero, and both
     * the machine's decision and the human's override stay on the record, which is what a payroll
     * document is for.
     */
    public function waive(Request $request, string $id): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $data = $request->validate([
            'reason' => ['required', 'string', 'max:200'],
        ]);

        $adjustment = DB::table('payout_adjustments')->where('id', $id)->first();
        if ($adjustment === null) {
            abort(404, 'Adjustment not found.');
        }
        if ($adjustment->source !== 'AUTO_UNREPORTED') {
            throw ValidationException::withMessages([
                'source' => ['Only an automatic deduction can be waived.'],
            ]);
        }
        if ($adjustment->type !== 'DEDUCTION') {
            throw ValidationException::withMessages(['type' => ['Only a deduction can be waived.']]);
        }

        $academyId = $this->currentAcademyId();

        // One waiver per deduction: a second click must not pay the teacher twice.
        $already = DB::table('payout_adjustments')
            ->where('payout_id', $adjustment->payout_id)
            ->where('session_id', $adjustment->session_id)
            ->where('source', 'MANUAL')
            ->where('type', 'REWARD')
            ->exists();

        if ($already) {
            throw ValidationException::withMessages([
                'waive' => ['This deduction has already been waived.'],
            ]);
        }

        $ctx = $this->ctx();

        $rewardId = $this->payroll->addAdjustment(
            payoutId: (string) $adjustment->payout_id,
            academyId: $academyId,
            type: 'REWARD',
            amountMinor: (int) $adjustment->amount_minor,
            reason: $data['reason'],
            details: 'Waives the automatic deduction for the unmarked lesson.',
            actorUserId: (string) $ctx->userId,
            actorRole: $ctx->role,
        );

        // The waiver carries the session so the pair renders side by side.
        DB::table('payout_adjustments')->where('id', $rewardId)->update([
            'session_id' => $adjustment->session_id,
            'updated_at' => now(),
        ]);

        Audit::log(
            'payout.auto_deduct_waived',
            'payout',
            (string) $adjustment->payout_id,
            $academyId,
            $ctx->userId,
            $ctx->role,
            after: [
                'deduction_id' => $id,
                'reward_id'    => $rewardId,
                'amount_minor' => (int) $adjustment->amount_minor,
                'reason'       => $data['reason'],
            ],
        );

        return response()->json(['rewardId' => $rewardId], 201);
    }

    // -------------------------------------------------------------------------
    // Auto-deduction policy
    // -------------------------------------------------------------------------

    /** GET /api/quality/settings — the academy's auto-deduction policy (defaults when unset). */
    public function settings(): JsonResponse
    {
        Gate::authorize('payout.read');

        return response()->json(['settings' => $this->settingsRow($this->currentAcademyId())]);
    }

    /**
     * PUT /api/quality/settings — set the auto-deduction policy.
     *
     * Gated on `teacher_quality.manage`, not `payout.adjust`: this is not one adjustment, it is
     * standing permission for the system to dock every teacher without a human in the loop.
     */
    public function updateSettings(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $data = $request->validate([
            'auto_deduct_enabled'      => ['required', 'boolean'],
            'auto_deduct_grace_hours'  => ['required', 'integer', 'min:1', 'max:168'],
            'auto_deduct_basis'        => ['required', Rule::in(['FIXED', 'PERCENT_SESSION'])],
            'auto_deduct_amount_minor' => ['required', 'integer', 'min:0'],
            'auto_deduct_percent'      => ['required', 'numeric', 'min:0', 'max:100'],
        ]);

        $academyId = $this->currentAcademyId();
        $before    = $this->settingsRow($academyId);

        // The wire speaks percent; the column stores integer basis points, because this number
        // multiplies a teacher's pay (AC-1.10 — no float anywhere in the money path).
        $row = $data;
        $row['auto_deduct_bp'] = (int) round(((float) $data['auto_deduct_percent']) * 100);
        unset($row['auto_deduct_percent']);

        DB::table('teacher_quality_settings')->updateOrInsert(
            ['academy_id' => $academyId],
            $row + ['id' => (string) Str::uuid(), 'updated_at' => now()],
        );

        Audit::log(
            'teacher_quality.settings_updated',
            'academy',
            $academyId,
            $academyId,
            $this->ctx()->userId,
            $this->ctx()->role,
            before: $before,
            after: $data,
        );

        return response()->json(['settings' => $this->settingsRow($academyId)]);
    }

    // -------------------------------------------------------------------------
    // Teacher self-service
    // -------------------------------------------------------------------------

    /**
     * GET /api/me/adjustments — the calling teacher's own awards and discounts.
     *
     * Self-scoped on the teacher row, exactly like `/api/me/payouts`: RLS pins the academy, not the
     * person, so without this filter a teacher would read the whole staff room's pay.
     */
    public function mine(Request $request): JsonResponse
    {
        Gate::authorize('payout.read_own');

        $teacherId = $this->callerTeacherId();
        if ($teacherId === null) {
            return response()->json(['rows' => [], 'total' => 0, 'page' => 1, 'pageSize' => 0]);
        }

        $result = DataTable::paginate($this->baseQuery()->where('p.teacher_id', $teacherId), $request, [
            'idColumn'    => 'pa.id',
            'sortable'    => ['created_at' => 'pa.created_at'],
            'filters'     => [
                'type'   => fn ($q, $value) => $q->where('pa.type', strtoupper((string) $value)),
                'source' => fn ($q, $value) => $q->where('pa.source', strtoupper((string) $value)),
            ],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): object => $this->presentRow($r));

        return response()->json($result);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private function baseQuery(): \Illuminate\Database\Query\Builder
    {
        return DB::table('payout_adjustments as pa')
            ->join('payouts as p', 'p.id', '=', 'pa.payout_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'p.teacher_id')
            ->leftJoin('users as u', 'u.id', '=', 'pa.created_by')
            ->leftJoin('sessions as se', 'se.id', '=', 'pa.session_id')
            ->select([
                'pa.id', 'pa.type', 'pa.source', 'pa.amount_minor', 'pa.currency',
                'pa.reason', 'pa.details', 'pa.session_id', 'pa.quality_report_id', 'pa.created_at',
                'p.id as payout_id', 'p.teacher_id', 'p.period_year', 'p.period_month', 'p.finalized_at',
                'te.full_name as teacher_name',
                'u.full_name as author_name',
                'se.scheduled_at_utc',
            ]);
    }

    private function presentRow(object $r): object
    {
        $timezone = $this->academyTimezone($this->currentAcademyId());

        $r->id           = (string) $r->id;
        $r->payout_id    = (string) $r->payout_id;
        $r->teacher_id   = (string) $r->teacher_id;
        $r->amount_minor = (int) $r->amount_minor;
        $r->period_year  = (int) $r->period_year;
        $r->period_month = (int) $r->period_month;
        $r->finalized    = $r->finalized_at !== null;
        $r->created_at   = Carbon::parse($r->created_at)->utc()->toIso8601String();

        // The lesson a system row is about, in the academy's own clock — the UI states the reason
        // in the reader's language and needs the date, not a parsed string.
        $r->session_local = $r->scheduled_at_utc !== null
            ? Carbon::parse($r->scheduled_at_utc)->setTimezone($timezone)->format('Y-m-d H:i')
            : null;

        unset($r->finalized_at, $r->scheduled_at_utc);

        return $r;
    }

    /** @return array<string, mixed> the policy row, or the defaults an unconfigured academy has. */
    private function settingsRow(string $academyId): array
    {
        $row = DB::table('teacher_quality_settings')->where('academy_id', $academyId)->first();

        if ($row === null) {
            return [
                'auto_deduct_enabled'      => false,
                'auto_deduct_grace_hours'  => 6,
                'auto_deduct_basis'        => 'FIXED',
                'auto_deduct_amount_minor' => 0,
                'auto_deduct_percent'      => 0.0,
            ];
        }

        return [
            'auto_deduct_enabled'      => (bool) $row->auto_deduct_enabled,
            'auto_deduct_grace_hours'  => (int) $row->auto_deduct_grace_hours,
            'auto_deduct_basis'        => (string) $row->auto_deduct_basis,
            'auto_deduct_amount_minor' => (int) $row->auto_deduct_amount_minor,
            'auto_deduct_percent'      => ((int) $row->auto_deduct_bp) / 100,
        ];
    }
}
