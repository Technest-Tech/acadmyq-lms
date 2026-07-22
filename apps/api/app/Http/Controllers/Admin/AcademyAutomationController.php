<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Whatsapp\GatewayAdminClient;
use App\Services\Whatsapp\WasenderClient;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Throwable;

/**
 * Super Admin per-academy WhatsApp automation configuration (gate `automation.manage`). Manages the
 * academy's Wasender token (stored ENCRYPTED; never returned — only `has_token` + a masked tail) and
 * the per-type automation toggles, isolated per academy. The token configured here is what the
 * WhatsAppSender seam uses to switch from the wa.me deep-link fallback to real Wasender delivery.
 */
final class AcademyAutomationController extends Controller
{
    public function __construct(
        private readonly WasenderClient $wasender,
        private readonly GatewayAdminClient $gateway,
        private readonly WhatsAppSender $sender,
    ) {}

    /** GET /admin/automation — cross-academy WhatsApp automation overview (status + send counts). */
    public function overview(): JsonResponse
    {
        Gate::authorize('automation.manage');

        $data = json_decode(DB::selectOne('select app.admin_automation_overview() as o')->o, true);

        return response()->json($data);
    }

    /** GET /admin/automation/activity — cross-academy recent WhatsApp send feed (Super Admin). */
    public function activity(Request $request): JsonResponse
    {
        Gate::authorize('automation.manage');

        $limit = max(1, min(200, (int) $request->query('limit', 50)));
        $data = json_decode(DB::selectOne('select app.admin_whatsapp_activity(?) as o', [$limit])->o, true);

        return response()->json($data);
    }

    /** GET /admin/automation/gateway/health — gateway up/down + session counts (System tab). */
    public function gatewayHealth(): JsonResponse
    {
        Gate::authorize('automation.manage');

        return response()->json($this->gateway->health());
    }

    /** GET /admin/automation/gateway/settings — current live send-pacing (rate-limit) settings. */
    public function gatewaySettings(): JsonResponse
    {
        Gate::authorize('automation.manage');

        return response()->json($this->gateway->getSettings());
    }

    /** PUT /admin/automation/gateway/settings — update the rate-limit knobs (applies live). */
    public function updateGatewaySettings(Request $request): JsonResponse
    {
        Gate::authorize('automation.manage');

        $data = $request->validate([
            'minIntervalMs' => ['sometimes', 'integer', 'min:0', 'max:600000'],
            'maxIntervalMs' => ['sometimes', 'integer', 'min:0', 'max:600000'],
            'dailyCap' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'warmupDays' => ['sometimes', 'integer', 'min:0', 'max:60'],
            'warmupDailyCap' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'warmupMinIntervalMs' => ['sometimes', 'integer', 'min:0', 'max:600000'],
            'warmupMaxIntervalMs' => ['sometimes', 'integer', 'min:0', 'max:600000'],
        ]);
        $ctx = app(AuthContext::class);

        $res = $this->gateway->updateSettings($data);
        Audit::log('whatsapp.settings_updated', 'platform', null, null, $ctx->userId, 'SUPER_ADMIN', after: array_keys($data));

        return response()->json($res);
    }

    /** GET /admin/academies/{id}/automation — toggles + has_token + masked tail + session status. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $row = $this->inAcademyContext($id, fn () => $this->ensureRow($id));

        return response()->json(['automation' => $this->present($row)]);
    }

    /** PUT /admin/academies/{id}/automation — set the per-type toggles + optional config. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $data = $request->validate([
            'type1_billing_enabled' => ['sometimes', 'boolean'],
            'type2_lessons_enabled' => ['sometimes', 'boolean'],
            'type1_config' => ['sometimes', 'array'],
            'type2_config' => ['sometimes', 'array'],
        ]);
        $ctx = app(AuthContext::class);

        $row = $this->inAcademyContext($id, function () use ($id, $data, $ctx) {
            $this->ensureRow($id);

            $fields = [];
            foreach (['type1_billing_enabled', 'type2_lessons_enabled'] as $k) {
                if (array_key_exists($k, $data)) {
                    $fields[$k] = (bool) $data[$k];
                }
            }
            foreach (['type1_config', 'type2_config'] as $k) {
                if (array_key_exists($k, $data)) {
                    $fields[$k] = json_encode($data[$k]);
                }
            }

            if ($fields !== []) {
                DB::table('academy_automation_settings')->where('academy_id', $id)
                    ->update($fields + ['updated_at' => now()]);
                Audit::log('automation.settings_updated', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: array_keys($fields));
            }

            return $this->ensureRow($id);
        });

        return response()->json(['automation' => $this->present($row)]);
    }

    /** POST /admin/academies/{id}/automation/token — set/replace the Wasender token (encrypted). */
    public function setToken(Request $request, string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $data = $request->validate(['token' => ['required', 'string', 'min:8', 'max:500']]);
        $ctx = app(AuthContext::class);

        $row = $this->inAcademyContext($id, function () use ($id, $data, $ctx) {
            $this->ensureRow($id);
            DB::table('academy_automation_settings')->where('academy_id', $id)->update([
                'wasender_token' => Crypt::encryptString($data['token']),
                'updated_at' => now(),
            ]);
            // Audit records ONLY that a token was set — never the token itself.
            Audit::log('automation.token_set', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['token_set' => true]);

            return $this->ensureRow($id);
        });

        return response()->json(['automation' => $this->present($row)]);
    }

