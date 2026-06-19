<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\PublicInvoiceToken;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Platform↔Academy subscription domain service. Owns the academy's SaaS subscription lifecycle
 * (trial window, activation, period, snapshot total cost) on the `academy_subscriptions` table —
 * the single writer of `total_cost_minor`.
 *
 * Every method assumes it runs INSIDE the target academy's tenant context (the caller wraps it in
 * AcademyController::inAcademyContext or a job's Tenancy::withContext) so the RLS `with check`
 * admits the writes. The service performs the DB mutations and returns the updated row; the CALLER
 * writes the audit entry (it knows the actor), matching the codebase convention.
 */
final class AcademyBilling
{
    /**
     * The academy's current (non-ENDED) subscription, creating one mirrored from the academy's
     * present plan/status if none exists yet (lazy backfill for academies predating this feature).
     */
    public function ensureSubscription(string $academyId): object
    {
        $existing = $this->currentSubscription($academyId);
        if ($existing !== null) {
            return $existing;
        }

        $academy = DB::table('academies')->where('id', $academyId)
            ->first(['id', 'status', 'plan_id', 'default_currency', 'created_at']);

        $now = now();
        $createdAt = $academy?->created_at !== null ? Carbon::parse($academy->created_at) : $now;
        $isTrial = ($academy->status ?? 'ACTIVE') === 'TRIAL';
        $trialDays = (int) config('billing.trial_days', 14);
        $currency = $this->currencyFor($academy);

        $id = (string) Str::uuid();
        DB::table('academy_subscriptions')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'plan_id' => $academy->plan_id ?? null,
            'status' => 'ACTIVE',
            'is_trial' => $isTrial,
            'trial_start' => $isTrial ? $createdAt : null,
            'trial_end' => $isTrial ? $createdAt->copy()->addDays($trialDays) : null,
            'activated_at' => $isTrial ? null : $createdAt,
            'billing_interval' => (string) config('billing.default_interval', 'MONTHLY'),
            'currency' => $currency,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->recomputeTotals($academyId);

        return $this->currentSubscription($academyId) ?? DB::table('academy_subscriptions')->where('id', $id)->first();
    }

    /** Read-only: the current (non-ENDED) subscription, or null. Never creates a row. */
    public function currentSubscription(string $academyId): ?object
    {
        return DB::table('academy_subscriptions')
            ->where('academy_id', $academyId)
            ->where('status', '<>', 'ENDED')
            ->orderByDesc('created_at')
            ->first();
    }

    /**
     * Recompute the snapshot cost = plan base price + active add-ons (same currency), and sync the
     * plan/currency onto the subscription. Called whenever plan/add-ons change and on activation.
     */
    public function recomputeTotals(string $academyId): object
    {
        $sub = $this->currentSubscription($academyId) ?? $this->ensureSubscription($academyId);

        $academy = DB::table('academies')->where('id', $academyId)->first(['plan_id', 'default_currency']);
        $plan = ($academy->plan_id ?? null) !== null
            ? DB::table('plans')->where('id', $academy->plan_id)->first(['price_minor', 'currency'])
            : null;

        $currency = $plan->currency ?? $academy->default_currency;
        $base = (int) ($plan->price_minor ?? 0);
        // Only sum add-ons priced in the same currency — never aggregate across currencies (no FX).
        $addons = (int) DB::table('academy_addons as aa')
            ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
            ->where('aa.academy_id', $academyId)
            ->where('aa.is_active', true)
            ->where('ao.currency', $currency)
            ->sum('ao.price_minor');

        DB::table('academy_subscriptions')->where('id', $sub->id)->update([
            'plan_id' => $academy->plan_id ?? null,
            'base_price_minor' => $base,
            'addons_price_minor' => $addons,
            'total_cost_minor' => $base + $addons,
            'currency' => $currency,
            'updated_at' => now(),
        ]);

        return DB::table('academy_subscriptions')->where('id', $sub->id)->first();
    }

    /** (Re)start a trial: marks the subscription as a live trial ending in $days (default config). */
    public function startTrial(string $academyId, ?int $days = null): object
    {
        $sub = $this->ensureSubscription($academyId);
        $days ??= (int) config('billing.trial_days', 14);
        $now = now();

        DB::table('academy_subscriptions')->where('id', $sub->id)->update([
            'is_trial' => true,
            'status' => 'ACTIVE',
            'trial_start' => $now,
            'trial_end' => $now->copy()->addDays($days),
            'updated_at' => $now,
        ]);

        return $this->recomputeTotals($academyId);
    }

