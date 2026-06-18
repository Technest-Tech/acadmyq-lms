<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin platform dashboard (admin panel — Phase 1). A single read that aggregates the
 * platform-wide KPIs a Super Admin lands on: academy counts by status, total people, plan
 * distribution, plus the most recent audit events. Like every cross-tenant read it goes
 * through audited SECURITY DEFINER escape hatches (§3.4) — `app.admin_dashboard_stats()` for
 * the aggregates and `app.admin_audit()` for the recent trail — never an RLS-bypassing
 * ad-hoc query. Authorization is two-layer: the `academy.read` capability Gate here, RLS as
 * the database backstop (the functions re-assert SUPER_ADMIN internally).
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

        // Last 10 platform-wide audit events (same curated projection the audit log uses).
        $recent = json_decode(
            DB::selectOne(
                'select app.admin_audit(null, null, null, null, null, ?, ?) as a',
                [10, 0],
            )->a,
            true,
        );

        return response()->json([
            'stats' => $stats,
            'recentActivity' => $recent['rows'] ?? [],
        ]);
    }
}
