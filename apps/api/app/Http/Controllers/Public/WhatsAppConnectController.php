<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Http\Controllers\Controller;
use App\Services\Whatsapp\GatewayAdminClient;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The public, no-login "connect your WhatsApp" flow (docs/whatsapp-api). A Super Admin mints a
 * shareable link for an academy; the client opens /wa-connect/{token}, this controller starts a
 * gateway session and returns the pairing QR, and the client scans it from their phone.
 *
 * The request carries NO tenant context, so the token → academy resolution goes through the
 * BYPASSRLS reader app.wa_connect_academy_by_token (non-expired links only). The gateway session
 * bookkeeping then runs inside that academy's tenant context (transaction-local GUCs), mirroring the
 * Super-Admin whatsappConnect flow but authorized purely by possession of the (hashed, expiring) link.
 */
final class WhatsAppConnectController extends Controller
{
    public function __construct(private readonly GatewayAdminClient $gateway) {}

    /** POST /wa/connect/{token}/start — start a gateway session and return the first QR. */
    public function start(string $token): JsonResponse
    {
        $academyId = $this->resolveAcademy($token);

        $created = $this->gateway->createSession($academyId);
        if (! $created['ok'] || ($created['token'] ?? null) === null || ($created['session_id'] ?? null) === null) {
            return response()->json(['error' => 'gateway_unavailable', 'message' => 'The WhatsApp service is temporarily unavailable.'], 502);
        }

        $this->inAcademyContext($academyId, function () use ($academyId, $created) {
            $this->ensureRow($academyId);
            DB::table('academy_automation_settings')->where('academy_id', $academyId)->update([
                'wasender_token' => Crypt::encryptString((string) $created['token']),
                'wa_session_id' => (string) $created['session_id'],
                'wasender_session_status' => 'QR',
                'updated_at' => now(),
            ]);
        });

        $qr = $this->gateway->getQr((string) $created['session_id']);

        return response()->json([
            'state' => $qr['state'] ?? 'qr',
            'qr' => $qr['qr'] ?? null,
        ]);
    }

    /** GET /wa/connect/{token}/qr — poll the pairing QR + state. */
    public function qr(string $token): JsonResponse
    {
        $academyId = $this->resolveAcademy($token);
        $sessionId = $this->waSessionId($academyId);
        if ($sessionId === null) {
            return response()->json(['state' => 'disconnected', 'qr' => null]);
        }
        $qr = $this->gateway->getQr($sessionId);

        return response()->json(['state' => $qr['state'] ?? 'disconnected', 'qr' => $qr['qr'] ?? null]);
    }

    /** GET /wa/connect/{token}/status — live session status from the gateway. */
    public function status(string $token): JsonResponse
    {
        $academyId = $this->resolveAcademy($token);
        $sessionId = $this->waSessionId($academyId);
        if ($sessionId === null) {
            return response()->json(['state' => 'disconnected']);
        }
        $status = $this->gateway->getStatus($sessionId);

        return response()->json($status['ok'] ? $status : ['state' => 'disconnected']);
    }

    /** Resolve a plaintext connect token to its academy, or 404 for an unknown/expired link. */
    private function resolveAcademy(string $token): string
    {
        $hash = hash('sha256', $token);
        $academyId = DB::selectOne('select app.wa_connect_academy_by_token(?) as a', [$hash])->a ?? null;

        if ($academyId === null) {
            abort(404, 'This link is invalid or has expired.');
        }

        return (string) $academyId;
    }

    /** The academy's gateway session id (read within tenant context), or null when not connected. */
    private function waSessionId(string $academyId): ?string
    {
        return $this->inAcademyContext($academyId, function () use ($academyId): ?string {
            $row = DB::table('academy_automation_settings')->where('academy_id', $academyId)->first(['wa_session_id']);
            $sid = $row->wa_session_id ?? null;

            return $sid !== null && $sid !== '' ? (string) $sid : null;
        });
    }

    private function ensureRow(string $academyId): void
    {
        if (DB::table('academy_automation_settings')->where('academy_id', $academyId)->exists()) {
            return;
        }
        DB::table('academy_automation_settings')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Run $fn inside the academy's tenant context (transaction-local GUCs). No user behind the request
     * — userId is null; RLS on academy_automation_settings only checks app.current_academy_id().
     *
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        return DB::transaction(function () use ($academyId, $fn) {
            TenantContext::apply(userId: null, academyId: $academyId, role: 'API_CLIENT', local: true);

            return $fn();
        });
    }
}
