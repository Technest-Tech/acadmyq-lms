<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Livekit\Jwt;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Verifies inbound webhooks from the self-hosted LiveKit server. LiveKit signs each webhook with
 * a JWT (HS256, signed with the API secret) carried in the `Authorization` header, whose `sha256`
 * claim is the base64 SHA-256 of the EXACT raw body. We verify the signature (constant-time) and
 * confirm the body hash matches, mirroring VerifyWhatsAppWebhook's discipline. A bad/absent token
 * or a body mismatch is rejected with 401 before the controller runs.
 */
final class VerifyLivekitWebhook
{
    public function handle(Request $request, Closure $next): Response
    {
        $secret = (string) config('services.livekit.api_secret', '');
        if ($secret === '') {
            abort(500, 'LiveKit webhook secret not configured.');
        }

        $token = trim((string) preg_replace('/^Bearer\s+/i', '', (string) $request->header('Authorization', '')));
        $claims = $token !== '' ? Jwt::decode($token, $secret) : null;
        if ($claims === null) {
            abort(401, 'Invalid webhook token.');
        }

        // The token's sha256 claim must equal the base64 SHA-256 of the raw request body.
        $expected = base64_encode(hash('sha256', $request->getContent(), true));
        if (! isset($claims['sha256']) || ! hash_equals($expected, (string) $claims['sha256'])) {
            abort(401, 'Webhook body hash mismatch.');
        }

        return $next($request);
    }
}
