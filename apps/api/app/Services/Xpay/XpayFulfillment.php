<?php

declare(strict_types=1);

namespace App\Services\Xpay;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * THE one place that decides "this XPay Checkout Session means the invoice is paid".
 *
 * Two independent paths reach this conclusion — the `checkout.session.completed` webhook (the source
 * of truth) and the return-page sync that re-reads the session (the fallback for a client who never
 * configured a webhook endpoint) — and they must agree, so the rule lives here once rather than
 * being spelled twice. Both hand us the same structure: XPay's Checkout Session object, byte-identical
 * whether it arrived as `data.object` or from GET /checkout/sessions/:id.
 *
 * Marking is idempotent by construction: app.xpay_mark_invoice_paid only moves an OPEN/CLOSED
 * invoice, so whichever path arrives second gets `false` and writes nothing.
 */
final class XpayFulfillment
{
    /**
     * Record the session locally and mark the invoice paid when the session really is settled.
     *
     * @param  array<string,mixed>  $session  an XPay Checkout Session object
     * @return bool  true only when THIS call flipped the invoice to PAID
     */
    public function settle(array $session, string $academyId, string $invoiceId, int $expectedMinor): bool
    {
        $sessionId = (string) ($session['id'] ?? '');
        if ($sessionId === '') {
            return false;
        }

        $amountMinor = self::customerFacingTotalMinor($session);

        DB::select('select app.xpay_record_session(?, ?, ?, ?, ?, ?, ?, ?)', [
            $sessionId,
            $academyId,
            $invoiceId,
            $amountMinor ?? 0,
            self::customerFacingCurrency($session),
            (string) ($session['status'] ?? 'open'),
            (string) ($session['paymentStatus'] ?? 'unpaid'),
            isset($session['url']) ? (string) $session['url'] : null,
        ]);

        if (! self::isPaid($session)) {
            return false;
        }

        // Never close an invoice on an amount that does not match what we billed. A short payment is
        // a reconciliation problem for a human, not something to silently mark settled.
        if ($amountMinor === null || $amountMinor < $expectedMinor) {
            Log::warning('XPay settled amount does not cover the invoice', [
                'session_id' => $sessionId,
                'invoice_id' => $invoiceId,
                'expected_minor' => $expectedMinor,
                'received_minor' => $amountMinor,
            ]);

            return false;
        }

        $marked = DB::selectOne('select app.xpay_mark_invoice_paid(?, ?) as ok', [
            $invoiceId,
            $sessionId,
        ])?->ok;

        return (bool) $marked;
    }

    /** A session counts as settled only when XPay says both the session and its payment are done. */
    public static function isPaid(array $session): bool
    {
        return ($session['status'] ?? null) === 'complete'
            && ($session['paymentStatus'] ?? null) === 'paid';
    }

    /**
     * What the customer was actually charged, in minor units.
     *
     * XPay settles in EGP, so on a non-EGP invoice `amountTotal` is the EGP figure the merchant
     * receives while `presentmentDetails.amountTotal` is what the payer saw in the invoice's own
     * currency. Comparing an EGP settlement against an e.g. USD invoice total would reject every
     * valid payment, so the presentment mirror wins whenever it exists.
     */
    public static function customerFacingTotalMinor(array $session): ?int
    {
        $presentment = $session['presentmentDetails'] ?? null;
        if (is_array($presentment) && isset($presentment['amountTotal'])) {
            return (int) $presentment['amountTotal'];
        }

        return isset($session['amountTotal']) ? (int) $session['amountTotal'] : null;
    }

    /** Currency matching customerFacingTotalMinor(), so the stored pair is always self-consistent. */
    public static function customerFacingCurrency(array $session): string
    {
        $presentment = $session['presentmentDetails'] ?? null;
        if (is_array($presentment) && ! empty($presentment['currency'])) {
            return strtoupper((string) $presentment['currency']);
        }

        return strtoupper((string) ($session['currency'] ?? 'EGP'));
    }
}
