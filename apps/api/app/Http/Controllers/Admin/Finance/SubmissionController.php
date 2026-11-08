<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Finance;

use App\Http\Controllers\Controller;
use App\Services\FinanceLedger;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Super Admin → Accounts → payment proofs: a transfer screenshot a client uploaded from its pay
 * link. Approving it is "money received from this client" — the same entry a hand-typed payment
 * makes (FinanceLedger::receiveFromClient), so it pays the oldest dues first and renews the
 * subscription. The reviewer confirms the amount (the client may have typed none, or a wrong one).
 */
final class SubmissionController extends Controller
{
    /** Proof methods → the book's payment methods. */
    private const METHOD = ['INSTAPAY' => 'INSTAPAY', 'VODAFONE_CASH' => 'VODAFONE_CASH'];

    public function __construct(private readonly FinanceLedger $ledger) {}

    /** GET /api/admin/finance/submissions/{id}/screenshot — the private file. */
    public function screenshot(string $id): StreamedResponse
    {
        Gate::authorize('platform.manage');

        $path = DB::table('finance_payment_submissions')->where('id', $id)->value('screenshot_path');
        if ($path === null || ! Storage::disk('local')->exists((string) $path)) {
            abort(404, 'Screenshot not found.');
        }

        return Storage::disk('local')->response((string) $path);
    }

    /** POST /api/admin/finance/submissions/{id}/approve — {amount_minor, paid_on?} */
    public function approve(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $request->validate([
            'amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'paid_on' => ['nullable', 'date_format:Y-m-d'],
            'currency' => ['nullable', Rule::in(FinanceLedger::CURRENCIES)],
        ]);

        $sub = DB::table('finance_payment_submissions')->where('id', $id)->first();
        if ($sub === null) {
            abort(404, 'Proof not found.');
        }
        if ($sub->status !== 'PENDING') {
            abort(409, 'This proof was already reviewed.');
        }

        DB::transaction(function () use ($sub, $data): void {
            $this->ledger->receiveFromClient((string) $sub->client_id, (string) ($data['currency'] ?? $sub->currency), [
                'paid_on' => $data['paid_on'] ?? substr((string) $sub->created_at, 0, 10),
                'amount_minor' => (int) $data['amount_minor'],
                'method' => self::METHOD[$sub->method] ?? 'OTHER',
                'reference' => null,
                'note' => $sub->note,
                'submission_id' => (string) $sub->id,
            ]);
            DB::table('finance_payment_submissions')->where('id', $sub->id)->update([
                'status' => 'APPROVED',
                'amount_minor' => (int) $data['amount_minor'],
                'reviewed_at' => DB::raw('now()'),
            ]);
        });
        $this->audit('finance_proof.approved', (string) $sub->id, ['amount_minor' => (int) $data['amount_minor']]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/admin/finance/submissions/{id}/reject */
    public function reject(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $updated = DB::table('finance_payment_submissions')
            ->where('id', $id)
            ->where('status', 'PENDING')
            ->update(['status' => 'REJECTED', 'reviewed_at' => DB::raw('now()')]);
        if ($updated === 0) {
            abort(DB::table('finance_payment_submissions')->where('id', $id)->exists() ? 409 : 404);
        }
        $this->audit('finance_proof.rejected', $id, []);

        return response()->json(['ok' => true]);
    }

    /** @param array<string,mixed> $after */
    private function audit(string $action, string $id, array $after): void
    {
        $ctx = app(AuthContext::class);
        Audit::log(
            action: $action,
            entityType: 'finance_payment_submission',
            entityId: $id,
            academyId: null,
            actorUserId: $ctx->userId,
            actorRole: $ctx->role,
            before: null,
            after: $after,
        );
    }
}
