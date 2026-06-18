<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Public PayPal Checkout endpoints — no Sanctum auth required.
 * Protected only by the invoice public_token and rate-limiting.
 *
 * Flow:
 *   1. POST /api/i/{token}/paypal/create-order
 *      → Server-side: get PayPal access token, create PayPal order, return order ID.
 *   2. Student approves the order in the PayPal popup (handled by the JS SDK).
 *   3. POST /api/i/{token}/paypal/capture/{orderId}
 *      → Server-side: capture the approved order, then mark the invoice as PAID
 *        via the same logic as InvoiceController::markPaid().
 *
 * Credentials are fetched via app.paypal_config_by_token — a SECURITY DEFINER
 * function owned by the BYPASSRLS role, so this public route never needs an RLS
 * context to read sensitive fields. The client_secret is never sent to the browser.
 */
final class PaypalOrderController extends Controller
{
    /** POST /api/i/{token}/paypal/create-order */
    public function createOrder(string $token): JsonResponse
    {
        $cfg = $this->loadConfig($token);

        $accessToken = $this->getAccessToken($cfg);

        $amountDecimal = number_format($cfg['total_minor'] / 100, 2, '.', '');

        $response = Http::withToken($accessToken)
            ->post("{$cfg['base_url']}/v2/checkout/orders", [
                'intent' => 'CAPTURE',
                'purchase_units' => [[
                    'amount' => [
                        'currency_code' => strtoupper($cfg['currency']),
                        'value'         => $amountDecimal,
                    ],
                ]],
                'payment_source' => [
                    'paypal' => [
                        'experience_context' => [
                            'payment_method_preference' => 'IMMEDIATE_PAYMENT_REQUIRED',
                            'user_action'               => 'PAY_NOW',
                        ],
                    ],
                ],
            ]);

        if (! $response->successful()) {
            Log::warning('PayPal create-order failed', [
                'status' => $response->status(),
                'body'   => $response->body(),
            ]);
            abort(502, 'Could not create PayPal order. Please try again.');
        }

        return response()->json(['order_id' => $response->json('id')]);
    }

    /** POST /api/i/{token}/paypal/capture/{orderId} */
    public function captureOrder(string $token, string $orderId): JsonResponse
    {
        $cfg = $this->loadConfig($token);

        if ($cfg['status'] !== 'CLOSED' && $cfg['status'] !== 'OPEN') {
            abort(409, 'Invoice is not in a payable state.');
        }

        $accessToken = $this->getAccessToken($cfg);

        $response = Http::withToken($accessToken)
            ->post("{$cfg['base_url']}/v2/checkout/orders/{$orderId}/capture");

        if (! $response->successful()) {
            Log::warning('PayPal capture-order failed', [
                'order_id' => $orderId,
                'status'   => $response->status(),
                'body'     => $response->body(),
            ]);
            abort(502, 'Payment capture failed. Please contact support.');
        }

        $captureStatus = $response->json('status');
        if ($captureStatus !== 'COMPLETED') {
            abort(402, 'Payment was not completed.');
        }

        // Mark invoice PAID via app.paypal_mark_invoice_paid — a SECURITY DEFINER
        // function owned by the BYPASSRLS role, the only safe way to write to an
        // RLS-protected table from a public (unauthenticated) route.
        $invoiceId = $cfg['invoice_id'];
        $marked = DB::selectOne(
            'select app.paypal_mark_invoice_paid(?, ?) as ok',
            [$invoiceId, $orderId],
        )?->ok;

        if (! $marked) {
            abort(409, 'Invoice could not be marked paid. It may already be in a terminal state.');
        }

        return response()->json(['ok' => true, 'paypal_order_id' => $orderId]);
    }

    /**
     * Fetch PayPal credentials + invoice details from the SECURITY DEFINER function.
     *
     * @return array{invoice_id:string, status:string, total_minor:int, currency:string, client_id:string, client_secret:string, mode:string, base_url:string}
     */
    private function loadConfig(string $token): array
    {
        $rows = DB::select('select app.paypal_config_by_token(?) as cfg', [$token]);
        $raw  = $rows[0]->cfg ?? null;

        if ($raw === null) {
            abort(404, 'Invoice not found or PayPal not configured.');
        }

        $cfg = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        if (empty($cfg['client_id']) || empty($cfg['client_secret'])) {
            abort(422, 'PayPal is not configured for this academy.');
        }

        $cfg['base_url'] = ($cfg['mode'] ?? 'live') === 'sandbox'
            ? 'https://api-m.sandbox.paypal.com'
            : 'https://api-m.paypal.com';

        return $cfg;
    }

    /** Exchange client_id + client_secret for a short-lived access token. */
    private function getAccessToken(array $cfg): string
    {
        $response = Http::withBasicAuth($cfg['client_id'], $cfg['client_secret'])
            ->asForm()
            ->post("{$cfg['base_url']}/v1/oauth2/token", [
                'grant_type' => 'client_credentials',
            ]);

        if (! $response->successful()) {
            Log::warning('PayPal access-token request failed', [
                'status' => $response->status(),
            ]);
            abort(502, 'Could not authenticate with PayPal.');
        }

        return $response->json('access_token');
    }
}
