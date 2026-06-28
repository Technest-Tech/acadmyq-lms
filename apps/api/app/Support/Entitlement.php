<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Carbon;
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

        return self::limitFor($ctx->academyId, $limitKey);
    }

    /**
     * The plan's numeric cap for $limitKey by academy id — for the public token paths (join,
     * recording-by-host-link) that carry no AuthContext but resolve the academy from the room token.
     * null ⇒ unlimited/undefined.
     */
    public static function limitFor(string $academyId, string $limitKey): ?int
    {
        $limit = self::resolve($academyId)['limits'][$limitKey] ?? null;

        return $limit === null ? null : (int) $limit;
    }

    /**
     * A boolean plan flag (stored in features.limits as 1/0). FAILS OPEN: an absent flag ⇒ allowed,
     * so a plan only ever DISABLES a feature by explicitly setting it to 0. Same semantics whether
     * resolved from an AuthContext or directly by academy id (token paths).
     */
    public static function flag(AuthContext $ctx, string $key): bool
    {
        return $ctx->academyId === null ? true : self::flagFor($ctx->academyId, $key);
    }

    public static function flagFor(string $academyId, string $key): bool
    {
        $value = self::limitFor($academyId, $key);

        return $value === null || $value !== 0;
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
            ->first(['p.code as plan_code', 'p.features', 'a.video_access', 'a.video_trial_ends_at', 'a.video_plan_id', 'a.video_overrides']);

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

        // Per-academy video override (Super Admin "add academy to video / activate-deactivate /
        // trial" — Tier 2). It governs ONLY `video.conferencing`: force-ON adds it even when the
        // plan doesn't, force-OFF removes it even when the plan/add-on does, and an ENABLED grant
        // with a passed trial date auto-expires. NULL ⇒ follow the plan/add-on (no effect).
        $capabilities = self::applyVideoOverride($capabilities, $plan);

        // Platform kill-switch layer (Phase 6): a feature_flags row with enabled=false removes
        // that capability platform-wide, even when the plan or an add-on grants it. Absent flag
        // ⇒ no effect (governed purely by the plan). Catalog reads are shared (RLS using true).
        // Applied LAST so a platform-wide disable beats even a per-academy force-ON.
        $disabled = DB::table('feature_flags')->where('enabled', false)->pluck('key')->all();
        if ($disabled !== []) {
            $capabilities = array_values(array_diff($capabilities, $disabled));
        }

        // A per-academy video TIER drives only the video limit keys; every other limit still comes
        // from the academy's own plan (so a video grant never alters maxStudents, etc.).
        $limits = $features['limits'];
        if (! empty($plan->video_plan_id ?? null)) {
            $limits = self::mergeVideoLimits($limits, (string) $plan->video_plan_id);
        }

        // Free-form per-academy "meet options" override (Super Admin sets it in the video oversight
        // panel). Wins over BOTH the academy's plan and its video tier — but only for the video limit
        // keys, so it never alters maxStudents, etc.
        $limits = self::applyOverrideLimits($limits, $plan->video_overrides ?? null);

        return [
            'plan' => $plan->plan_code ?? null,
            'capabilities' => $capabilities,
            'limits' => $limits,
            'addOns' => array_values(array_map('strval', $addOnKeys)),
        ];
    }

    /**
     * Apply the per-academy video access override to the resolved capability set. Scoped to the
     * single `video.conferencing` key:
     *   - 'ENABLED' + no trial / future trial ⇒ force-ON (added even if absent).
     *   - 'ENABLED' + past trial               ⇒ force-OFF (the trial expired).
     *   - 'DISABLED'                           ⇒ force-OFF.
     *   - NULL                                 ⇒ no change (follow the plan/add-on).
     *
     * @param  list<string>  $capabilities
     * @return list<string>
     */
    private static function applyVideoOverride(array $capabilities, ?object $academy): array
    {
        $access = $academy->video_access ?? null;
        if ($access === null) {
            return $capabilities; // follow the plan/add-on
        }

        $on = false;
        if ($access === 'ENABLED') {
            $trialEnd = $academy->video_trial_ends_at ?? null;
            $on = $trialEnd === null || Carbon::parse($trialEnd)->isFuture();
        }

        // A video-only ("Meet Plan") academy exists SOLELY for the video classroom — its plan grants
        // video.conferencing as the entire product. A 'DISABLED' / expired-trial override must never
        // strip that, or the academy would be left with zero features (and the panel would lock its
        // only surface). To stop such an academy a Super Admin changes its plan or suspends it — the
        // video override cannot force video OFF here. (A normal video plan, e.g. PRO, can still be
        // disabled: it keeps its other features, so the governance kill-switch stays meaningful.)
        if (in_array('video.only', $capabilities, true)) {
            $on = true;
        }

        $capabilities = array_values(array_filter($capabilities, static fn (string $c): bool => $c !== 'video.conferencing'));
        if ($on) {
            $capabilities[] = 'video.conferencing';
        }

        return array_values($capabilities);
    }

    /**
     * Merge the video TIER's limit map over the base limits, but only the video limit/flag keys
     * (FeatureCatalog::VIDEO_LIMIT_KEYS). A key the tier doesn't set leaves the base value intact.
     *
     * @param  array<string,mixed>  $base
     * @return array<string,mixed>
     */
    private static function mergeVideoLimits(array $base, string $videoPlanId): array
    {
        $tier = self::decodeFeatures(DB::table('plans')->where('id', $videoPlanId)->value('features'))['limits'];

        foreach (FeatureCatalog::VIDEO_LIMIT_KEYS as $key) {
            if (array_key_exists($key, $tier)) {
                $base[$key] = $tier[$key];
            }
        }

        return $base;
    }

    /**
     * Apply the free-form per-academy video override (academies.video_overrides, shaped
     * { "limits": { maxRoomParticipants?: number, monitorAllowed?: 0|1, … } }) over the resolved
     * limits — only the FeatureCatalog::VIDEO_LIMIT_KEYS. A key the override omits leaves the base
     * value intact; a NULL/blank override is a no-op.
     *
     * @param  array<string,mixed>  $base
     * @return array<string,mixed>
     */
    private static function applyOverrideLimits(array $base, mixed $rawOverrides): array
    {
        if (! is_string($rawOverrides) && ! is_array($rawOverrides)) {
            return $base;
        }

        $override = self::decodeFeatures($rawOverrides)['limits'];

        foreach (FeatureCatalog::VIDEO_LIMIT_KEYS as $key) {
            if (array_key_exists($key, $override)) {
                $base[$key] = $override[$key];
            }
        }

        return $base;
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
