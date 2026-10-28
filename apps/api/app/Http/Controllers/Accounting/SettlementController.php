<?php

declare(strict_types=1);

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\Controller;
use App\Services\Ledger;
use App\Services\PackageSettlement;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * A prepaid subscription's unused money, and a family's credit paid back (App\Services\PackageSettlement):
 *
 *   GET  /packages/{id}/settlement             what is left of the block, what was paid, what comes back
 *   POST /packages/{id}/settle                 { mode: CREDIT|REFUND|KEEP, cash_account_id?, note? }
 *   POST /accounting/family/{guardianId}/refund { amount_minor, currency, cash_account_id, note? }
 *
 * Closing or cancelling a block can settle it in the same step ({@see self::settleAfterClose()}).
 * Money moves on invoice.mark_paid; paying it out of the treasury also takes expense.manage.
 */
final class SettlementController extends Controller
{
    public function __construct(private readonly PackageSettlement $settlement) {}

    public function show(string $id): JsonResponse
    {
        Gate::authorize('package.read');
        Gate::authorize('invoice.read');
        $package = DB::table('lesson_packages')->where('id', $id)->first();
        if ($package === null) {
            abort(404, 'Package not found.');
        }
        $preview = $this->settlement->preview($package);
        $settled = in_array($package->settlement, PackageSettlement::MODES, true);

        return response()->json([
            'preview' => $preview,
            'settled' => $settled ? [
                'mode' => (string) $package->settlement,
                'amount_minor' => (int) $package->settled_minor,
                'currency' => (string) $package->currency,
                'on' => Carbon::parse($package->settled_at)->format('Y-m-d'),
                'note' => $package->settle_note,
                'by' => $package->settled_by !== null ? DB::table('users')->where('id', $package->settled_by)->value('full_name') : null,
                'expense_number' => $package->settle_expense_id !== null ? DB::table('expenses')->where('id', $package->settle_expense_id)->value('number') : null,
            ] : null,
            'accounts' => Gate::allows('expense.manage') ? $this->settlement->accounts((string) $package->currency) : [],
            'can_settle' => Gate::allows('package.manage') && Gate::allows('invoice.mark_paid'),
            'can_refund' => Gate::allows('expense.manage'),
        ]);
    }

    public function settle(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');
        $data = $request->validate(self::rules());
        self::authorizeMode($data['mode']);
        $ctx = app(AuthContext::class);

        return response()->json($this->settlement->settle($id, $data['mode'], $data['cash_account_id'] ?? null, $data['note'] ?? null, $ctx->userId, $ctx->role));
    }

    public function refund(Request $request, string $guardianId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        Gate::authorize('expense.manage');
        $data = $request->validate([
            'amount_minor' => ['required', 'integer', 'min:1', 'max:100000000000'],
            'currency' => ['required', 'string', 'size:3'],
            'cash_account_id' => ['required', 'uuid'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $ctx = app(AuthContext::class);
        $academyId = (string) $ctx->academyId;
        $payer = app(Ledger::class)->resolvePayer($academyId, $guardianId, null);
        $note = isset($data['note']) && trim((string) $data['note']) !== '' ? trim((string) $data['note']) : 'Credit paid back / رد رصيد';

        return response()->json($this->settlement->refundCredit($academyId, $payer, (int) $data['amount_minor'], strtoupper((string) $data['currency']),
            (string) $data['cash_account_id'], $note, $ctx->userId, $ctx->role), 201);
    }

    /**
     * Closing (or cancelling) a block with `settlement: {mode, cash_account_id?, note?}` settles it
     * in the same step — called by LessonPackageController inside its transaction, after the close.
     *
     * @return array<string, mixed>|null
     */
    public static function settleAfterClose(Request $request, string $packageId): ?array
    {
        if (! $request->has('settlement.mode')) {
            return null;
        }
        $data = $request->validate(self::rules('settlement.'))['settlement'];
        self::authorizeMode($data['mode']);
        $ctx = app(AuthContext::class);

        return app(PackageSettlement::class)->settle($packageId, $data['mode'], $data['cash_account_id'] ?? null, $data['note'] ?? null, $ctx->userId, $ctx->role);
    }

    /** @return array<string, list<mixed>> */
    private static function rules(string $prefix = ''): array
    {
        return [
            "{$prefix}mode" => ['required', Rule::in(PackageSettlement::MODES)],
            "{$prefix}cash_account_id" => ['nullable', 'uuid', "required_if:{$prefix}mode,REFUND"],
            "{$prefix}note" => ['nullable', 'string', 'max:500'],
        ];
    }

    private static function authorizeMode(string $mode): void
    {
        Gate::authorize('invoice.mark_paid');
        if ($mode === 'REFUND') {
            Gate::authorize('expense.manage');
        }
    }
}
