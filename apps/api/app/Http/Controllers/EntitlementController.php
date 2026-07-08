<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AuthContext;
use App\Support\Entitlement;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * GET /api/entitlements (Sprint 9 §8) — the resolved plan capabilities + numeric limits for
 * the current academy, so the UI can gate features client-side (lock states, at-limit upsell)
 * the same way the server gates them (Entitlement / `entitled:` middleware). Authenticated;
 * no special capability — every signed-in user may read what their own academy's plan unlocks.
 *
 * For numeric limits we also return the academy's CURRENT counts (students, teachers), so the
 * UI can show "27 / 30" and disable the add action before the create-time 402 ever fires.
 */
final class EntitlementController extends Controller
{
    public function index(): JsonResponse
    {
        $ctx = app(AuthContext::class);

        // A Super Admin outside any academy has no plan to resolve — return an explicit
        // "no academy scope" payload rather than a misleading empty plan.
        if ($ctx->academyId === null) {
            return response()->json([
                'plan' => null,
                'capabilities' => [],
                'limits' => [],
                'addOns' => [],
                'modules' => [],
                'usage' => [],
            ]);
        }

        $resolved = Entitlement::resolve($ctx->academyId);

        $usage = [
            'students' => (int) DB::table('students')->whereNull('deleted_at')->count(),
            'teachers' => (int) DB::table('teachers')->whereNull('deleted_at')->count(),
        ];

        return response()->json([
            'plan' => $resolved['plan'],
            'capabilities' => $resolved['capabilities'],
            'limits' => $resolved['limits'],
            'addOns' => $resolved['addOns'],
            // Phase 2b: which product modules this client has (empty on the legacy fallback path).
            'modules' => $resolved['modules'] ?? [],
            'usage' => $usage,
        ]);
    }
}
