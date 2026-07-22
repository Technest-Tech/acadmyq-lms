<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Admin/lifecycle client for the self-hosted WhatsApp gateway (apps/wa-gateway). These are the
 * Super-Admin-only endpoints the old Wasender dashboard used to provide — create a session, fetch the
 * pairing QR, probe status, and logout. Authenticated by the GLOBAL gateway admin secret (the
 * X-Gateway-Admin header), distinct from the per-academy bearer token used by the send surface
 * (WasenderClient). Failures are returned as a structured shape so the controller can surface a 502
 * to the operator rather than crashing.
 */
final class GatewayAdminClient
{
    /**
     * Create a session for an academy. Returns the one-time minted bearer token + the gateway
     * session id (both stored by the caller — token encrypted).
     *
     * @return array{ok: bool, session_id: ?string, token: ?string, error: ?string}
     */
    public function createSession(string $academyId): array
    {
        try {
            $res = $this->http()->post('/sessions', ['academyId' => $academyId]);
            if (! $res->successful()) {
                return ['ok' => false, 'session_id' => null, 'token' => null, 'error' => $this->errorFrom($res->status(), $res->json())];
            }
            $body = $res->json();

            return [
                'ok' => true,
                'session_id' => isset($body['sessionId']) ? (string) $body['sessionId'] : null,
                'token' => isset($body['token']) ? (string) $body['token'] : null,
                'error' => null,
            ];
        } catch (Throwable) {
            return ['ok' => false, 'session_id' => null, 'token' => null, 'error' => 'transport_error'];
        }
    }

    /**
     * Current pairing QR (data URL) + state for a session.
     *
     * @return array{ok: bool, state: ?string, qr: ?string}
     */
    public function getQr(string $sessionId): array
    {
        try {
            $res = $this->http()->get('/sessions/'.rawurlencode($sessionId).'/qr');
            if (! $res->successful()) {
                return ['ok' => false, 'state' => null, 'qr' => null];
            }
            $body = $res->json();

            return [
                'ok' => true,
                'state' => isset($body['state']) ? (string) $body['state'] : null,
                'qr' => isset($body['qr']) ? (string) $body['qr'] : null,
            ];
        } catch (Throwable) {
            return ['ok' => false, 'state' => null, 'qr' => null];
        }
    }

    /**
     * Live session status view. Returns ['ok' => false] when the gateway is unreachable.
     *
     * @return array<string,mixed>
     */
    public function getStatus(string $sessionId): array
    {
        try {
            $res = $this->http()->get('/sessions/'.rawurlencode($sessionId).'/status');
            if (! $res->successful()) {
                return ['ok' => false];
            }

            return ['ok' => true] + (array) $res->json();
        } catch (Throwable) {
            return ['ok' => false];
        }
    }

    /**
     * Logout + delete a session on the gateway. Returns whether the call succeeded.
     *
     * The body is deliberately non-empty. PendingRequest pins Content-Type: application/json on every
     * request (its constructor calls asJson()), and Fastify's JSON parser rejects that content-type
     * with an empty body — so a body-less DELETE came back 400 "Body cannot be empty…" and logout
     * never actually reached the gateway, leaking a live session while the app cleared its token. The
     * route reads only :id, so the payload is ignored.
     */
    public function deleteSession(string $sessionId): bool
    {
        try {
            $res = $this->http()->delete('/sessions/'.rawurlencode($sessionId), ['confirm' => true]);

            // 404 means the gateway holds no such session, i.e. the end state logout wants already
            // holds — report success so the caller can clear its token. Reporting failure would strand
            // an academy whose session the gateway has already dropped.
            return $res->successful() || $res->status() === 404;
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * Gateway liveness + per-state session counts (powers the "System" tab). `up=false` when the
     * gateway is unreachable.
     *
     * @return array<string,mixed>
     */
    public function health(): array
    {
        try {
            $res = $this->http()->get('/health');
            if (! $res->successful()) {
                return ['ok' => false, 'up' => false];
            }

            return ['ok' => true, 'up' => true] + (array) $res->json();
        } catch (Throwable) {
            return ['ok' => false, 'up' => false];
        }
    }

    /**
     * Current live send-pacing (anti-ban rate-limit) settings.
     *
     * @return array<string,mixed>
     */
    public function getSettings(): array
    {
        try {
            $res = $this->http()->get('/settings');
            if (! $res->successful()) {
                return ['ok' => false];
            }

            return ['ok' => true] + (array) $res->json();
        } catch (Throwable) {
            return ['ok' => false];
        }
    }

    /**
     * Update the live send-pacing settings (applies immediately to all sessions).
     *
     * @param  array<string,int>  $patch
     * @return array<string,mixed>
     */
    public function updateSettings(array $patch): array
    {
        try {
            $res = $this->http()->put('/settings', $patch);
            if (! $res->successful()) {
                return ['ok' => false];
            }

            return ['ok' => true] + (array) $res->json();
        } catch (Throwable) {
            return ['ok' => false];
        }
    }

    private function http(): PendingRequest
    {
        return Http::withHeaders(['X-Gateway-Admin' => (string) config('services.whatsapp_gateway.admin_secret')])
            ->acceptJson()
            ->asJson()
            ->baseUrl((string) config('services.whatsapp_gateway.base_url'))
            ->timeout((int) config('services.whatsapp_gateway.timeout', 15));
    }

    /**
     * @param  array<string,mixed>|null  $body
     */
    private function errorFrom(int $status, ?array $body): string
    {
        $message = $body['error'] ?? $body['message'] ?? null;

        return $message !== null ? "http_{$status}: ".(string) $message : "http_{$status}";
    }
}