    /** DELETE /admin/academies/{id}/automation/token — clear the token (back to deep-link fallback). */
    public function clearToken(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        $row = $this->inAcademyContext($id, function () use ($id, $ctx) {
            $this->ensureRow($id);
            DB::table('academy_automation_settings')->where('academy_id', $id)->update([
                'wasender_token' => null,
                'wasender_session_status' => null,
                'updated_at' => now(),
            ]);
            Audit::log('automation.token_cleared', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['token_set' => false]);

            return $this->ensureRow($id);
        });

        return response()->json(['automation' => $this->present($row)]);
    }

    /** POST /admin/academies/{id}/automation/test — probe Wasender connectivity for the token. */
    public function test(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        $status = $this->inAcademyContext($id, function () use ($id, $ctx) {
            $row = $this->ensureRow($id);
            $token = $this->decryptToken($row->wasender_token);
            if ($token === null) {
                abort(422, 'No Wasender token configured for this academy.');
            }

            $status = $this->wasender->sessionStatus($token);
            DB::table('academy_automation_settings')->where('academy_id', $id)->update([
                'wasender_session_status' => $status,
                'updated_at' => now(),
            ]);
            Audit::log('automation.test', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['status' => $status]);

            return $status;
        });

        return response()->json(['status' => $status, 'ok' => $status !== null]);
    }

    /** GET /admin/academies/{id}/automation/log — the recent send log for this academy. */
    public function log(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $rows = $this->inAcademyContext($id, fn () => DB::table('automation_send_log')
            ->where('academy_id', $id)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get(['id', 'automation_type', 'transport', 'recipient_kind', 'recipient_phone', 'status', 'error', 'ref_type', 'created_at']));

        return response()->json(['log' => $rows]);
    }

    // ── self-hosted gateway: WhatsApp session lifecycle (replaces the Wasender dashboard) ──────

    /** POST /admin/academies/{id}/whatsapp/connect — start a gateway session; returns the first QR. */
    public function whatsappConnect(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        $created = $this->gateway->createSession($id);
        if (! $created['ok'] || ($created['token'] ?? null) === null || ($created['session_id'] ?? null) === null) {
            abort(502, 'WhatsApp gateway unavailable'.(($created['error'] ?? null) !== null ? ': '.$created['error'] : '.'));
        }

        $this->inAcademyContext($id, function () use ($id, $created, $ctx) {
            $this->ensureRow($id);
            DB::table('academy_automation_settings')->where('academy_id', $id)->update([
                // The gateway-minted bearer token is stored encrypted in the existing column; the
                // WhatsAppSender seam will read it to deliver via our gateway.
                'wasender_token' => Crypt::encryptString((string) $created['token']),
                'wa_session_id' => (string) $created['session_id'],
                'wasender_session_status' => 'QR',
                'updated_at' => now(),
            ]);
            Audit::log('whatsapp.session_connect', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['session_started' => true]);
        });

        $qr = $this->gateway->getQr((string) $created['session_id']);

        return response()->json([
            'session_id' => $created['session_id'],
            'state' => $qr['state'] ?? 'qr',
            'qr' => $qr['qr'] ?? null,
        ]);
    }

    /** GET /admin/academies/{id}/whatsapp/qr — poll the pairing QR + state (panel renders it). */
    public function whatsappQr(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $sessionId = $this->waSessionId($id);
        if ($sessionId === null) {
            return response()->json(['state' => 'disconnected', 'qr' => null]);
        }
        $qr = $this->gateway->getQr($sessionId);

        return response()->json(['state' => $qr['state'] ?? 'disconnected', 'qr' => $qr['qr'] ?? null]);
    }

