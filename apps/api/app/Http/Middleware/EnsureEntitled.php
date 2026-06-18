<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\AuthContext;
use App\Support\Entitlement;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The plan-gate route middleware (Sprint 9 §4.3) — `entitled:feature.key`, the parallel of
 * the `can:` Gate but for the business model rather than RBAC. Runs AFTER tenant.context, so
 * the request-scoped AuthContext (and therefore the academy + its plan) is already resolved.
 *
 * On a miss it returns a DISTINCT "upgrade required" response — HTTP 402 with an
 * `error: "upgrade_required"` payload — NOT a 403. This is the layer that keeps "your plan
 * doesn't include this" (an upsell) visually and semantically separate from "you're not
 * allowed" (a forbidden), which is the §3.2 / AC-9.5 design contract. Permission (403) is
 * still enforced independently by Gate::authorize in the controller.
 */
final class EnsureEntitled
{
    public function handle(Request $request, Closure $next, string $featureKey): Response
    {
        // No context (unauthenticated / no role) → let the auth layers answer; we never
        // upsell an anonymous caller.
        if (! app()->bound(AuthContext::class)) {
            return $next($request);
        }

        $ctx = app(AuthContext::class);

        if (Entitlement::check($ctx, $featureKey)) {
            return $next($request);
        }

        $resolved = $ctx->academyId !== null ? Entitlement::resolve($ctx->academyId) : null;

        return new JsonResponse([
            'error' => 'upgrade_required',
            'message' => 'This feature is not included in your current plan.',
            'feature' => $featureKey,
            'plan' => $resolved['plan'] ?? null,
            'upgrade' => [
                'feature' => $featureKey,
                'currentPlan' => $resolved['plan'] ?? null,
            ],
        ], 402);
    }
}
