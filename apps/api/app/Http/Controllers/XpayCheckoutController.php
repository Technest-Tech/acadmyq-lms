<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Xpay\XpayClient;
use App\Services\Xpay\XpayFulfillment;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Public XPay Checkout endpoints — no Sanctum auth required, protected by the invoice's
 * public_token and the same 60 req/min throttle as the invoice view. Sibling of
 * PaypalOrderController; the difference is where the money is confirmed.
 *
 * Flow:
 *   1. POST /api/i/{token}/xpay/session
 *      → Server-side: create an XPay hosted Checkout Session, return its `url`.
 *   2. The payer completes the card payment (incl. 3-D Secure) on XPay's hosted page.
 *   3. XPay POSTs `checkout.session.completed` to /api/webhooks/xpay/{academy} → invoice PAID.
 *      That webhook is the SOURCE OF TRUTH (docs.xpay.app is explicit: the redirect is not
 *      confirmation — the payer can close the tab before it ever fires).
 *   4. GET /api/i/{token}/xpay/session/{id}
 *      → The return page's fallback: re-read the session and settle it if XPay says it is paid.
 *        This is what keeps the flow working for a client who never configured their webhook
 *        endpoint. Both paths converge on XpayFulfillment, so they cannot disagree.
 *
 * Credentials come from app.xpay_config_by_token — a SECURITY DEFINER function owned by the
 * BYPASSRLS role — so this unauthenticated route reads them without a tenant context. The secret
 * key is decrypted in PHP and never leaves the server.
 */
final class XpayCheckoutController extends Controller
{
    public function __construct(
        private readonly XpayClient $xpay,
        private readonly XpayFulfillment $fulfillment,
    ) {}

    /** POST /api/i/{token}/xpay/session — open a hosted checkout for this invoice. */
    public function createSession(string $token): JsonResponse
    {
        $cfg = $this->loadConfig($token);

        if (! in_array($cfg['status'], ['OPEN', 'CLOSED'], true)) {
            abort(409, 'Invoice is not in a payable state.');
        }

        $amountMinor = (int) $cfg['total_minor'];
        if ($amountMinor <= 0) {
            abort(422, 'This invoice has nothing left to pay.');
        }

        $frontend = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');
        $invoiceUrl = $frontend.'/i/'.$token;

        $session = $this->xpay->createCheckoutSession(
            $cfg['secret_key'],
            [
                'mode' => 'payment',
                'uiMode' => 'hosted',
                'submitType' => 'PAY',
                'currency' => strtoupper((string) $cfg['currency']),
                'lineItems' => [[
                    // An inline price rather than a catalog reference: every invoice is a one-off
                    // amount, so there is nothing to reuse across sessions.
                    'priceData' => [
                        'currency' => strtoupper((string) $cfg['currency']),
                        'unitAmount' => $amountMinor,   // XPay takes minor units, same as total_minor
                        'productData' => [
                            'name' => $this->lineItemName($cfg),
                        ],
                    ],
                    'quantity' => 1,
                ]],
                'afterCompletion' => [
                    'type' => 'redirect',
                    // {CHECKOUT_SESSION_ID} is substituted by XPay before the URL is saved, so the
                    // return page knows which session to confirm without us threading state.
                    'redirect' => ['url' => $invoiceUrl.'?xpay={CHECKOUT_SESSION_ID}'],
                ],
                'cancelUrl' => $invoiceUrl.'?xpay_cancelled=1',
                // The webhook reads invoice_id back off this to find what to settle.
                'metadata' => [
                    'invoice_id' => (string) $cfg['invoice_id'],
                    'academy_id' => (string) $cfg['academy_id'],
                    'public_token' => $token,
                ],
            ],
            // Scoped to the invoice + amount: a double-clicked "Pay now" reuses the same session,
            // but a genuinely new attempt after the amount changed gets a fresh one.
            idempotencyKey: 'inv_'.$cfg['invoice_id'].'_'.$amountMinor,
        );

        $sessionId = (string) ($session['id'] ?? '');
        $url = (string) ($session['url'] ?? '');
        if ($sessionId === '' || $url === '') {
            abort(502, 'XPay did not return a checkout link. Please try again.');
        }

        DB::select('select app.xpay_record_session(?, ?, ?, ?, ?, ?, ?, ?)', [
            $sessionId,
            (string) $cfg['academy_id'],
            (string) $cfg['invoice_id'],
            $amountMinor,
            strtoupper((string) $cfg['currency']),
            (string) ($session['status'] ?? 'open'),
            (string) ($session['paymentStatus'] ?? 'unpaid'),
            $url,
        ]);

        return response()->json(['session_id' => $sessionId, 'url' => $url]);
    }

