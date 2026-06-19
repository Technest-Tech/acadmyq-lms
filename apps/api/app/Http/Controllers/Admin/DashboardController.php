<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin platform dashboard (admin panel — Phase 1). A single bundle that aggregates the
 * platform-wide signals a Super Admin lands on: academy counts by status, total people, plan
 * distribution, recurring revenue, the subscriptions about to lapse (trials + paid renewals),
 * the outstanding-bill and payment-proof review queues, plus the most recent audit events.
 * Like every cross-tenant read it goes through audited SECURITY DEFINER escape hatches (§3.4)
 * — `app.admin_dashboard_stats()`, `app.admin_billing_overview()`, `app.admin_subscription_overview()`
 * and `app.admin_audit()` — never an RLS-bypassing ad-hoc query. Authorization is two-layer:
 * the `academy.read` capability Gate here, RLS as the database backstop (the functions
 * re-assert SUPER_ADMIN internally).
 */
final class DashboardController extends Controller
{
    /** Subscriptions whose trial/period ends within this many days surface in the action feed. */
    private const ENDING_SOON_DAYS = 14;

    /** GET /api/admin/dashboard — platform KPI bundle + revenue, subscription signals & recent activity. */
    public function index(): JsonResponse
    {
        Gate::authorize('academy.read');

        $stats = json_decode(
            DB::selectOne('select app.admin_dashboard_stats() as s')->s,
            true,
        );

        // Last 8 platform-wide audit events (same curated projection the audit log uses).
        $recent = json_decode(
            DB::selectOne(
                'select app.admin_audit(null, null, null, null, null, ?, ?) as a',
                [8, 0],
            )->a,
            true,
        );

        $billing = json_decode(
            DB::selectOne('select app.admin_billing_overview() as b')->b,
            true,
        );

        $subs = json_decode(
            DB::selectOne('select app.admin_subscription_overview() as s')->s,
            true,
        );

        return response()->json([
            'stats' => $stats,
            'recentActivity' => $recent['rows'] ?? [],
            'billing' => ['mrr' => $billing['mrr'] ?? []],
            'subscriptions' => $this->subscriptionSignals($subs),
        ]);
    }

    /**
     * Distil the (potentially large) per-academy subscription overview into the three
     * operational signals the dashboard renders: subscriptions ending soon, the outstanding
     * balance owed to the platform, and the pending payment-proof review queue.
     *
     * @param  array{academies?: list<array<string, mixed>>, pending_proofs?: list<array<string, mixed>>}  $subs
     * @return array<string, mixed>
     */
    private function subscriptionSignals(array $subs): array
    {
        $now = Carbon::now();
        $endingSoon = [];
        $outstandingByCurrency = [];
        $outstandingAcademies = 0;

        foreach ($subs['academies'] ?? [] as $a) {
            // Outstanding (OPEN/OVERDUE) bills owed to the platform, grouped by currency.
            $owed = (int) ($a['outstanding_minor'] ?? 0);
            if ($owed > 0) {
                $outstandingAcademies++;
                $cur = (string) ($a['currency'] ?? 'EGP');
                $outstandingByCurrency[$cur] = ($outstandingByCurrency[$cur] ?? 0) + $owed;
            }

            // Whichever clock is the live one: a running trial counts down to trial_end,
            // an activated subscription counts down to its current period end.
            $isTrial = (bool) ($a['is_trial'] ?? false);
            $endsAt = $isTrial ? ($a['trial_end'] ?? null) : ($a['current_period_end'] ?? null);
            if ($endsAt === null) {
                continue;
            }

            $end = Carbon::parse($endsAt);
            $daysLeft = (int) $now->copy()->startOfDay()->diffInDays($end->copy()->startOfDay(), false);
            if ($daysLeft > self::ENDING_SOON_DAYS) {
                continue; // too far out to be actionable
            }

            $endingSoon[] = [
                'academy_id' => $a['academy_id'] ?? null,
                'academy_name' => $a['academy_name'] ?? null,
                'plan_name' => $a['plan_name'] ?? null,
                'kind' => $isTrial ? 'trial' : 'renewal',
                'ends_at' => $endsAt,
                'days_left' => $daysLeft,
                'total_cost_minor' => (int) ($a['total_cost_minor'] ?? 0),
                'currency' => (string) ($a['currency'] ?? 'EGP'),
            ];
        }

        usort($endingSoon, static fn ($x, $y) => $x['days_left'] <=> $y['days_left']);

        $proofs = $subs['pending_proofs'] ?? [];

        return [
            'endingSoon' => array_slice($endingSoon, 0, 8),
            'endingSoonCount' => count($endingSoon),
            'outstanding' => [
                'academies' => $outstandingAcademies,
                'totals' => array_map(
                    static fn ($cur, $amt) => ['currency' => $cur, 'amount_minor' => $amt],
                    array_keys($outstandingByCurrency),
                    array_values($outstandingByCurrency),
                ),
            ],
            'pendingProofs' => [
                'count' => count($proofs),
                'items' => array_slice($proofs, 0, 6),
            ],
        ];
    }
}
