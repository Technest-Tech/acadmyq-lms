<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Livekit\LivekitEgressClient;
use App\Services\Livekit\LivekitRoomClient;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\FeatureCatalog;
use App\Support\ModuleSubscriptionBackfill;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * Super Admin video oversight — Tier 1 (read-only governance for the self-hosted video platform;
 * docs/video-platform/08-ROOM-ACCESS-AND-MONITORING). Three reads, each gated by `platform.manage`:
 *
 *   - usage()      — cross-tenant usage dashboard (per-academy active rooms vs the plan's maxRooms,
 *                    recordings + storage + recording-hours, in-flight recordings).
 *   - compliance() — the platform-wide monitor & recording compliance feed (the sensitive video.*
 *                    audit actions: monitor_join, recording.start/delete, call_ended, mutes/removes,
 *                    knock_admit/deny, rotate_link), by academy/actor/time.
 *   - health()     — LiveKit + Egress + object-storage reachability + a concurrent-recording capacity
 *                    hint (the single box handles ~1–2 concurrent recordings — deployment doc).
 *
 * Every cross-tenant read goes through the audited SECURITY DEFINER escape hatches
 * (`app.admin_video_stats()`, `app.admin_video_audit()`) — never an RLS-bypassing ad-hoc query (a
 * direct query under a Super Admin's contextless RLS would simply return nothing). The functions
 * re-assert SUPER_ADMIN internally; this Gate is the first of the two layers.
 */
final class VideoOversightController extends Controller
{
    /** The single recording box comfortably handles ~1–2 concurrent egresses (deployment doc). */
    private const RECORDING_SOFT_LIMIT = 2;

    public function __construct(
        private readonly LivekitRoomClient $rooms,
        private readonly LivekitEgressClient $egress,
    ) {}

    /** GET /api/admin/video/usage — per-academy video usage + platform-wide totals. */
    public function usage(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $stats = json_decode(DB::selectOne('select app.admin_video_stats() as s')->s, true) ?: [];

        return response()->json([
            'academies' => $stats['academies'] ?? [],
            'totals' => $stats['totals'] ?? [],
        ]);
    }

    /**
     * GET /api/admin/video/academies/{id} — the per-academy video detail: effective access status,
     * subscription, usage stats, effective video limits, and the room list. Cross-tenant read via
     * the SECURITY DEFINER reader (404 when the academy doesn't exist).
     */
    public function academy(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $json = DB::selectOne('select app.admin_video_academy(?::uuid) as d', [$id])->d;
        if ($json === null) {
            abort(404, 'Academy not found.');
        }
        $data = json_decode($json, true);

        // Fold the free-form per-academy override into the effective video_limits the panel shows, and
        // expose it raw so the editor pre-fills. The cross-tenant stats reader doesn't carry the
        // override column, so read it in the academy's own context (where RLS admits the row).
        $raw = $this->inAcademyContext($id, fn () => DB::table('academies')->where('id', $id)->value('video_overrides'));
        $override = is_string($raw) ? (array) (json_decode($raw, true)['limits'] ?? []) : [];
        if (is_array($data['academy'] ?? null)) {
            $limits = (array) ($data['academy']['video_limits'] ?? []);
            foreach (FeatureCatalog::VIDEO_LIMIT_KEYS as $k) {
                if (array_key_exists($k, $override)) {
                    $limits[$k] = $override[$k];
                }
            }
            $data['academy']['video_limits'] = $limits;
            $data['academy']['video_overrides'] = $override === [] ? null : $override;
        }

        return response()->json($data);
    }

    /**
     * GET /api/admin/video/academies/{id}/rooms/{roomId}/logs — a room's cross-tenant access log
     * (sessions + audited events). The room must belong to {id} (else 404), so a Super Admin can't
     * reach another academy's room by guessing an id against the wrong academy.
     */
    public function roomLogs(string $id, string $roomId): JsonResponse
    {
        Gate::authorize('platform.manage');

        $json = DB::selectOne('select app.admin_video_room_logs(?::uuid) as d', [$roomId])->d;
        $data = $json !== null ? json_decode($json, true) : null;
        if ($data === null || (string) ($data['room']['academy_id'] ?? '') !== $id) {
            abort(404, 'Room not found.');
        }

        return response()->json($data);
    }

    /** GET /api/admin/video/plans — video-capable plans usable as a per-academy video tier. */
    public function plans(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $plans = DB::table('plans')->where('is_active', true)->orderBy('name')->get(['id', 'code', 'name', 'features']);

        $video = $plans->map(function (object $p): array {
            $features = (array) json_decode((string) ($p->features ?? '{}'), true);
            $caps = (array) ($features['capabilities'] ?? []);
            $limits = (array) ($features['limits'] ?? []);
            $options = array_intersect_key($limits, array_flip(FeatureCatalog::VIDEO_LIMIT_KEYS));

            return [
                'id' => (string) $p->id,
                'code' => (string) $p->code,
                'name' => (string) $p->name,
                'grants_video' => in_array('video.conferencing', array_map('strval', $caps), true),
                'options' => $options,
                'video_capable' => in_array('video.conferencing', array_map('strval', $caps), true) || $options !== [],
            ];
        })->filter(fn (array $p) => $p['video_capable'])->values();

        return response()->json(['plans' => $video]);
    }

    /**
     * POST /api/admin/video/academies/{id}/access — the per-academy video governance write (Tier 2):
     * activate / deactivate / grant-with-trial / extend-trial / revert-to-plan / set the video tier.
     * Sets the `academies.video_access` override (+ trial date + tier) that App\Support\Entitlement
     * always respects. Audited (`video.academy_access` — also surfaces in the compliance feed); the
     * write runs in the academy's tenant context so the `academies` policy admits it.
     */
    public function setAccess(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $current = DB::table('academies')->where('id', $id)
            ->first(['video_access', 'video_trial_ends_at', 'video_plan_id']);
        if ($current === null) {
            abort(404, 'Academy not found.');
        }

        $data = $request->validate([
            'action' => ['required', Rule::in(['enable', 'trial', 'extend_trial', 'disable', 'follow_plan', 'set_tier'])],
            'trial_days' => ['required_if:action,trial', 'required_if:action,extend_trial', 'nullable', 'integer', 'min:1', 'max:3650'],
            'video_plan_id' => ['nullable', 'uuid', Rule::exists('plans', 'id')],
            // Free-form per-academy "meet options" — present (even empty) ⇒ replace the override; an
            // all-blank payload clears it (revert to plan/tier); absent ⇒ leave it untouched.
            'overrides' => ['sometimes', 'nullable', 'array'],
            'overrides.maxRooms' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'overrides.maxRoomParticipants' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'overrides.recordingRetentionDays' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'overrides.recordingAllowed' => ['nullable', 'boolean'],
            'overrides.monitorAllowed' => ['nullable', 'boolean'],
        ]);

        $action = $data['action'];
        $update = ['updated_at' => now()];

        switch ($action) {
            case 'enable':
                $update['video_access'] = 'ENABLED';
                $update['video_trial_ends_at'] = null; // permanent
                break;
            case 'trial':
                $update['video_access'] = 'ENABLED';
                $update['video_trial_ends_at'] = now()->addDays((int) $data['trial_days']);
                break;
            case 'extend_trial':
                // Extend from the later of now and the current trial end (so extending an active
                // trial adds days; extending a lapsed one restarts from today).
                $base = ($current->video_trial_ends_at !== null && now()->lt($current->video_trial_ends_at))
                    ? Carbon::parse($current->video_trial_ends_at)
                    : now();
                $update['video_access'] = 'ENABLED';
                $update['video_trial_ends_at'] = $base->addDays((int) $data['trial_days']);
                break;
            case 'disable':
                $update['video_access'] = 'DISABLED';
                $update['video_trial_ends_at'] = null;
                break;
            case 'follow_plan':
                $update['video_access'] = null;
                $update['video_trial_ends_at'] = null;
                break;
            case 'set_tier':
                // Only the tier changes; access/trial untouched.
                break;
        }

        // The video tier (options) is applied whenever the request carries the key — covers both the
        // "add academy to video with a tier" flow and a standalone set_tier.
        if ($request->has('video_plan_id')) {
            $update['video_plan_id'] = $data['video_plan_id'] ?? null;
        }

        // Per-academy meet-option override → academies.video_overrides ({ "limits": {...} }). Only the
        // video limit/flag keys are kept; an all-empty payload clears the override.
        if ($request->has('overrides')) {
            $ov = (array) ($data['overrides'] ?? []);
            $limits = [];
            foreach (['maxRooms', 'maxRoomParticipants', 'recordingRetentionDays'] as $k) {
                if (isset($ov[$k]) && $ov[$k] !== '' && $ov[$k] !== null) {
                    $limits[$k] = (int) $ov[$k];
                }
            }
            foreach (['recordingAllowed', 'monitorAllowed'] as $k) {
                if (array_key_exists($k, $ov) && $ov[$k] !== null) {
                    $limits[$k] = filter_var($ov[$k], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
                }
            }
            $update['video_overrides'] = $limits === [] ? null : json_encode(['limits' => $limits]);
        }

        $ctx = app(AuthContext::class);
        $this->inAcademyContext($id, function () use ($id, $update, $current, $action, $ctx) {
            DB::table('academies')->where('id', $id)->update($update);

            // Phase 2b: fold the changed video access/tier/override into the academy's VIDEO module
            // subscription so the module-subscription resolver reads current state.
            ModuleSubscriptionBackfill::reconcile($id);

            Audit::log('video.academy_access', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: [
                    'action' => $action,
                    'video_access' => $update['video_access'] ?? $current->video_access,
                    'video_trial_ends_at' => array_key_exists('video_trial_ends_at', $update)
                        ? ($update['video_trial_ends_at']?->toIso8601String())
                        : $current->video_trial_ends_at,
                    'video_plan_id' => array_key_exists('video_plan_id', $update) ? $update['video_plan_id'] : $current->video_plan_id,
                ],
                before: [
                    'video_access' => $current->video_access,
                    'video_trial_ends_at' => $current->video_trial_ends_at,
                    'video_plan_id' => $current->video_plan_id,
                ]);
        });

        $json = DB::selectOne('select app.admin_video_academy(?::uuid) as d', [$id])->d;

        return response()->json(['ok' => true, 'academy' => $json !== null ? json_decode($json, true)['academy'] : null]);
    }

    /** Run $fn in the target academy's tenant context (SUPER_ADMIN) so its policies admit the write. */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(
            userId: $ctx->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        );

        return Tenancy::withContext($target, $fn);
    }

    /** GET /api/admin/video/compliance — the platform-wide monitor & recording compliance feed. */
    public function compliance(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $filters = $request->validate([
            'academy' => ['nullable', 'uuid'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);
        $limit = (int) ($filters['limit'] ?? 100);

        $data = json_decode(
            DB::selectOne('select app.admin_video_audit(?::uuid, ?, ?) as a', [
                $filters['academy'] ?? null,
                $limit,
                0,
            ])->a,
            true,
        ) ?: ['rows' => [], 'total' => 0];

        return response()->json([
            'rows' => $data['rows'] ?? [],
            'total' => $data['total'] ?? 0,
            'limit' => $limit,
        ]);
    }

    /**
     * GET /api/admin/video/health — live reachability of the video stack + a capacity hint. Each
     * probe is independently fault-tolerant (a structured `{ok:false}` rather than a thrown error),
     * so one service being down never fails the card. The capacity hint reads the live Egress active
     * count — the most accurate concurrent-recording signal (and it needs no DB round-trip).
     */
    public function health(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $livekit = $this->rooms->ping();
        $egress = $this->egress->ping();
        $storage = $this->storageHealth();

        $active = ($egress['ok'] ?? false) ? (int) ($egress['active'] ?? 0) : null;

        return response()->json([
            'livekit' => $livekit,
            'egress' => $egress,
            'storage' => $storage,
            'capacity' => [
                'active_recordings' => $active,
                'soft_limit' => self::RECORDING_SOFT_LIMIT,
                'level' => $active === null
                    ? 'unknown'
                    : ($active >= self::RECORDING_SOFT_LIMIT ? 'at_capacity' : ($active >= 1 ? 'busy' : 'idle')),
            ],
            'checked_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * Probe the S3-compatible object store that Egress uploads recordings to. Any HTTP answer — even
     * a 400/403 to an unauthenticated, unsigned root request — proves the endpoint is reachable; only
     * a transport (connection/TLS) failure means it is down. We never sign; this is a pure TCP/TLS
     * liveness check. Empty endpoint config ⇒ "not configured" (the stack is optional until provisioned).
     *
     * @return array{ok: bool, configured: bool, bucket?: string, status?: int, error: ?string}
     */
    private function storageHealth(): array
    {
        $endpoint = (string) config('services.livekit.s3_endpoint');
        $bucket = (string) config('services.livekit.s3_bucket');
        if ($endpoint === '') {
            return ['ok' => false, 'configured' => false, 'error' => 'not_configured'];
        }

        try {
            $res = Http::timeout(8)->get($endpoint);

            return ['ok' => true, 'configured' => true, 'bucket' => $bucket, 'status' => $res->status(), 'error' => null];
        } catch (Throwable) {
            return ['ok' => false, 'configured' => true, 'bucket' => $bucket, 'error' => 'transport_error'];
        }
    }
}