    /**
     * GET /api/i/{token}/xpay/session/{id} — confirm a returning payer's session.
     *
     * Returns the invoice's settled state either way, so the page can render "paid" even when the
     * webhook got there first (in which case `marked` is false but `paid` is true).
     */
    public function syncSession(string $token, string $id): JsonResponse
    {
        $cfg = $this->loadConfig($token);

        $session = $this->xpay->getCheckoutSession($cfg['secret_key'], $id);

        // The session id comes off a query string the payer can edit, so bind it back to THIS
        // invoice before trusting it — otherwise one academy's paid session could close another's
        // invoice.
        $metaInvoice = (string) ($session['metadata']['invoice_id'] ?? '');
        if ($metaInvoice !== (string) $cfg['invoice_id']) {
            abort(404, 'That payment does not belong to this invoice.');
        }

        $marked = $this->fulfillment->settle(
            $session,
            (string) $cfg['academy_id'],
            (string) $cfg['invoice_id'],
            (int) $cfg['total_minor'],
        );

        $status = DB::selectOne('select app.xpay_invoice_status(?) as s', [(string) $cfg['invoice_id']])?->s
            ?? $cfg['status'];

        return response()->json([
            'paid' => $status === 'PAID',
            'marked' => $marked,
            'payment_status' => (string) ($session['paymentStatus'] ?? 'unpaid'),
            'session_status' => (string) ($session['status'] ?? 'open'),
        ]);
    }

    /**
     * Fetch XPay credentials + invoice details through the SECURITY DEFINER reader and decrypt the
     * secret key. Returns the config with the plaintext key in place of the ciphertext.
     *
     * @return array{invoice_id:string, academy_id:string, academy_name:string, status:string, total_minor:int, currency:string, period_year:int|null, period_month:int|null, secret_key:string, mode:string}
     */
    private function loadConfig(string $token): array
    {
        $raw = DB::selectOne('select app.xpay_config_by_token(?) as cfg', [$token])?->cfg;

        if ($raw === null) {
            abort(404, 'Invoice not found or XPay is not enabled for this academy.');
        }

        $cfg = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        if (empty($cfg['secret_key_enc'])) {
            abort(422, 'XPay is not configured for this academy.');
        }

        try {
            $cfg['secret_key'] = Crypt::decryptString((string) $cfg['secret_key_enc']);
        } catch (\Throwable) {
            // A key encrypted under a rotated APP_KEY is unusable; fail loudly rather than
            // presenting the payer a button that 502s on every press.
            abort(500, 'The stored XPay key could not be read. Please contact support.');
        }

        unset($cfg['secret_key_enc']);

        return $cfg;
    }

    /** What the payer sees as the line on XPay's hosted page: "Al-Noor Academy — March 2026". */
    private function lineItemName(array $cfg): string
    {
        $name = (string) ($cfg['academy_name'] ?? 'Invoice');
        $year = $cfg['period_year'] ?? null;
        $month = $cfg['period_month'] ?? null;

        if ($year !== null && $month !== null) {
            $period = \DateTimeImmutable::createFromFormat('!Y-n', $year.'-'.$month);
            if ($period !== false) {
                return Str::limit($name.' — '.$period->format('F Y'), 250, '');
            }
        }

        return Str::limit($name.' — invoice', 250, '');
    }
}
