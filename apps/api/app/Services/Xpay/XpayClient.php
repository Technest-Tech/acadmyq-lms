<?php

declare(strict_types=1);

namespace App\Services\Xpay;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The one seam to XPay's REST API (docs.xpay.app). Everything the platform sends to XPay goes
 * through here so the base URL, timeouts, idempotency and "never log a key" rule live in one place.
 *
 * Two things about XPay's shape drive this class:
 *
 *  - ONE base URL. There is no separate sandbox host: `https://api.xpay.app` serves both, and the
 *    key prefix (`sk_test_*` vs `sk_live_*`) decides which world the call lands in. That is why no
 *    method here takes a mode — the caller passes a secret key and the key IS the mode.
 *  - PER-ACADEMY credentials. Each client has its own merchant account, so the secret is an argument
 *    on every call rather than config. Nothing here is cached between academies.
 */
final class XpayClient
{
    /** Single host for both test and live; the sk_ prefix selects the environment. */
    private const BASE_URL = 'https://api.xpay.app';

    /** XPay wants a 2xx back within 30s on webhooks; outbound we are far stricter than that. */
    private const TIMEOUT_SECONDS = 15;

    /**
     * Create a hosted Checkout Session and return the decoded object (its `url` is where the payer
     * goes next). `$idempotencyKey` makes a retried create resolve to the same session instead of
     * opening a second one — see docs.xpay.app/en/integrate/idempotency.
     *
     * @param  array<string,mixed>  $payload
     * @return array<string,mixed>
     */
    public function createCheckoutSession(string $secretKey, array $payload, string $idempotencyKey): array
    {
        $response = $this->request($secretKey)
            ->withHeaders(['Idempotency-Key' => $idempotencyKey])
            ->post(self::BASE_URL.'/checkout/sessions', $payload);

        if (! $response->successful()) {
            $this->logFailure('create-session', $response->status(), $response->body());
            abort(502, 'Could not start the card payment. Please try again.');
        }

        return (array) $response->json();
    }

    /**
     * Re-read a Checkout Session. The response is byte-identical in shape to the `data.object` of a
     * `checkout.session.completed` webhook, which is what lets the return page confirm a payment
     * without the webhook having arrived (or having been configured at all).
     *
     * @return array<string,mixed>
     */
    public function getCheckoutSession(string $secretKey, string $sessionId): array
    {
        $response = $this->request($secretKey)
            ->get(self::BASE_URL.'/checkout/sessions/'.rawurlencode($sessionId));

        if (! $response->successful()) {
            $this->logFailure('get-session', $response->status(), $response->body());
            abort(502, 'Could not confirm the payment with XPay. Please try again.');
        }

        return (array) $response->json();
    }

    /**
     * Cheapest authenticated call we can make, used by the Super Admin's "Test connection" button so
     * a wrong or rolled key is caught at provisioning time rather than by the first real payer.
     *
     * Returns a plain result rather than aborting: a bad key is the expected answer here, not a
     * server error.
     *
     * @return array{ok:bool, status:int|null, message:string}
     */
    public function ping(string $secretKey): array
    {
        try {
            $response = $this->request($secretKey)->get(self::BASE_URL.'/customers', ['limit' => 1]);
        } catch (ConnectionException $e) {
            return ['ok' => false, 'status' => null, 'message' => 'Could not reach XPay: '.$e->getMessage()];
        }

        if ($response->successful()) {
            return ['ok' => true, 'status' => $response->status(), 'message' => 'Connected to XPay.'];
        }

        $this->logFailure('ping', $response->status(), $response->body());

        return [
            'ok' => false,
            'status' => $response->status(),
            'message' => $response->status() === 401
                ? 'XPay rejected this secret key.'
                : 'XPay returned '.$response->status().'.',
        ];
    }

    private function request(string $secretKey): \Illuminate\Http\Client\PendingRequest
    {
        return Http::withToken($secretKey)
            ->acceptJson()
            ->asJson()
            ->timeout(self::TIMEOUT_SECONDS);
    }

    /** Log enough to debug a failing integration, never the credential that made the call. */
    private function logFailure(string $op, int $status, string $body): void
    {
        Log::warning('XPay '.$op.' failed', [
            'status' => $status,
            'body' => mb_substr($body, 0, 1000),
        ]);
    }
}
