<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Finance;

use App\Http\Controllers\Controller;
use App\Services\FinanceLedger;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin → Finance → Payments: every unit of money the owner has received, as one ledger.
 *
 * Recording a payment happens on its deal (DealController::storePayment) because a payment IS
 * money against a deal; this controller is the cross-deal view — "what came in this month", per
 * method, per service — plus the one destructive verb, which lives here so a mistaken entry can
 * be removed from the same list it was noticed on.
 */
final class PaymentController extends Controller
{
    private const SEARCHABLE = ['deal_title', 'client_name', 'reference', 'note'];

    public function __construct(private readonly FinanceLedger $ledger) {}

    /** GET /api/admin/finance/payments — the ledger, newest first, with per-currency sums of the filtered set. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $filters = [
            'method' => fn (Builder $q, $value) => $q->where('method', strtoupper((string) $value)),
            'service' => fn (Builder $q, $value) => $q->where('service', strtoupper((string) $value)),
            'kind' => fn (Builder $q, $value) => $q->where('kind', strtoupper((string) $value)),
            'currency' => fn (Builder $q, $value) => $q->where('currency', strtoupper((string) $value)),
            'client_id' => fn (Builder $q, $value) => $q->where('client_id', (string) $value),
            'deal_id' => fn (Builder $q, $value) => $q->where('deal_id', (string) $value),
            'month' => fn (Builder $q, $value) => $q->where('month', (string) $value),
        ];

        $result = DataTable::paginate($this->ledger->paymentsQuery(), $request, [
            'searchable' => self::SEARCHABLE,
            'sortable' => [
                'paid_on' => 'paid_on',
                'amount_minor' => 'amount_minor',
                'client_name' => 'client_name',
                'deal_title' => 'deal_title',
                'method' => 'method',
                'created_at' => 'created_at',
                'id' => 'id',
            ],
            'filters' => $filters,
            'defaultSort' => '-paid_on,-id',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $row): object => $this->ledger->normalizePayment($row));

        // The sums the screen prints under the table cover the WHOLE filtered set, not the page —
        // "how much came in during March" must not depend on the page size.
        $sums = $this->ledger->paymentsQuery();
        $this->applySameFilters($sums, $request, $filters);
        $result['sums'] = $sums
            ->selectRaw('currency, sum(amount_minor)::bigint as amount_minor, count(*)::int as payments')
            ->groupBy('currency')
            ->orderBy('currency')
            ->get()
            ->map(fn (object $r): array => [
                'currency' => $r->currency,
                'amount_minor' => (int) $r->amount_minor,
                'payments' => (int) $r->payments,
            ])
            ->all();

        return response()->json($result);
    }

    /** DELETE /api/admin/finance/payments/{id} */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $before = DB::table('finance_payments')->where('id', $id)->first();
        if ($before === null) {
            abort(404, 'Payment not found.');
        }

        $dealId = $this->ledger->deletePayment($id);

        $ctx = app(AuthContext::class);
        Audit::log(
            action: 'finance_payment.deleted',
            entityType: 'finance_payment',
            entityId: $id,
            academyId: null,
            actorUserId: $ctx->userId,
            actorRole: $ctx->role,
            before: ['deal_id' => $before->deal_id, 'amount_minor' => (int) $before->amount_minor, 'paid_on' => (string) $before->paid_on],
            after: null,
        );

        return response()->json(['ok' => true, 'deal_id' => $dealId]);
    }

    /**
     * Mirror DataTable's search + filter step onto a second query, so the sums line up with the
     * rows exactly. (The engine keeps those steps private and owns the paging; only the two
     * narrowing steps are repeated here.)
     *
     * @param  array<string,callable(Builder,mixed):mixed>  $filters
     */
    private function applySameFilters(Builder $query, Request $request, array $filters): void
    {
        $term = trim((string) $request->query('search', ''));
        if ($term !== '') {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';
            $query->where(function (Builder $q) use ($like): void {
                foreach (self::SEARCHABLE as $column) {
                    $q->orWhere($column, 'ilike', $like);
                }
            });
        }

        foreach ((array) $request->query('filter', []) as $key => $value) {
            if (isset($filters[$key]) && $value !== null && $value !== '') {
                $filters[$key]($query, $value);
            }
        }
    }
}
