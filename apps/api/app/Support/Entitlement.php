<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Plan/tier feature gating — the `$user->can()` of the business model (Sprint 9 §3.1).
 *
 * Where AuthContext::can() answers "is this ROLE allowed?" (RBAC), Entitlement answers
 * "does this ACADEMY's PLAN include it?" (revenue). A gated feature requires BOTH; the two
 * layers stay separate so "you can't" (403 forbidden) never gets confused with "your plan
 * doesn't include this" (402 upgrade) — different message, different UX (§3.2, AC-9.5).
 *
 * Resolution (§4.1): granted = plan.capabilities ∪ {feature_key of each ACTIVE add-on}.
 *   - An unknown / misconfigured capability key ⇒ false. Capabilities FAIL CLOSED (§3.3,
 *     AC-9.4): a typo or a plan that forgot to list a feature locks it, never silently
 *     unlocks it.
 *   - A numeric limit that the plan does not define ⇒ unlimited. Limits FAIL OPEN: a plan
 *     only constrains what it explicitly caps, so an academy on an uncapped/legacy plan is
 *     never accidentally blocked from adding its 1st student.
 *
 * Plans are DATA, never code (§3.1): nothing here hardcodes a plan code. Moving a feature
 * between tiers is a `plans.features` edit, not a deploy (TC-9.5).
 *
 * `plans.features` shape (documented in the Sprint-9 migration):
 *   { "capabilities": string[], "limits": { "maxStudents"?: number|null, ... } }
 */
final class Entitlement
{
    /**
     * Does this academy's plan (∪ its active add-ons) include $featureKey?
     * Fails closed: no academy / no plan / unknown key ⇒ false.
     */
    public static function check(AuthContext $ctx, string $featureKey): bool
    {
        if ($ctx->academyId === null) {
            return false; // a Super Admin with no entered academy has no plan → fail closed
        }

        return in_array($featureKey, self::resolve($ctx->academyId)['capabilities'], true);
    }

    /**
     * Is $currentCount below the plan's numeric cap for $limitKey?
     * An absent / null limit is unlimited (fail open); the academy can still add one more
     * while strictly under the cap (the cap is the count it may NOT exceed).
     */
    public static function withinLimit(AuthContext $ctx, string $limitKey, int $currentCount): bool
    {
        if ($ctx->academyId === null) {
            return true; // no tenant scope to cap (Super Admin platform context)
        }

        $limit = self::resolve($ctx->academyId)['limits'][$limitKey] ?? null;

        if ($limit === null) {
            return true; // unlimited
        }

        return $currentCount < (int) $limit;
    }

    /**
     * The plan's numeric cap for $limitKey, or null when unlimited/undefined.
     * Exposed so callers can surface the cap in an at-limit upgrade message.
     */
    public static function limit(AuthContext $ctx, string $limitKey): ?int
    {
        if ($ctx->academyId === null) {
            return null;
        }

        $limit = self::resolve($ctx->academyId)['limits'][$limitKey] ?? null;

        return $limit === null ? null : (int) $limit;
    }

    /**
     * The fully-resolved entitlement for an academy: the union of capabilities and the plan's
     * limit map, plus the plan code for display. Shape consumed by GET /api/entitlements and
     * the UI gating layer.
     *
     * @return array{plan: ?string, capabilities: list<string>, limits: array<string,mixed>, addOns: list<string>}
     */
    public static function resolve(string $academyId): array
    {
        $plan = DB::table('academies as a')
            ->leftJoin('plans as p', 'p.id', '=', 'a.plan_id')
            ->where('a.id', $academyId)
            ->first(['p.code as plan_code', 'p.features']);

        $features = self::decodeFeatures($plan->features ?? null);

        // Active add-ons unlock their feature_key on top of the plan (§4.1, AC-9.3).
        $addOnKeys = DB::table('academy_addons as aa')
            ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
            ->where('aa.academy_id', $academyId)
            ->where('aa.is_active', true)
            ->pluck('ao.feature_key')
            ->all();

        $capabilities = array_values(array_unique(array_merge(
            $features['capabilities'],
            array_map('strval', $addOnKeys),
        )));

        // Platform kill-switch layer (Phase 6): a feature_flags row with enabled=false removes
        // that capability platform-wide, even when the plan or an add-on grants it. Absent flag
        // ⇒ no effect (governed purely by the plan). Catalog reads are shared (RLS using true).
        $disabled = DB::table('feature_flags')->where('enabled', false)->pluck('key')->all();
        if ($disabled !== []) {
            $capabilities = array_values(array_diff($capabilities, $disabled));
        }

        return [
            'plan' => $plan->plan_code ?? null,
            'capabilities' => $capabilities,
            'limits' => $features['limits'],
            'addOns' => array_values(array_map('strval', $addOnKeys)),
        ];
    }

    /**
     * Normalise the stored `features` JSON into the documented shape, tolerating absent or
     * legacy values. Anything we can't read becomes empty capabilities + no limits (fail
     * closed on capabilities, unlimited on limits).
     *
     * @return array{capabilities: list<string>, limits: array<string,mixed>}
     */
    private static function decodeFeatures(mixed $raw): array
    {
        $decoded = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);

        if (! is_array($decoded)) {
            return ['capabilities' => [], 'limits' => []];
        }

        $capabilities = [];
        if (isset($decoded['capabilities']) && is_array($decoded['capabilities'])) {
            $capabilities = array_values(array_filter(
                array_map('strval', $decoded['capabilities']),
                static fn (string $c): bool => $c !== '',
            ));
        }

        $limits = (isset($decoded['limits']) && is_array($decoded['limits'])) ? $decoded['limits'] : [];

        return ['capabilities' => $capabilities, 'limits' => $limits];
    }
}
