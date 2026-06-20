<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Verifies the HMAC signature on inbound webhooks from the self-hosted WhatsApp gateway. The gateway
 * signs the EXACT raw JSON body with the shared WA_WEBHOOK_SECRET and sends it as
 * `X-WA-Signature: sha256=<hex>`. We recompute over the raw request body (not a re-encoded array) so
 * the bytes match, compare in constant time, and reject stale payloads (replay defence).
 */
final class VerifyWhatsAppWebhook
{
    public function handle(Request $request, Closure $next): Response
    {
        $secret = (string) config('services.whatsapp_gateway.webhook_secret', '');
        if ($secret === '') {
            abort(500, 'WhatsApp webhook secret not configured.');
        }

        $signature = (string) $request->header('X-WA-Signature', '');
        $expected = 'sha256='.hash_hmac('sha256', $request->getContent(), $secret);
        if ($signature === '' || ! hash_equals($expected, $signature)) {
            abort(401, 'Invalid webhook signature.');
        }

        // Replay defence: reject payloads whose signed timestamp is more than 5 minutes off.
        $ts = (int) $request->json('timestamp', 0);
        if ($ts > 0 && abs(time() - $ts) > 300) {
            abort(401, 'Stale webhook.');
        }

        return $next($request);
    }
}
