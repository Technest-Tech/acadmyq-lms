<?php

declare(strict_types=1);

namespace App\Services\Xpay;

use App\Services\Ledger;
use App\Support\AuthContext;
use App\Support\Tenancy;
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
     * @return bool true only when THIS call flipped the invoice to PAID
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

        // An academy kept by receipts records the card payment as a receipt (docs/groups/01-ACCOUNTING.md).
        if ($marked) {
            app(Ledger::class)->recordGatewayPayment($academyId, $invoiceId, 'XPay '.$sessionId);
        }

        return (bool) $marked;
    }

    /**
     * The same rule for a FAMILY session (`/f/{token}`): one card payment for several bills.
     *
     * What the session covers comes from our own rows (xpay_checkout_session_invoices, written when
     * it was opened) — never from the gateway's payload. The paid amount must cover the session's
     * total; then each covered bill is marked paid by itself, and gets its own receipt on an academy
     * kept by receipts. A bill that was meanwhile paid some other way is skipped and logged: the
     * family paid it twice, which is a refund for a human to make, not something to guess at.
     *
     * Idempotent like settle(): a bill already PAID does not move, so a retried webhook or the
     * return page racing it writes nothing.
     *
     * @param  array<string,mixed>  $session  an XPay Checkout Session object
     * @return bool|null null = we never opened this session for this family; otherwise true only
     *                   when THIS call marked at least one bill paid
     */
    public function settleFamily(array $session, string $academyId, string $guardianId): ?bool
    {
        $sessionId = (string) ($session['id'] ?? '');
        if ($sessionId === '') {
            return null;
        }

        $ctx = new AuthContext(userId: '', academyId: $academyId, role: 'GUARDIAN', permissions: []);
        $opened = Tenancy::withContext($ctx, function () use ($sessionId, $guardianId, $session): ?array {
            $row = DB::table('xpay_checkout_sessions')
                ->where('id', $sessionId)
                ->where('guardian_id', $guardianId)
                ->first(['amount_minor']);
            if ($row === null) {
                return null;
            }
            DB::table('xpay_checkout_sessions')->where('id', $sessionId)->update([
                'status' => (string) ($session['status'] ?? 'open'),
                'payment_status' => (string) ($session['paymentStatus'] ?? 'unpaid'),
                'updated_at' => now()->toIso8601String(),
            ]);

            return [
                'amount_minor' => (int) $row->amount_minor,
                'invoices' => DB::table('xpay_checkout_session_invoices')->where('session_id', $sessionId)->pluck('invoice_id')->all(),
            ];
        });

        if ($opened === null) {
            return null;
        }
        if (! self::isPaid($session)) {
            return false;
        }

        $amountMinor = self::customerFacingTotalMinor($session);
        if ($amountMinor === null || $amountMinor < $opened['amount_minor']) {
            Log::warning('XPay family payment does not cover the bills it was opened for', [
                'session_id' => $sessionId,
                'guardian_id' => $guardianId,
                'expected_minor' => $opened['amount_minor'],
                'received_minor' => $amountMinor,
            ]);

            return false;
        }

        $markedAny = false;
        foreach ($opened['invoices'] as $invoiceId) {
            $marked = (bool) DB::selectOne('select app.xpay_settle_family_invoice(?, ?) as ok', [(string) $invoiceId, $sessionId])?->ok;
            if ($marked) {
                $markedAny = true;
                app(Ledger::class)->recordGatewayPayment($academyId, (string) $invoiceId, 'XPay '.$sessionId);
            } else {
                Log::info('XPay family payment covered a bill that was already settled', [
                    'session_id' => $sessionId,
                    'invoice_id' => $invoiceId,
                ]);
            }
        }

        return $markedAny;
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
        // XPay reports in the currency's real minor unit; we compare in platform ×100 units.
        $currency = self::customerFacingCurrency($session);

        $presentment = $session['presentmentDetails'] ?? null;
        if (is_array($presentment) && isset($presentment['amountTotal'])) {
            return XpayClient::fromGatewayMinor((int) $presentment['amountTotal'], $currency);
        }

        return isset($session['amountTotal']) ? XpayClient::fromGatewayMinor((int) $session['amountTotal'], $currency) : null;
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
