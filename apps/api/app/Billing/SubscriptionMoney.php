<?php

declare(strict_types=1);

namespace App\Billing;

use App\Services\CentreSubscriptions;
use App\Services\LessonPackages;
use Illuminate\Support\Facades\DB;

/**
 * A centre's private lesson: counted on the student's subscription ({@see CentreSubscriptions}),
 * never priced by the hour.
 *
 * A student whose billing says monthly (PER_HOUR, PER_SESSION, PER_MONTH, FREE) is left to the
 * monthly path exactly as before — a centre may still have one. A student with no subscription row
 * at all, or one on PER_PACKAGE (the old block billing), is the centre engine's: the lesson is
 * counted on their open block, or flagged outside any block. It is ALWAYS handled — the centre
 * never bills a lesson by the hour because nothing was sold (rule 2: no hourly fallback).
 */
final class SubscriptionMoney implements LessonMoney
{
    public function __construct(private readonly CentreSubscriptions $subscriptions) {}

    public function onBillable(object $session): bool
    {
        if ($this->billedMonthly((string) $session->student_id)) {
            return false;
        }
        $this->subscriptions->count($session);

        return true;
    }

    public function onUnbilled(object $session): bool
    {
        // A lesson counted (or flagged) by the centre engine is undone there; one that was never
        // there belongs to the monthly path, whose line it is.
        return $this->subscriptions->uncount($session);
    }

    private function billedMonthly(string $studentId): bool
    {
        $basis = DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('start_date')
            ->value('price_basis');

        return $basis !== null && (string) $basis !== LessonPackages::BASIS;
    }
}