    /** GET /admin/academies/{id}/whatsapp/status — live session status from the gateway. */
    public function whatsappStatus(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $sessionId = $this->waSessionId($id);
        if ($sessionId === null) {
            return response()->json(['state' => 'disconnected']);
        }
        $status = $this->gateway->getStatus($sessionId);

        return response()->json($status['ok'] ? $status : ['state' => 'disconnected']);
    }

    /** POST /admin/academies/{id}/whatsapp/logout — logout on the gateway + clear the local token. */
    public function whatsappLogout(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        // Only clear the local token once the gateway has actually dropped the session. Clearing it
        // regardless leaves the worst possible split: the gateway keeps a live, reconnecting socket for
        // a session nothing points at any more, while the academy loses the token it sends with — so
        // every send silently falls back to a deep link and the panel reports "not connected".
        $sessionId = $this->waSessionId($id);
        if ($sessionId !== null && ! $this->gateway->deleteSession($sessionId)) {
            return response()->json([
                'error' => 'gateway_unavailable',
                'message' => 'Could not log the session out on the WhatsApp service; nothing was changed. Please retry.',
            ], 502);
        }

        $this->inAcademyContext($id, function () use ($id, $ctx) {
            $this->ensureRow($id);
            DB::table('academy_automation_settings')->where('academy_id', $id)->update([
                'wasender_token' => null,
                'wa_session_id' => null,
                'wasender_session_status' => null,
                'updated_at' => now(),
            ]);
            Audit::log('whatsapp.session_logout', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['logged_out' => true]);
        });

        return response()->json(['ok' => true]);
    }

    /**
     * POST /admin/academies/{id}/whatsapp/send-test — send an ad-hoc test message through the seam
     * (transport WASENDER when connected, else a wa.me deep link). Logged to automation_send_log.
     */
    public function whatsappSendTest(Request $request, string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $data = $request->validate([
            'to' => ['required', 'string', 'min:6', 'max:32'],
            'text' => ['required', 'string', 'min:1', 'max:4096'],
        ]);
        $ctx = app(AuthContext::class);

        $result = $this->inAcademyContext($id, function () use ($id, $data, $ctx) {
            $res = $this->sender->sendOrLink($id, $data['to'], $data['text'], [
                'automation_type' => 'MANUAL',
                'recipient_kind' => 'ACADEMY_OWNER',
                'template_key' => 'manual_test',
            ]);
            Audit::log('whatsapp.test_send', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
                'transport' => $res['transport'],
                'sent' => $res['sent'],
            ]);

            return $res;
        });

