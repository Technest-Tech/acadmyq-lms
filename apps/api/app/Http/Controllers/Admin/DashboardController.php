<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin platform dashboard (admin panel — Phase 1): academy counts by status, total people,
 * module distribution and the most recent audit events. Like every cross-tenant read it goes
 * through audited SECURITY DEFINER escape hatches (§3.4) — `app.admin_dashboard_stats()` and
 * `app.admin_audit()`. Money — recurring revenue, what is owed, payments and trials coming up,
 * proofs to review — is the accounts book's since 2026-11-08 and comes from
 * GET /admin/finance/dues, so the home and Accounts can never disagree.
 */
final class DashboardController extends Controller
{
    /** GET /api/admin/dashboard — platform KPI bundle + recent activity. */
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

        return response()->json([
            'stats' => $stats,
            'recentActivity' => $recent['rows'] ?? [],
        ]);
    }
}
