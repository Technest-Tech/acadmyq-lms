<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Correct the recorded length of an attended lesson without letting its three financial ledgers
 * drift apart. The preview and write deliberately share one calculation: the confirmation shown
 * to the owner is therefore the operation that is applied, not an approximation made by the UI.
 *
 * Open records may move; issued invoices, completed packages and finalized payroll never do.
 */
final class SessionDurationCorrection
{
    public function __construct(private readonly LessonPackages $packages) {}

    /** @return array<string,mixed> */
    public function preview(object $session, int $newDuration): array
    {
        $currentDuration = max(1, (int) $session->duration_minutes);
        $blockers = [];

        if ((string) $session->status !== 'ATTENDED') {
            $blockers[] = 'NOT_ATTENDED';
        }

        $credit = DB::table('lesson_package_credits as c')
            ->join('lesson_packages as p', 'p.id', '=', 'c.package_id')
            ->where('c.session_id', $session->id)
            ->first([
                'c.id as credit_id', 'c.minutes as credit_minutes',
                'c.minutes_overdrawn as credit_overdrawn', 'c.amount_minor as credit_amount_minor',
                'p.id as package_id', 'p.label as package_label', 'p.status as package_status',
                'p.minutes_total', 'p.carried_over_minutes', 'p.minutes_consumed',
                'p.minutes_overdrawn', 'p.hourly_rate_minor', 'p.currency',
            ]);

        $package = null;
        if ($credit !== null) {
            $capacity = (int) $credit->minutes_total + (int) $credit->carried_over_minutes;
            $newConsumed = max(0, (int) $credit->minutes_consumed - (int) $credit->credit_minutes + $newDuration);
            $newOverdrawn = max(0, $newConsumed - $capacity);
            $newCreditOverdrawn = max(0, $newOverdrawn - max(0, (int) $credit->minutes_overdrawn - (int) $credit->credit_overdrawn));

            if ((string) $credit->package_status !== 'ACTIVE') {
                $blockers[] = 'PACKAGE_CLOSED';
            }

            $package = [
                'package_id' => (string) $credit->package_id,
                'label' => (string) $credit->package_label,
                'status' => (string) $credit->package_status,
                'currency' => (string) $credit->currency,
                'consumed_before' => (int) $credit->minutes_consumed,
                'consumed_after' => $newConsumed,
                'remaining_before' => max(0, $capacity - (int) $credit->minutes_consumed),
                'remaining_after' => max(0, $capacity - $newConsumed),
                'overdrawn_after' => $newOverdrawn,
                'credit_overdrawn_after' => $newCreditOverdrawn,
                'will_complete' => $newConsumed >= $capacity,
            ];
        }

        $invoiceLine = DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->where('li.session_id', $session->id)
            ->first([
                'li.id as line_id', 'li.invoice_id', 'li.amount_minor', 'li.currency',
                'i.status as invoice_status',
            ]);

        $invoice = null;
        if ($invoiceLine !== null) {
            $subscription = DB::table('subscriptions')
                ->where('student_id', $session->student_id)
                ->where('status', 'ACTIVE')
                ->whereNull('deleted_at')
                ->orderByDesc('start_date')
                ->first(['price_basis']);
            $basis = (string) ($subscription?->price_basis ?? 'PER_SESSION');
            $amountAfter = (int) $invoiceLine->amount_minor;

            // Hour-based billing follows lesson length. A true flat monthly/session price does
            // not change when the timetable duration changes. Scale the line's captured amount
            // so a later student-rate edit is not accidentally applied to this older lesson.
            if (! $this->isFreeTrial((string) $session->id)
                && in_array($basis, ['PER_HOUR', 'PER_PACKAGE'], true)
                && $subscription !== null) {
                $amountAfter = (int) round((int) $invoiceLine->amount_minor * $newDuration / $currentDuration);
            }

            if ((string) $invoiceLine->invoice_status !== 'OPEN') {
                $blockers[] = 'INVOICE_LOCKED';
            }

            $invoice = [
                'invoice_id' => (string) $invoiceLine->invoice_id,
                'status' => (string) $invoiceLine->invoice_status,
                'currency' => (string) $invoiceLine->currency,
                'pricing_basis' => $basis,
                'amount_before' => (int) $invoiceLine->amount_minor,
                'amount_after' => $amountAfter,
            ];
        }

        $payoutLine = DB::table('payout_line_items as li')
            ->join('payouts as p', 'p.id', '=', 'li.payout_id')
            ->where('li.session_id', $session->id)
            ->first([
                'li.id as line_id', 'li.payout_id', 'li.amount_minor', 'li.currency',
                'p.finalized_at',
            ]);

        $payout = null;
        if ($payoutLine !== null) {
            if ($payoutLine->finalized_at !== null) {
                $blockers[] = 'PAYOUT_FINALIZED';
            }

            // The line amount is the rate snapshot. Scale that snapshot by the corrected duration
            // instead of reading today's teacher rate, which may legitimately have changed since.
            $amountAfter = $this->isFreeTrial((string) $session->id)
                ? 0
                : (int) round((int) $payoutLine->amount_minor * $newDuration / $currentDuration);
            $payout = [
                'payout_id' => (string) $payoutLine->payout_id,
                'currency' => (string) $payoutLine->currency,
                'finalized' => $payoutLine->finalized_at !== null,
                'amount_before' => (int) $payoutLine->amount_minor,
                'amount_after' => $amountAfter,
            ];
        }

        return [
            'session_id' => (string) $session->id,
            'duration_before' => $currentDuration,
            'duration_after' => $newDuration,
            'can_change' => $blockers === [],
            'blockers' => array_values(array_unique($blockers)),
            'invoice' => $invoice,
            'package' => $package,
            'payout' => $payout,
        ];
    }

