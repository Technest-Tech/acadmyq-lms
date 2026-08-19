<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Xpay\XpayFulfillment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Inbound XPay webhooks — the SOURCE OF TRUTH for whether an invoice got paid.
 *
 * The signature is already verified by the `xpay.webhook` middleware, so by the time we are here the
 * request provably came from the merchant account that owns the academy in the URL.
 *
 * Everything a handler must get right, per docs.xpay.app:
 *
 *  - IDEMPOTENCY. XPay retries on every non-2xx and can re-deliver a call whose 200 got lost.
 *    `event.id` is stable across retries, so a conflicting insert IS the duplicate signal.
 *  - SPEED. Delivery counts as successful only if we answer 2xx within 30 seconds. Settling is a
 *    single UPDATE, comfortably inside that, so there is no queue hop here — adding one would buy
 *    nothing and cost us the ability to report the outcome.
 *  - ORDER. Events are not ordered. We key fulfilment off `checkout.session.completed` alone and
 *    acknowledge every other type without acting on it.
 */
final class XpayWebhookController extends Controller
{
    public function __construct(private readonly XpayFulfillment $fulfillment) {}

    /** POST /api/webhooks/xpay/{academy} */
    public function handle(Request $request, string $academy): JsonResponse
    {
        $event = $request->json()->all();

        $eventId = (string) ($event['id'] ?? '');
        $type = (string) ($event['type'] ?? '');
        if ($eventId === '' || $type === '') {
            // Acknowledge: a malformed body will never become well-formed on retry.
            return response()->json(['ok' => true, 'ignored' => 'malformed']);
        }

        $fresh = DB::selectOne('select app.xpay_record_event(?, ?, ?, ?) as fresh', [
            $eventId,
            $academy,
            $type,
            json_encode($event),
        ])?->fresh;

        if (! $fresh) {
            // Already handled — 200 so XPay stops retrying, but nothing is applied twice.
            return response()->json(['ok' => true, 'duplicate' => true]);
        }

        if ($type !== 'checkout.session.completed') {
            return response()->json(['ok' => true, 'ignored' => $type]);
        }

        // Belt and braces on top of the signature check: the middleware only ever loads the ACTIVE
        // environment's signing secret, so a mismatch here should be impossible. If it happens, the
        // client's two key sets are crossed and we would rather record the event than settle on it.
        $mode = $request->attributes->get('xpay_mode');
        $livemode = $event['livemode'] ?? null;
        if ($mode !== null && is_bool($livemode) && $livemode !== ($mode === 'live')) {
            Log::warning('XPay event livemode disagrees with the academy\'s active mode', [
                'event_id' => $eventId,
                'academy_id' => $academy,
                'active_mode' => $mode,
                'livemode' => $livemode,
            ]);

            return response()->json(['ok' => true, 'ignored' => 'mode-mismatch']);
        }

        $session = (array) ($event['data']['object'] ?? []);
        $invoiceId = (string) ($session['metadata']['invoice_id'] ?? '');
        $sessionAcademy = (string) ($session['metadata']['academy_id'] ?? '');

        if ($invoiceId === '' || $sessionAcademy !== $academy) {
            // Not one of ours (or a session opened outside this integration): recorded, not acted on.
            Log::info('XPay event carries no matching invoice', [
                'event_id' => $eventId,
                'academy_id' => $academy,
            ]);

            return response()->json(['ok' => true, 'ignored' => 'unmatched']);
        }

        $expected = DB::selectOne('select app.xpay_session_amount(?, ?) as amount', [
            (string) ($session['id'] ?? ''),
            $invoiceId,
        ])?->amount;

        if ($expected === null) {
            // We never opened this session, so we have no billed amount to check the payment
            // against. Refuse to settle rather than trust an amount supplied by the payload.
            Log::warning('XPay event for an unknown checkout session', [
                'event_id' => $eventId,
                'session_id' => $session['id'] ?? null,
                'invoice_id' => $invoiceId,
            ]);

            return response()->json(['ok' => true, 'ignored' => 'unknown-session']);
        }

        $marked = $this->fulfillment->settle($session, $academy, $invoiceId, (int) $expected);

        return response()->json(['ok' => true, 'marked_paid' => $marked]);
    }
}