        return response()->json([
            'ok' => $result['sent'],
            'transport' => $result['transport'],
            'error' => $result['error'],
            'deeplink' => $result['deeplink'],
        ]);
    }

    /** POST /admin/academies/{id}/whatsapp/check — is a number registered on WhatsApp? null = no session. */
    public function whatsappCheck(Request $request, string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $data = $request->validate(['to' => ['required', 'string', 'min:6', 'max:32']]);

        $exists = $this->inAcademyContext($id, function () use ($id, $data) {
            $row = DB::table('academy_automation_settings')->where('academy_id', $id)->first(['wasender_token']);
            $token = $this->decryptToken($row->wasender_token ?? null);
            if ($token === null) {
                return null;
            }

            return $this->wasender->onWhatsApp($token, $data['to']);
        });

        return response()->json(['exists' => $exists]);
    }

    // ── external API access: per-academy API keys + public connect link (docs/whatsapp-api) ────

    /** GET /admin/academies/{id}/api-keys — the academy's API keys (never the hash or plaintext). */
    public function listApiKeys(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $keys = $this->inAcademyContext($id, fn () => DB::table('whatsapp_api_keys')
            ->where('academy_id', $id)
            ->orderByDesc('created_at')
            ->get(['id', 'name', 'key_prefix', 'last_used_at', 'revoked_at', 'created_at']));

        return response()->json(['keys' => $keys]);
    }

    /**
     * POST /admin/academies/{id}/api-keys — mint a new API key. The plaintext is returned ONCE here
     * and never again; only its SHA-256 hash + a display prefix are stored.
     */
    public function createApiKey(Request $request, string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $data = $request->validate(['name' => ['required', 'string', 'min:1', 'max:80']]);
        $ctx = app(AuthContext::class);

        $plain = 'wa_'.Str::random(48);
        $prefix = substr($plain, 0, 11);
        $keyId = (string) Str::uuid();

        $this->inAcademyContext($id, function () use ($id, $data, $plain, $prefix, $keyId, $ctx) {
            DB::table('whatsapp_api_keys')->insert([
                'id' => $keyId,
                'academy_id' => $id,
                'name' => $data['name'],
                'key_prefix' => $prefix,
                'key_hash' => hash('sha256', $plain),
                'created_by' => $ctx->userId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            Audit::log('whatsapp.api_key_create', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['key_id' => $keyId, 'name' => $data['name']]);
        });

        return response()->json([
            'id' => $keyId,
            'name' => $data['name'],
            'key_prefix' => $prefix,
            // The one and only time the full key is exposed. The client must copy it now.
            'key' => $plain,
        ], 201);
    }

    /** DELETE /admin/academies/{id}/api-keys/{keyId} — revoke a key (soft; keeps the audit trail). */
    public function revokeApiKey(string $id, string $keyId): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        $updated = $this->inAcademyContext($id, function () use ($id, $keyId, $ctx) {
            $n = DB::table('whatsapp_api_keys')
                ->where('academy_id', $id)
                ->where('id', $keyId)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now(), 'updated_at' => now()]);
            if ($n > 0) {
                Audit::log('whatsapp.api_key_revoke', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['key_id' => $keyId]);
            }

            return $n;
        });

        if ($updated === 0) {
            abort(404, 'API key not found.');
        }

        return response()->json(['ok' => true]);
    }

    /**
     * POST /admin/academies/{id}/connect-link — mint a fresh, expiring public QR-connect link. Only
     * the token hash + expiry are stored, so regenerating invalidates the previous link. Returns the
     * relative path; the web app prepends its own origin.
     */
    public function createConnectLink(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        $token = Str::random(40);
        $expiresAt = now()->addHours(48);

        $this->inAcademyContext($id, function () use ($id, $token, $expiresAt, $ctx) {
            $this->ensureRow($id);
            DB::table('academy_automation_settings')->where('academy_id', $id)->update([
                'connect_token_hash' => hash('sha256', $token),
                'connect_token_expires_at' => $expiresAt,
                'updated_at' => now(),
            ]);
            Audit::log('whatsapp.connect_link_create', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['expires_at' => $expiresAt->toIso8601String()]);
        });

        return response()->json([
            'path' => '/wa-connect/'.$token,
            'expires_at' => $expiresAt->toIso8601String(),
        ], 201);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** The academy's gateway session id (read within tenant context), or null when not connected. */
    private function waSessionId(string $academyId): ?string
    {
        return $this->inAcademyContext($academyId, function () use ($academyId): ?string {
            $row = DB::table('academy_automation_settings')->where('academy_id', $academyId)->first(['wa_session_id']);
            $sid = $row->wa_session_id ?? null;

            return $sid !== null && $sid !== '' ? (string) $sid : null;
        });
    }

    /** Ensure (and return) the academy's automation settings row. */
    private function ensureRow(string $academyId): object
    {
        $row = DB::table('academy_automation_settings')->where('academy_id', $academyId)->first();
        if ($row !== null) {
            return $row;
        }

        DB::table('academy_automation_settings')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('academy_automation_settings')->where('academy_id', $academyId)->first();
    }

    /** Public-safe view — never the token, only whether one is set + a masked tail. */
    private function present(object $row): array
    {
        $token = $this->decryptToken($row->wasender_token);

        return [
            'type1_billing_enabled' => (bool) $row->type1_billing_enabled,
            'type2_lessons_enabled' => (bool) $row->type2_lessons_enabled,
            'type1_config' => json_decode((string) $row->type1_config, true) ?: [],
            'type2_config' => json_decode((string) $row->type2_config, true) ?: [],
            'wasender_session_status' => $row->wasender_session_status,
            'has_token' => $token !== null,
            'token_tail' => $token !== null ? substr($token, -4) : null,
        ];
    }

    private function decryptToken(?string $ciphertext): ?string
    {
        if ($ciphertext === null || $ciphertext === '') {
            return null;
        }
        try {
            return Crypt::decryptString($ciphertext);
        } catch (Throwable) {
            return null;
        }
    }

    private function assertAcademy(string $id): void
    {
        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }
    }

    /**
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
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
}