    /** @return array<string,mixed> */
    public function update(string $sessionId, int $newDuration, ?string $actorUserId, ?string $actorRole): array
    {
        return DB::transaction(function () use ($sessionId, $newDuration, $actorUserId, $actorRole): array {
            $session = DB::table('sessions')->where('id', $sessionId)->lockForUpdate()->first();
            if ($session === null) {
                throw ValidationException::withMessages(['session' => ['Session not found. / الحصة غير موجودة.']]);
            }

            // Freeze every attached financial document before re-running the preview. This closes
            // the race where an invoice/package/payout could be finalized between confirmation
            // and the write, leaving only part of the cycle corrected.
            $this->lockFinancialDocuments($sessionId);
            $preview = $this->preview($session, $newDuration);
            if (! $preview['can_change']) {
                throw ValidationException::withMessages([
                    'duration_minutes' => [$this->blockedMessage($preview['blockers'])],
                ]);
            }

            $before = (int) $session->duration_minutes;
            if ($before === $newDuration) {
                return $preview;
            }

            DB::table('sessions')->where('id', $sessionId)->update([
                'duration_minutes' => $newDuration,
                'updated_at' => now(),
            ]);

            if ($preview['invoice'] !== null) {
                $this->updateInvoice($session, $preview['invoice'], $actorUserId, $actorRole);
            }
            if ($preview['package'] !== null) {
                $this->updatePackage($session, $preview['package'], $newDuration, $actorUserId, $actorRole);
            }
            if ($preview['payout'] !== null) {
                $this->updatePayout($session, $preview['payout'], $actorUserId, $actorRole);
            }

            Audit::log(
                'session.duration_changed',
                'session',
                $sessionId,
                (string) $session->academy_id,
                $actorUserId,
                $actorRole,
                after: [
                    'duration_minutes' => $newDuration,
                    'invoice' => $preview['invoice'],
                    'package' => $preview['package'],
                    'payout' => $preview['payout'],
                ],
                before: ['duration_minutes' => $before],
            );

            return $preview;
        });
    }

    private function lockFinancialDocuments(string $sessionId): void
    {
        $invoiceId = DB::table('invoice_line_items')->where('session_id', $sessionId)->value('invoice_id');
        if ($invoiceId !== null) {
            DB::table('invoices')->where('id', $invoiceId)->lockForUpdate()->first();
        }

        $packageId = DB::table('lesson_package_credits')->where('session_id', $sessionId)->value('package_id');
        if ($packageId !== null) {
            DB::table('lesson_packages')->where('id', $packageId)->lockForUpdate()->first();
        }

        $payoutId = DB::table('payout_line_items')->where('session_id', $sessionId)->value('payout_id');
        if ($payoutId !== null) {
            DB::table('payouts')->where('id', $payoutId)->lockForUpdate()->first();
        }
    }

