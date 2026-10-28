<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\People\FamilyPayController;
use App\Services\Xpay\XpayClient;
use App\Services\Xpay\XpayFulfillment;
use App\Support\AcademyUrl;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * One card payment for a family's whole dues — the family page's (`/f/{token}`) sibling of
 * XpayCheckoutController, which pays one bill.
 *
 * Flow:
 *   1. POST /api/f/{token}/xpay/session  {currency?}
 *      → every due bill of the family in that currency (exactly the ones the page lists, through
 *        FamilyPayController::dueQuery), their total, ONE hosted checkout for it. What each bill
 *        owed is written beside the session, so settling never relies on the gateway's payload.
 *   2. The parent pays on XPay's page and comes back to `/f/{token}?xpay=cs_…`.
 *   3. The `checkout.session.completed` webhook (source of truth) or this return page's sync
 *      settles it through XpayFulfillment::settleFamily: each covered bill is marked paid on its
 *      own, so a package is still closed by its own money.
 *
 * The family link is the credential (48 random chars); it is resolved through
 * app.family_pay_lookup and everything after runs under RLS as that academy. The secret key comes
 * from the definer reader and never leaves the server.
 */
final class FamilyXpayController extends Controller
{
    public function __construct(
        private readonly XpayClient $xpay,
        private readonly XpayFulfillment $fulfillment,
    ) {}

    /** POST /api/f/{token}/xpay/session — open one hosted checkout for the family's dues. */
    public function createSession(Request $request, string $token): JsonResponse
    {
        [$guardianId, $academyId] = $this->family($token);
        $ctx = $this->ctx($academyId);

        [$active, $bills, $academyName] = Tenancy::withContext($ctx, fn (): array => [
            DB::table('academy_payment_settings')->where('method', 'XPAY')->where('is_active', true)->exists(),
            FamilyPayController::dueQuery($guardianId)
                ->get(['i.id as invoice_id', 'i.currency', DB::raw('(i.total_minor - i.amount_paid_minor) as due_minor')])
                // Two packages can share one bill (an overdraft rolled onto the next block's bill).
                ->unique('invoice_id')
                ->values(),
            (string) DB::table('academies')->where('id', $academyId)->value('name'),
        ]);
        if (! $active) {
            abort(422, 'Card payment is not enabled for this academy.');
        }

        $currencies = $bills->pluck('currency')->unique()->values();
        $currency = strtoupper((string) $request->input('currency', $currencies->count() === 1 ? $currencies->first() : ''));
        $bills = $bills->where('currency', $currency)->values();
        if ($currency === '' || $bills->isEmpty()) {
            abort(422, $currencies->count() > 1 ? 'Choose which currency to pay.' : 'There is nothing left to pay.');
        }
        $amountMinor = (int) $bills->sum('due_minor');

        $secret = $this->secretKey($academyId);
        $pageUrl = AcademyUrl::origin($academyId).'/f/'.$token;
        // A new bill or a changed amount is a new attempt; a double-click is the same one.
        $fingerprint = substr(sha1($bills->map(fn ($b) => $b->invoice_id.':'.$b->due_minor)->sort()->implode(',')), 0, 16);

        $session = $this->xpay->createCheckoutSession(
            $secret,
            [
                'mode' => 'payment',
                'uiMode' => 'hosted',
                'submitType' => 'PAY',
                'currency' => $currency,
                'lineItems' => [[
                    'priceData' => [
                        'currency' => $currency,
                        'unitAmount' => XpayClient::toGatewayMinor($amountMinor, $currency),
                        'productData' => [
                            'name' => Str::limit($academyName.' — '.$bills->count().' bills', 250, ''),
                        ],
                    ],
                    'quantity' => 1,
                ]],
                'afterCompletion' => [
                    'type' => 'redirect',
                    'redirect' => ['url' => $pageUrl.'?xpay={CHECKOUT_SESSION_ID}'],
                ],
                'cancelUrl' => $pageUrl.'?xpay_cancelled=1',
                // The webhook routes on `kind` and checks the family against our own session row.
                'metadata' => [
                    'kind' => 'family',
                    'guardian_id' => $guardianId,
                    'academy_id' => $academyId,
                ],
            ],
            idempotencyKey: 'fam_'.$guardianId.'_'.$amountMinor.'_'.$fingerprint,
        );

        $sessionId = (string) ($session['id'] ?? '');
        $url = (string) ($session['url'] ?? '');
        if ($sessionId === '' || $url === '') {
            abort(502, 'XPay did not return a checkout link. Please try again.');
        }

        Tenancy::withContext($ctx, function () use ($sessionId, $academyId, $guardianId, $amountMinor, $currency, $session, $url, $bills): void {
            $now = now()->toIso8601String();
            DB::table('xpay_checkout_sessions')->upsert([[
                'id' => $sessionId,
                'academy_id' => $academyId,
                'invoice_id' => null,
                'guardian_id' => $guardianId,
                'amount_minor' => $amountMinor,
                'currency' => $currency,
                'status' => (string) ($session['status'] ?? 'open'),
                'payment_status' => (string) ($session['paymentStatus'] ?? 'unpaid'),
                'url' => $url,
                'created_at' => $now,
                'updated_at' => $now,
            ]], ['id'], ['status', 'payment_status', 'url', 'updated_at']);
            DB::table('xpay_checkout_session_invoices')->insertOrIgnore($bills->map(fn ($b): array => [
                'session_id' => $sessionId,
                'academy_id' => $academyId,
                'invoice_id' => $b->invoice_id,
                'amount_minor' => (int) $b->due_minor,
            ])->all());
        });

        return response()->json(['session_id' => $sessionId, 'url' => $url, 'amount_minor' => $amountMinor, 'currency' => $currency]);
    }

