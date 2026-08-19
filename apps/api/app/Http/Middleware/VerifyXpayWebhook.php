<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Verifies the signature on inbound XPay webhooks (docs.xpay.app/en/integrate/webhooks/verifying-signatures).
 *
 * XPay sends `XPay-Signature: t=<unix>,v1=<hex>` where v1 is
 * HMAC-SHA256(endpointSecret, "{t}.{rawBody}") — signed over the exact bytes it sent, so we hash
 * $request->getContent() and never a re-encoded array (a re-serialised body has different whitespace
 * and key order and would never match).
 *
 * Unlike the WhatsApp and LiveKit webhooks, the signing secret is NOT a platform-wide env value:
 * every client has its own XPay merchant account and therefore its own `whsec_*`. The academy id in
 * the callback URL selects which secret to check against — it is an identifier, not a credential.
 * The HMAC is the only thing that authenticates the request.
 *
 * Rejections are 400, not 401: XPay's delivery workflow treats any non-2xx as a failed attempt and
 * retries, and 400 is the status its own docs prescribe for a signature mismatch.
 */
final class VerifyXpayWebhook
{
    /** XPay's replay window: reject anything signed more than 5 minutes from now. */
    private const TOLERANCE_SECONDS = 300;

    public function handle(Request $request, Closure $next): Response
    {
        $academyId = (string) $request->route('academy');
        if ($academyId === '') {
            abort(400, 'Missing academy.');
        }

        [$secret, $mode] = $this->signingSecret($academyId);
        if ($secret === null) {
            abort(400, 'XPay webhooks are not configured for this academy.');
        }

        // Hand the resolved environment to the controller so it can reject a payload whose
        // `livemode` disagrees with the keys that just verified it.
        $request->attributes->set('xpay_mode', $mode);

        [$timestamp, $received] = $this->parseHeader((string) $request->header('XPay-Signature', ''));
        if ($timestamp === null || $received === null) {
            abort(400, 'Invalid webhook signature.');
        }

        // Replay defence — the same 300s window XPay signs against.
        if (abs(time() - $timestamp) > self::TOLERANCE_SECONDS) {
            abort(400, 'Stale webhook.');
        }

        $expected = hash_hmac('sha256', $timestamp.'.'.$request->getContent(), $secret);
        if (! hash_equals($expected, $received)) {
            abort(400, 'Invalid webhook signature.');
        }

        return $next($request);
    }

    /**
     * Split `t=…,v1=…` into its two required parts. Anything malformed or missing either field is
     * rejected outright rather than partially trusted.
     *
     * @return array{0: int|null, 1: string|null}
     */
    private function parseHeader(string $header): array
    {
        if ($header === '') {
            return [null, null];
        }

        $parts = [];
        foreach (explode(',', $header) as $piece) {
            $kv = explode('=', trim($piece), 2);
            if (count($kv) === 2) {
                $parts[$kv[0]] = $kv[1];
            }
        }

        $t = $parts['t'] ?? '';
        $v1 = $parts['v1'] ?? '';

        if (! ctype_digit($t) || $v1 === '') {
            return [null, null];
        }

        return [(int) $t, $v1];
    }

    /**
     * The academy's `whsec_*` for its ACTIVE environment, decrypted, plus which environment that
     * was. Read through the SECURITY DEFINER reader because this route is unauthenticated and has
     * no tenant context to satisfy RLS.
     *
     * Resolving only the active mode is deliberate: a client switched to live has its live signing
     * secret loaded here, so a test-mode delivery simply fails to verify. Play money cannot settle
     * a real invoice.
     *
     * @return array{0: string|null, 1: string|null}
     */
    private function signingSecret(string $academyId): array
    {
        // A malformed id would make the function's ::uuid cast throw a 500 on unauthenticated input.
        if (preg_match('/^[0-9a-fA-F-]{36}$/', $academyId) !== 1) {
            return [null, null];
        }

        $raw = DB::selectOne('select app.xpay_credentials_for_academy(?) as c', [$academyId])?->c;
        if ($raw === null) {
            return [null, null];
        }

        $cfg = is_string($raw) ? json_decode($raw, true) : (array) $raw;
        if (empty($cfg['webhook_secret_enc'])) {
            return [null, null];
        }

        try {
            return [Crypt::decryptString((string) $cfg['webhook_secret_enc']), $cfg['mode'] ?? null];
        } catch (\Throwable) {
            return [null, null];
        }
    }
}