    /** @param array<string,mixed> $effect */
    private function updateInvoice(object $session, array $effect, ?string $actorUserId, ?string $actorRole): void
    {
        DB::table('invoice_line_items')->where('session_id', $session->id)->update([
            'amount_minor' => $effect['amount_after'],
        ]);

        $total = (int) DB::table('invoice_line_items')
            ->where('invoice_id', $effect['invoice_id'])
            ->sum('amount_minor');
        DB::table('invoices')->where('id', $effect['invoice_id'])->update([
            'subtotal_minor' => $total,
            'total_minor' => $total,
            'updated_at' => now(),
        ]);

        Audit::log(
            'invoice.session_duration_repriced',
            'invoice',
            $effect['invoice_id'],
            (string) $session->academy_id,
            $actorUserId,
            $actorRole,
            after: ['session_id' => (string) $session->id, 'amount_minor' => $effect['amount_after']],
            before: ['amount_minor' => $effect['amount_before']],
        );
    }

    /** @param array<string,mixed> $effect */
    private function updatePackage(object $session, array $effect, int $newDuration, ?string $actorUserId, ?string $actorRole): void
    {
        $package = DB::table('lesson_packages')->where('id', $effect['package_id'])->first();
        if ($package === null) {
            return;
        }

        $creditOverdrawn = (int) $effect['credit_overdrawn_after'];
        $creditAmount = (int) round((int) $package->hourly_rate_minor * $creditOverdrawn / 60);
        $date = Carbon::parse($session->scheduled_at_utc)->toDateString();
        $description = $this->packages->humanHours($newDuration).' — '.$date;
        if ($creditOverdrawn > 0) {
            $description .= ' ('.$this->packages->humanHours($creditOverdrawn).' beyond the package)';
        }

        DB::table('lesson_package_credits')->where('session_id', $session->id)->update([
            'minutes' => $newDuration,
            'minutes_overdrawn' => $creditOverdrawn,
            'amount_minor' => $creditAmount,
            'description' => $description,
        ]);
        DB::table('lesson_packages')->where('id', $effect['package_id'])->update([
            'minutes_consumed' => $effect['consumed_after'],
            'minutes_overdrawn' => $effect['overdrawn_after'],
            'updated_at' => now(),
        ]);

        if ($effect['will_complete']) {
            $this->packages->complete((string) $effect['package_id'], 'EXHAUSTED', $actorUserId, $actorRole);
        }
    }

    /** @param array<string,mixed> $effect */
    private function updatePayout(object $session, array $effect, ?string $actorUserId, ?string $actorRole): void
    {
        $delta = (int) $effect['amount_after'] - (int) $effect['amount_before'];
        DB::table('payout_line_items')->where('session_id', $session->id)->update([
            'amount_minor' => $effect['amount_after'],
        ]);
        if ($delta !== 0) {
            $operator = $delta > 0 ? '+' : '-';
            DB::table('payouts')->where('id', $effect['payout_id'])->update([
                'total_minor' => DB::raw('total_minor '.$operator.' '.abs($delta)),
                'updated_at' => now(),
            ]);
        }

        app(TeacherQuality::class)->syncPayout((string) $effect['payout_id']);

        Audit::log(
            'payout.session_duration_repriced',
            'payout',
            $effect['payout_id'],
            (string) $session->academy_id,
            $actorUserId,
            $actorRole,
            after: ['session_id' => (string) $session->id, 'amount_minor' => $effect['amount_after']],
            before: ['amount_minor' => $effect['amount_before']],
        );
    }

    /** @param list<string> $blockers */
    private function blockedMessage(array $blockers): string
    {
        if (in_array('NOT_ATTENDED', $blockers, true)) {
            return 'Only an attended lesson can be corrected here. / لا يمكن تصحيح المدة هنا إلا لحصة حضرها الطالب.';
        }
        if (in_array('INVOICE_LOCKED', $blockers, true)) {
            return 'The invoice is closed or paid, so this lesson duration is locked. / الفاتورة مغلقة أو مدفوعة، لذلك مدة الحصة مقفلة.';
        }
        if (in_array('PAYOUT_FINALIZED', $blockers, true)) {
            return 'The teacher payout is finalized, so this lesson duration is locked. / تم اعتماد راتب المدرس، لذلك مدة الحصة مقفلة.';
        }

        return 'The package is completed, so this lesson duration is locked. / اكتملت الباقة، لذلك مدة الحصة مقفلة.';
    }

    private function isFreeTrial(string $sessionId): bool
    {
        $values = DB::table('session_reports')->where('session_id', $sessionId)->value('values');
        $decoded = is_string($values) ? json_decode($values, true) : (array) ($values ?? []);

        return (bool) ($decoded['is_free_trial'] ?? false);
    }
}