    /**
     * GET /api/f/{token}/xpay/session/{id} — the return page's confirmation. Reports `paid` once
     * every bill the session covered is PAID, even when the webhook got there first.
     */
    public function syncSession(string $token, string $id): JsonResponse
    {
        [$guardianId, $academyId] = $this->family($token);

        $session = $this->xpay->getCheckoutSession($this->secretKey($academyId), $id);

        // The id comes off a query string the payer can edit: bind it to THIS family first.
        $meta = (array) ($session['metadata'] ?? []);
        if (($meta['kind'] ?? null) !== 'family' || (string) ($meta['guardian_id'] ?? '') !== $guardianId) {
            abort(404, 'That payment does not belong to this family.');
        }

        $marked = $this->fulfillment->settleFamily($session, $academyId, $guardianId);
        if ($marked === null) {
            abort(404, 'That payment does not belong to this family.');
        }

        $unpaid = Tenancy::withContext($this->ctx($academyId), fn (): int => DB::table('xpay_checkout_session_invoices as si')
            ->join('invoices as i', 'i.id', '=', 'si.invoice_id')
            ->where('si.session_id', $id)
            ->where('i.status', '<>', 'PAID')
            ->count());

        return response()->json([
            'paid' => $unpaid === 0 && XpayFulfillment::isPaid($session),
            'marked' => $marked,
            'payment_status' => (string) ($session['paymentStatus'] ?? 'unpaid'),
            'session_status' => (string) ($session['status'] ?? 'open'),
        ]);
    }

    /** @return array{0: string, 1: string} [guardianId, academyId]; every miss is the same 404 */
    private function family(string $token): array
    {
        $row = DB::selectOne('select guardian_id, academy_id from app.family_pay_lookup(?)', [$token]);
        if ($row === null) {
            abort(404, 'Page not found.');
        }

        return [(string) $row->guardian_id, (string) $row->academy_id];
    }

    private function ctx(string $academyId): AuthContext
    {
        return new AuthContext(userId: '', academyId: $academyId, role: 'GUARDIAN', permissions: []);
    }

    /** The active mode's secret key, decrypted — the same reader the webhook uses. */
    private function secretKey(string $academyId): string
    {
        $raw = DB::selectOne('select app.xpay_credentials_for_academy(?) as cfg', [$academyId])?->cfg;
        $cfg = is_string($raw) ? json_decode($raw, true) : (array) $raw;
        if (empty($cfg['secret_key_enc'])) {
            abort(422, 'XPay is not configured for this academy.');
        }

        try {
            return Crypt::decryptString((string) $cfg['secret_key_enc']);
        } catch (\Throwable) {
            abort(500, 'The stored XPay key could not be read. Please contact support.');
        }
    }
}