    /** Extend the trial by $days from its current end (or now if already lapsed) and re-activate it. */
    public function extendTrial(string $academyId, int $days): object
    {
        $sub = $this->ensureSubscription($academyId);
        $base = $sub->trial_end !== null ? Carbon::parse($sub->trial_end) : now();
        if ($base->isPast()) {
            $base = now();
        }

        DB::table('academy_subscriptions')->where('id', $sub->id)->update([
            'is_trial' => true,
            'status' => 'ACTIVE',
            'trial_start' => $sub->trial_start ?? now(),
            'trial_end' => $base->copy()->addDays($days),
            'updated_at' => now(),
        ]);

        // A trial extension restores access for an academy parked on TRIAL/SUSPENDED.
        DB::table('academies')->where('id', $academyId)->update([
            'status' => 'TRIAL',
            'suspended_at' => null,
            'suspended_reason' => null,
            'updated_at' => now(),
        ]);

        return DB::table('academy_subscriptions')->where('id', $sub->id)->first();
    }

    /** Convert a trial (or paused) subscription to a live paid one and open the first period. */
    public function activate(string $academyId): object
    {
        $sub = $this->ensureSubscription($academyId);
        $now = now();
        $end = ($sub->billing_interval === 'YEARLY') ? $now->copy()->addYear() : $now->copy()->addMonth();

        DB::table('academy_subscriptions')->where('id', $sub->id)->update([
            'is_trial' => false,
            'status' => 'ACTIVE',
            'activated_at' => $sub->activated_at ?? $now,
            'current_period_start' => $now,
            'current_period_end' => $end,
            'updated_at' => $now,
        ]);

        DB::table('academies')->where('id', $academyId)->update([
            'status' => 'ACTIVE',
            'suspended_at' => null,
            'suspended_reason' => null,
            'updated_at' => $now,
        ]);

        return $this->recomputeTotals($academyId);
    }

    /**
     * Expire a lapsed trial: pause the subscription and (per config) suspend the academy so logins
     * are blocked until it converts. Idempotent — a no-op if the subscription isn't a live trial.
     *
     * @return array{expired: bool, suspended: bool}
     */
    public function expireTrial(string $academyId): array
    {
        $sub = $this->currentSubscription($academyId);
        if ($sub === null || ! $sub->is_trial || $sub->status !== 'ACTIVE') {
            return ['expired' => false, 'suspended' => false];
        }
        if ($sub->trial_end === null || Carbon::parse($sub->trial_end)->isFuture()) {
            return ['expired' => false, 'suspended' => false];
        }

        $now = now();
        DB::table('academy_subscriptions')->where('id', $sub->id)->update([
            'status' => 'PAUSED',
            'updated_at' => $now,
        ]);

        $suspend = (bool) config('billing.trial_expiry_suspends', true);
        if ($suspend) {
            DB::table('academies')->where('id', $academyId)->update([
                'status' => 'SUSPENDED',
                'suspended_at' => $now,
                'suspended_reason' => 'Trial expired',
                'updated_at' => $now,
            ]);
        }

        return ['expired' => true, 'suspended' => $suspend];
    }

    // ── Academy bills (Platform → Academy invoices) ──────────────────────────

    /**
     * Create the bill for a subscription period, idempotent on (academy, period). Returns the bill
     * id (existing or new), or null when the academy has no subscription to bill.
     */
    public function generateInvoiceForPeriod(string $academyId, Carbon $start, Carbon $end): ?string
    {
        $sub = $this->currentSubscription($academyId);
        if ($sub === null) {
            return null;
        }

        $find = fn () => DB::table('academy_invoices')
            ->where('academy_id', $academyId)
            ->whereDate('period_start', $start->toDateString())
            ->whereDate('period_end', $end->toDateString())
            ->value('id');

        $existing = $find();
        if ($existing !== null) {
            return (string) $existing;
        }

        $now = now();
        DB::table('academy_invoices')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'subscription_id' => $sub->id,
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'status' => 'OPEN',
            'currency' => $sub->currency,
            'subtotal_minor' => (int) $sub->total_cost_minor,
            'total_minor' => (int) $sub->total_cost_minor,
            'due_date' => $now->copy()->addDays((int) config('billing.due_days', 7))->toDateString(),
            'public_token' => PublicInvoiceToken::forAcademyId($academyId),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        // insertOrIgnore may have lost a race; re-read the canonical row id either way.
        $id = $find();

        return $id !== null ? (string) $id : null;
    }

