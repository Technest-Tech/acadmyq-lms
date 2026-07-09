<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Thin HTTP wrapper over the Wasender WhatsApp API (https://wasenderapi.com/api). The auth
 * token is per-academy and passed in on every call — this client holds NO token state, so one
 * instance serves every academy and a token can never leak between tenants. The token is never
 * logged.
 *
 * Only the endpoints the platform needs are wrapped: send-message, the number-on-WhatsApp check,
 * and the session status probe used by the "Test connection" admin action. All failures are
 * swallowed into a {ok:false, error} shape so callers (the WhatsAppSender seam, jobs) never throw
 * on a provider hiccup — they fall back to the wa.me deep-link path instead.
 */
final class WasenderClient
{
    /**
     * Send a plain-text WhatsApp message via Wasender.
     *
     * @param  string  $token  the academy's Wasender API token (decrypted, never logged)
     * @param  string  $to  recipient — E.164 (e.g. +201234567890) or a Wasender JID
     * @return array{ok: bool, message_id: ?string, error: ?string}
     */
    public function sendMessage(string $token, string $to, string $text): array
    {
        try {
            $res = $this->http($token)->post('/api/send-message', [
                'to' => $to,
                'text' => $text,
            ]);

            if (! $res->successful()) {
                return ['ok' => false, 'message_id' => null, 'error' => $this->errorFrom($res->status(), $res->json())];
            }

            $body = $res->json();
            $messageId = $body['data']['msgId'] ?? $body['data']['id'] ?? $body['msgId'] ?? $body['id'] ?? null;

            return ['ok' => true, 'message_id' => $messageId !== null ? (string) $messageId : null, 'error' => null];
        } catch (Throwable $e) {
            // Never surface the token or a stack trace to the caller; just a short reason.
            return ['ok' => false, 'message_id' => null, 'error' => 'transport_error'];
        }
    }

    /**
     * Send an image message (by public https URL) via the gateway, with an optional caption. The
     * gateway fetches the URL server-side and rejects non-public targets (SSRF guard), so a bad URL
     * surfaces here as a 4xx {ok:false,error} rather than an exception.
     *
     * @param  string  $token  the academy's gateway token (decrypted, never logged)
     * @param  string  $to  recipient — E.164 or a JID
     * @param  string  $imageUrl  public https URL of the image
     * @return array{ok: bool, message_id: ?string, error: ?string}
     */
    public function sendImage(string $token, string $to, string $imageUrl, ?string $caption = null): array
    {
        try {
            $payload = ['to' => $to, 'imageUrl' => $imageUrl];
            if ($caption !== null && $caption !== '') {
                $payload['caption'] = $caption;
            }
            $res = $this->http($token)->post('/api/send-message', $payload);

            if (! $res->successful()) {
                return ['ok' => false, 'message_id' => null, 'error' => $this->errorFrom($res->status(), $res->json())];
            }

            $body = $res->json();
            $messageId = $body['data']['msgId'] ?? $body['data']['id'] ?? $body['msgId'] ?? $body['id'] ?? null;

            return ['ok' => true, 'message_id' => $messageId !== null ? (string) $messageId : null, 'error' => null];
        } catch (Throwable) {
            return ['ok' => false, 'message_id' => null, 'error' => 'transport_error'];
        }
    }

    /**
     * Is the given number registered on WhatsApp? Best-effort — returns false on any error.
     */
    public function onWhatsApp(string $token, string $jid): bool
    {
        try {
            $res = $this->http($token)->get('/api/on-whatsapp/'.rawurlencode($jid));
            if (! $res->successful()) {
                return false;
            }
            $body = $res->json();

            return (bool) ($body['exists'] ?? $body['data']['exists'] ?? $body['onWhatsApp'] ?? false);
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * Probe the WhatsApp session status for this token (powers the admin "Test connection").
     * Returns an uppercased status string (e.g. 'CONNECTED') or null when unreachable.
     */
    public function sessionStatus(string $token): ?string
    {
        try {
            $res = $this->http($token)->get('/api/status');
            if (! $res->successful()) {
                return null;
            }
            $body = $res->json();
            $status = $body['status'] ?? $body['data']['status'] ?? null;

            return $status !== null ? strtoupper((string) $status) : null;
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * A pre-configured PendingRequest: bearer auth, JSON, the configured base URL + timeout.
     */
    private function http(string $token): PendingRequest
    {
        return Http::withToken($token)
            ->acceptJson()
            ->asJson()
            ->baseUrl((string) config('services.wasender.base_url'))
            ->timeout((int) config('services.wasender.timeout', 15));
    }

    /**
     * @param  array<string,mixed>|null  $body
     */
    private function errorFrom(int $status, ?array $body): string
    {
        $message = $body['message'] ?? $body['error'] ?? null;

        return $message !== null ? "http_{$status}: ".(string) $message : "http_{$status}";
    }
}
