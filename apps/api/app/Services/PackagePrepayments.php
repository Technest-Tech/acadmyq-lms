<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Paying a student's packages ahead (Ahmed 2026-11-17): "two months in advance, for one student or
 * more, and the system doesn't bring them to Due until the paid period is over".
 *
 * A prepayment buys the next N blocks of the student's running package, at the price that block
 * will renew at. Each renewal that opens while blocks are left is settled from it ({@see settle()}),
 * so it never shows as due; when they run out the family is chased as before.
 *
 *   • Classic academies: the prepayment row is the record of the money. Each renewal's bill is
 *     marked paid from it — method, reference and the day the money came in.
 *   • Academies on receipts ({@see Ledger}): the money is one receipt; what it does not pay today
 *     stays as the family's credit, which the ledger applies to each renewal's bill as it is raised.
 *     The row only counts the blocks.
 *
 * Only for a block billed when it starts (ON_START — every new student's default): a block billed
 * at its end has no bill to settle when it opens.
 */
final class PackagePrepayments
{
    /** The most blocks one prepayment may buy — a year of monthly blocks. */
    public const MAX_BLOCKS = 12;

    /**
     * Pay ahead for one student: the next `$blocks` renewals of their running package and — with
     * `$includeCurrent` — whatever is still owed on the running one.
     *
     * @param  array{method:string, reference?:?string, proof_path?:?string, note?:?string, paid_on:string}  $payment
     * @return array{prepayment_id:string, student_id:string, blocks:int, block_price_minor:int, amount_minor:int, currency:string, current_paid_minor:int, current_currency:?string}
     */
    public function prepay(string $studentId, int $blocks, bool $includeCurrent, array $payment, ?string $actorUserId, ?string $actorRole): array
    {
        if ($blocks < 1 || $blocks > self::MAX_BLOCKS) {
            throw ValidationException::withMessages(['blocks' => ['Pay ahead for 1 to 12 packages. / الدفع المقدم من باقة إلى 12 باقة.']]);
        }

        $running = DB::table('lesson_packages')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->orderBy('created_at')
            ->first();
        if ($running === null) {
            throw ValidationException::withMessages(['student_id' => [
                'This student has no open package to pay ahead on. / لا توجد باقة مفتوحة لهذا الطالب للدفع المقدم عليها.',
            ]]);
        }
        if ((string) $running->bill_timing !== 'ON_START') {
            throw ValidationException::withMessages(['student_id' => [
                'Only a package paid when it starts can be paid ahead. / الدفع المقدم متاح فقط للباقة التي تُدفع عند بدايتها.',
            ]]);
        }

        // What the next block will cost, in the currency it will be billed in (new terms parked for
        // the renewal win, a currency move included).
        $next = $running->next_terms !== null ? (array) json_decode((string) $running->next_terms, true) : [];
        $currency = strtoupper(trim((string) ($next['currency'] ?? $running->currency)));
        $blockPrice = (int) ($next['price_minor'] ?? $running->price_minor);
        $academyId = (string) $running->academy_id;

        $current = $includeCurrent && $running->invoice_id !== null
            ? DB::table('invoices')->where('id', $running->invoice_id)->first()
            : null;
        $currentDue = $current !== null && in_array((string) $current->status, ['OPEN', 'CLOSED', 'PARTIALLY_PAID'], true)
            ? max(0, (int) $current->total_minor - (int) $current->amount_paid_minor)
            : 0;

        return DB::transaction(function () use ($studentId, $blocks, $payment, $actorUserId, $actorRole, $running, $currency, $blockPrice, $academyId, $current, $currentDue): array {
            // A prepaid future needs the block to renew by itself.
            if (! (bool) $running->auto_renew) {
                DB::table('lesson_packages')->where('id', $running->id)->update(['auto_renew' => true, 'updated_at' => now()]);
            }

            $amount = $blocks * $blockPrice;
            $receiptId = null;
            $opts = [
                'method' => $payment['method'],
                'reference' => $payment['reference'] ?? null,
                'proof_path' => $payment['proof_path'] ?? null,
                'note' => $payment['note'] ?? null,
                'received_on' => $payment['paid_on'],
                'received_by' => $actorUserId,
                'actor_role' => $actorRole,
            ];

            if (Ledger::enabledFor($academyId)) {
                if ($currentDue > 0) {
                    app(Ledger::class)->record($academyId, [], $currentDue, trim((string) $current->currency), $opts + ['invoice_id' => (string) $current->id]);
                }
                if ($amount > 0) {
                    // Nothing to pay with it today: it is the family's credit until each renewal's bill takes it.
                    $academy = DB::table('academies')->where('id', $academyId)->first();
                    [$guardianId, $payerStudentId] = app(Invoicing::class)->payerOf($academy, $studentId);
                    $receipt = app(Ledger::class)->record($academyId, ['guardian_id' => $guardianId, 'student_id' => $payerStudentId], $amount, $currency, $opts + ['apply_rest' => false]);
                    $receiptId = (string) $receipt->id;
                }
            } elseif ($currentDue > 0) {
                $this->markPaidClassic($current, $currentDue, $payment, null, $actorUserId, $actorRole);
            }

            $id = (string) DB::table('package_prepayments')->insertGetId([
                'academy_id' => $academyId,
                'student_id' => $studentId,
                'package_id' => (string) $running->id,
                'teacher_id' => $running->teacher_id,
                'currency' => $currency,
                'blocks_total' => $blocks,
                'block_price_minor' => $blockPrice,
                'amount_minor' => $amount,
                'payment_method' => $payment['method'],
                'payment_reference' => $payment['reference'] ?? null,
                'payment_proof_path' => $payment['proof_path'] ?? null,
                'note' => $payment['note'] ?? null,
                'paid_on' => $payment['paid_on'],
                'receipt_id' => $receiptId,
                'created_by' => $actorUserId,
            ]);

            Audit::log('lesson_package.prepaid', 'lesson_package', (string) $running->id, $academyId, $actorUserId, $actorRole, after: [
                'prepayment_id' => $id,
                'blocks' => $blocks,
                'block_price_minor' => $blockPrice,
                'amount_minor' => $amount,
                'currency' => $currency,
                'current_paid_minor' => $currentDue,
                'method' => $payment['method'],
            ]);

            return [
                'prepayment_id' => $id,
                'student_id' => $studentId,
                'blocks' => $blocks,
                'block_price_minor' => $blockPrice,
                'amount_minor' => $amount,
                'currency' => $currency,
                'current_paid_minor' => $currentDue,
                'current_currency' => $current !== null ? trim((string) $current->currency) : null,
            ];
        });
    }

    /**
     * A renewal just opened with its bill: pay it from the student's prepayment, if blocks are left.
     *
     * Classic: the bill is marked paid from the prepayment (up to one block's price — terms raised
     * since leave the difference owing). On receipts the ledger has already applied the family's
     * credit as the bill was raised; the block counts once that reached it.
     */
    public function settle(string $packageId, ?string $actorUserId, ?string $actorRole): void
    {
        $package = DB::table('lesson_packages')->where('id', $packageId)->first();
        if ($package === null || $package->invoice_id === null || $package->prepayment_id !== null) {
            return;
        }

        $prepayment = DB::table('package_prepayments')
            ->where('student_id', $package->student_id)
            ->whereNull('cancelled_at')
            ->whereColumn('blocks_used', '<', 'blocks_total')
            ->whereRaw('trim(currency) = ?', [trim((string) $package->currency)])
            ->where(fn ($q) => $package->teacher_id !== null ? $q->where('teacher_id', $package->teacher_id) : $q->whereNull('teacher_id'))
            ->orderBy('created_at')
            ->lockForUpdate()
            ->first();
        if ($prepayment === null) {
            return;
        }

        $invoice = DB::table('invoices')->where('id', $package->invoice_id)->first();
        if ($invoice === null || ! in_array((string) $invoice->status, ['OPEN', 'CLOSED', 'PARTIALLY_PAID', 'PAID'], true)) {
            return;
        }

        if (Ledger::enabledFor((string) $package->academy_id)) {
            if ((int) $invoice->amount_paid_minor <= 0) {
                return; // the credit went elsewhere first: this block is owed like any other
            }
        } else {
            $due = max(0, (int) $invoice->total_minor - (int) $invoice->amount_paid_minor);
            if ($due > 0) {
                $this->markPaidClassic($invoice, min($due, (int) $prepayment->block_price_minor), [
                    'method' => (string) $prepayment->payment_method,
                    'reference' => $prepayment->payment_reference,
                    'note' => 'Prepaid / مدفوعة مقدمًا',
                ], (string) $prepayment->created_at, $actorUserId, $actorRole, (string) $prepayment->id);
            }
        }

        DB::table('package_prepayments')->where('id', $prepayment->id)->increment('blocks_used', 1, ['updated_at' => now()]);
        DB::table('lesson_packages')->where('id', $packageId)->update(['prepayment_id' => $prepayment->id, 'updated_at' => now()]);
        Audit::log('lesson_package.prepayment_used', 'lesson_package', $packageId, (string) $package->academy_id, $actorUserId, $actorRole, after: [
            'prepayment_id' => (string) $prepayment->id,
            'blocks_used' => (int) $prepayment->blocks_used + 1,
            'blocks_total' => (int) $prepayment->blocks_total,
        ]);
    }

    /**
     * A renewal that was settled from a prepayment is being undone (cancelled before any of its own
     * lessons): the block goes back to the prepayment, and — classic — the payment comes off its
     * bill so the bill can be voided like any unpaid one.
     */
    public function giveBack(object $package, ?string $actorUserId, ?string $actorRole): void
    {
        if ($package->prepayment_id === null) {
            return;
        }

        if (! Ledger::enabledFor((string) $package->academy_id) && $package->invoice_id !== null) {
            DB::table('invoices')->where('id', $package->invoice_id)->whereIn('status', ['PAID', 'PARTIALLY_PAID'])->update([
                'status' => 'OPEN',
                'amount_paid_minor' => 0,
                'paid_at' => null,
                'payment_method' => null,
                'payment_reason' => null,
                'payment_reference' => null,
                'updated_at' => now(),
            ]);
        }

        DB::table('package_prepayments')->where('id', $package->prepayment_id)->where('blocks_used', '>', 0)->decrement('blocks_used', 1, ['updated_at' => now()]);
        DB::table('lesson_packages')->where('id', $package->id)->update(['prepayment_id' => null, 'updated_at' => now()]);
        Audit::log('lesson_package.prepayment_returned', 'lesson_package', (string) $package->id, (string) $package->academy_id, $actorUserId, $actorRole,
            after: ['prepayment_id' => (string) $package->prepayment_id]);
    }

    /**
     * Take back the blocks not used yet (a mistake, or the family left). Classic: the row stops
     * paying renewals; the money itself is the academy's to hand back. On receipts the unused part
     * is still the family's credit, refunded from their account like any credit.
     */
    public function cancel(string $prepaymentId, ?string $actorUserId, ?string $actorRole): void
    {
        $row = DB::table('package_prepayments')->where('id', $prepaymentId)->whereNull('cancelled_at')->first();
        if ($row === null) {
            abort(404, 'Prepayment not found.');
        }

        DB::table('package_prepayments')->where('id', $prepaymentId)->update([
            'cancelled_at' => now(),
            'cancelled_by' => $actorUserId,
            'updated_at' => now(),
        ]);
        Audit::log('lesson_package.prepayment_cancelled', 'lesson_package', (string) $row->package_id, (string) $row->academy_id, $actorUserId, $actorRole, after: [
            'prepayment_id' => $prepaymentId,
            'blocks_unused' => (int) $row->blocks_total - (int) $row->blocks_used,
            'unused_minor' => ((int) $row->blocks_total - (int) $row->blocks_used) * (int) $row->block_price_minor,
        ]);
    }

    /**
     * How many prepaid blocks each student still has, by student id (cancelled rows left out).
     *
     * @param  list<string>  $studentIds
     * @return array<string, array{blocks_left:int, prepayment_ids:list<string>}>
     */
    public function leftFor(array $studentIds): array
    {
        if ($studentIds === []) {
            return [];
        }

        $out = [];
        foreach (DB::table('package_prepayments')->whereIn('student_id', $studentIds)->whereNull('cancelled_at')
            ->whereColumn('blocks_used', '<', 'blocks_total')->orderBy('created_at')->get() as $row) {
            $key = (string) $row->student_id;
            $out[$key] ??= ['blocks_left' => 0, 'prepayment_ids' => []];
            $out[$key]['blocks_left'] += (int) $row->blocks_total - (int) $row->blocks_used;
            $out[$key]['prepayment_ids'][] = (string) $row->id;
        }

        return $out;
    }

    /**
     * The classic "mark paid", for money that already came in: the bill's paid amount rises by
     * `$amount`, PAID once it covers the total. `$paidAt` = when the money was received.
     *
     * @param  array{method:string, reference?:?string, proof_path?:?string, note?:?string}  $payment
     */
    private function markPaidClassic(object $invoice, int $amount, array $payment, ?string $paidAt, ?string $actorUserId, ?string $actorRole, ?string $prepaymentId = null): void
    {
        $paid = (int) $invoice->amount_paid_minor + $amount;
        $full = $paid >= (int) $invoice->total_minor;
        DB::table('invoices')->where('id', $invoice->id)->update([
            'status' => $full ? 'PAID' : 'PARTIALLY_PAID',
            'amount_paid_minor' => min($paid, (int) $invoice->total_minor),
            'paid_at' => $full ? ($paidAt ?? now()) : null,
            'payment_method' => $payment['method'],
            'payment_reason' => $payment['note'] ?? null,
            'payment_reference' => $payment['reference'] ?? null,
            'updated_at' => now(),
        ] + (isset($payment['proof_path']) && $payment['proof_path'] !== null ? ['payment_proof_path' => $payment['proof_path']] : []));

        Audit::log('invoice.marked_paid', 'invoice', (string) $invoice->id, (string) $invoice->academy_id, $actorUserId, $actorRole, after: [
            'status' => $full ? 'PAID' : 'PARTIALLY_PAID',
            'payment_method' => $payment['method'],
            'amount_paid_minor' => min($paid, (int) $invoice->total_minor),
            'payment_reference' => $payment['reference'] ?? null,
            'prepayment_id' => $prepaymentId,
        ]);
    }
}