    /** Generate the bill for the subscription's CURRENT period (manual Super Admin action). */
    public function generateCurrentBill(string $academyId): ?string
    {
        $sub = $this->ensureSubscription($academyId);
        if ($sub->is_trial) {
            return null; // a trial isn't billed
        }

        $start = $sub->current_period_start !== null
            ? Carbon::parse($sub->current_period_start)
            : now()->startOfDay();
        $end = $sub->current_period_end !== null
            ? Carbon::parse($sub->current_period_end)
            : ($sub->billing_interval === 'YEARLY' ? $start->copy()->addYear() : $start->copy()->addMonth());

        return $this->generateInvoiceForPeriod($academyId, $start, $end);
    }

    /**
     * Scheduled helper: ensure the current period is billed and roll the window forward once the
     * period has elapsed. Idempotent (period unique index). Returns the billed period's id or null.
     */
    public function rollAndBill(string $academyId): ?string
    {
        $sub = $this->currentSubscription($academyId);
        if ($sub === null || $sub->is_trial || $sub->status !== 'ACTIVE') {
            return null;
        }

        $now = now();

        // Open a first period for a paid subscription that has none yet.
        if ($sub->current_period_start === null || $sub->current_period_end === null) {
            $start = $now->copy();
            $end = $sub->billing_interval === 'YEARLY' ? $start->copy()->addYear() : $start->copy()->addMonth();
            DB::table('academy_subscriptions')->where('id', $sub->id)->update([
                'current_period_start' => $start,
                'current_period_end' => $end,
                'updated_at' => $now,
            ]);

            return $this->generateInvoiceForPeriod($academyId, $start, $end);
        }

        $start = Carbon::parse($sub->current_period_start);
        $end = Carbon::parse($sub->current_period_end);

        // Period still running — make sure its bill exists, don't roll yet.
        if ($end->isFuture()) {
            return $this->generateInvoiceForPeriod($academyId, $start, $end);
        }

        // Period elapsed: bill it, then advance one interval.
        $billId = $this->generateInvoiceForPeriod($academyId, $start, $end);
        $newEnd = $sub->billing_interval === 'YEARLY' ? $end->copy()->addYear() : $end->copy()->addMonth();
        DB::table('academy_subscriptions')->where('id', $sub->id)->update([
            'current_period_start' => $end,
            'current_period_end' => $newEnd,
            'updated_at' => $now,
        ]);

        return $billId;
    }

    /** Mark a bill fully paid (Super Admin or an approved payment submission). */
    public function markBillPaid(string $billId, string $method, ?string $reason): void
    {
        DB::table('academy_invoices')->where('id', $billId)->update([
            'status' => 'PAID',
            'payment_method' => $method,
            'payment_reason' => $reason,
            'amount_paid_minor' => DB::raw('total_minor'),
            'paid_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Set a bill's status directly (OPEN / OVERDUE / VOID / PAID). */
    public function setBillStatus(string $billId, string $status): void
    {
        DB::table('academy_invoices')->where('id', $billId)->update([
            'status' => $status,
            'paid_at' => $status === 'PAID' ? now() : null,
            'updated_at' => now(),
        ]);
    }

    /** Flip OPEN bills past their due date to OVERDUE for the current academy. Returns the count. */
    public function markOverdue(string $academyId): int
    {
        return DB::table('academy_invoices')
            ->where('academy_id', $academyId)
            ->where('status', 'OPEN')
            ->whereDate('due_date', '<', now()->toDateString())
            ->update(['status' => 'OVERDUE', 'updated_at' => now()]);
    }

    /** The academy owner's contact phone (recipient of bill sends/reminders), if any. */
    public function ownerPhone(string $academyId): ?string
    {
        $phone = DB::table('users as u')
            ->join('user_roles as ur', 'ur.user_id', '=', 'u.id')
            ->where('u.academy_id', $academyId)
            ->where('ur.role', 'ACADEMY_OWNER')
            ->whereNotNull('u.phone')
            ->orderBy('u.created_at')
            ->value('u.phone');

        return $phone !== null ? (string) $phone : null;
    }

    private function currencyFor(?object $academy): string
    {
        if ($academy === null) {
            return 'EGP';
        }
        if (($academy->plan_id ?? null) !== null) {
            $planCurrency = DB::table('plans')->where('id', $academy->plan_id)->value('currency');
            if ($planCurrency !== null) {
                return (string) $planCurrency;
            }
        }

        return (string) $academy->default_currency;
    }
}
