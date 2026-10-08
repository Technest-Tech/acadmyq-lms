<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Pairing an academy's WhatsApp number with the gateway — the one implementation behind every
 * "connect" button: the Super Admin panel, the public /wa-connect link, and the academy's own
 * Settings → WhatsApp tab.
 *
 * `start()` is idempotent on purpose. The gateway's create-session call logs the previous device
 * out (one session per academy), so a connect that blindly created a session unlinked a number that
 * was working fine: on 2026-10-03 a client re-opened their old /wa-connect link on their phone and
 * that page load alone logged them out — the "WhatsApp disconnects every 2-3 days" report. Now a
 * live session (connected, pairing, or reconnecting) is reported, never replaced; a new session is
 * made only when there is none, or the gateway says it is logged out or gone.
 *
 * Every DB touch runs under the caller's tenant context, because the three callers arrive with very
 * different ones (a Super Admin, an anonymous link holder, the academy's own staff).
 */
final class WhatsAppConnection
{
    public function __construct(private readonly GatewayAdminClient $gateway) {}

    /**
     * Pair the academy's number, or report the pairing already under way.
     *
     * @return array{state: string, qr: ?string, phone: ?string, session_id: string}
     *
     * @throws RuntimeException when the gateway cannot be reached (nothing is changed)
     */
    public function start(AuthContext $ctx): array
    {
        $academyId = $this->academyOf($ctx);
        $sessionId = $this->sessionId($ctx);

        if ($sessionId !== null) {
            $status = $this->gateway->getStatus($sessionId);
            if (! $status['ok'] && ! ($status['missing'] ?? false)) {
                // Unreachable is not "gone": creating now could unlink a healthy number the moment
                // the gateway comes back.
                throw new RuntimeException('gateway_unavailable');
            }
            if ($status['ok'] && ($status['state'] ?? null) !== 'logged_out') {
                return $this->snapshot($sessionId, $status);
            }
        }

        $created = $this->gateway->createSession($academyId);
        if (! $created['ok'] || ($created['token'] ?? null) === null || ($created['session_id'] ?? null) === null) {
            throw new RuntimeException('gateway_unavailable'.(($created['error'] ?? null) !== null ? ': '.$created['error'] : ''));
        }
        $newId = (string) $created['session_id'];

        Tenancy::withContext($ctx, function () use ($academyId, $created, $newId) {
            $this->ensureRow($academyId);
            DB::table('academy_automation_settings')->where('academy_id', $academyId)->update([
                // The gateway-minted bearer token is stored encrypted in the legacy column; the
                // WhatsAppSender seam reads it to deliver through our gateway.
                'wasender_token' => Crypt::encryptString((string) $created['token']),
                'wa_session_id' => $newId,
                'wasender_session_status' => 'QR',
                'updated_at' => now(),
            ]);
        });

        $qr = $this->gateway->getQr($newId);

        return ['state' => $qr['state'] ?? 'qr', 'qr' => $qr['qr'] ?? null, 'phone' => null, 'session_id' => $newId];
    }

    /**
     * Where the pairing stands right now, straight from the gateway (the stored status column lags).
     * A session the gateway no longer knows reads as `disconnected`, like no session at all.
     *
     * @return array{state: string, qr: ?string, phone: ?string, session_id: ?string, last_connected_at: ?string}
     */
    public function status(AuthContext $ctx): array
    {
        $sessionId = $this->sessionId($ctx);
        if ($sessionId === null) {
            return ['state' => 'disconnected', 'qr' => null, 'phone' => null, 'session_id' => null, 'last_connected_at' => null];
        }

        $status = $this->gateway->getStatus($sessionId);
        if (! $status['ok']) {
            return [
                'state' => ($status['missing'] ?? false) ? 'disconnected' : 'unknown',
                'qr' => null,
                'phone' => null,
                'session_id' => $sessionId,
                'last_connected_at' => null,
            ];
        }

        return $this->snapshot($sessionId, $status) + [
            'last_connected_at' => isset($status['lastConnectedAt']) ? (string) $status['lastConnectedAt'] : null,
        ];
    }

    /**
     * Unlink the number. The local token is cleared only once the gateway has really dropped the
     * session — clearing it regardless would strand a live socket nothing points at any more.
     *
     * @return bool false when the gateway could not be reached (nothing was changed)
     */
    public function logout(AuthContext $ctx): bool
    {
        $academyId = $this->academyOf($ctx);
        $sessionId = $this->sessionId($ctx);
        if ($sessionId !== null && ! $this->gateway->deleteSession($sessionId)) {
            return false;
        }

        Tenancy::withContext($ctx, function () use ($academyId) {
            $this->ensureRow($academyId);
            DB::table('academy_automation_settings')->where('academy_id', $academyId)->update([
                'wasender_token' => null,
                'wa_session_id' => null,
                'wasender_session_status' => null,
                'updated_at' => now(),
            ]);
        });

        return true;
    }

    /** The academy's current gateway session id, or null when it has never been paired. */
    public function sessionId(AuthContext $ctx): ?string
    {
        $academyId = $this->academyOf($ctx);

        return Tenancy::withContext($ctx, function () use ($academyId): ?string {
            $sid = DB::table('academy_automation_settings')->where('academy_id', $academyId)->value('wa_session_id');

            return $sid !== null && $sid !== '' ? (string) $sid : null;
        });
    }

    /**
     * A live session as the screens show it. While pairing, the current QR rides along so a caller
     * can render it without a second round-trip.
     *
     * @param  array<string,mixed>  $status
     * @return array{state: string, qr: ?string, phone: ?string, session_id: string}
     */
    private function snapshot(string $sessionId, array $status): array
    {
        $state = (string) ($status['state'] ?? 'disconnected');
        $qr = $state === 'qr' ? ($this->gateway->getQr($sessionId)['qr'] ?? null) : null;

        return ['state' => $state, 'qr' => $qr, 'phone' => self::phoneOf($status['phoneJid'] ?? null), 'session_id' => $sessionId];
    }

    /** "201001234567:12@s.whatsapp.net" → "201001234567". */
    private static function phoneOf(mixed $jid): ?string
    {
        if (! is_string($jid) || $jid === '') {
            return null;
        }
        $digits = preg_replace('/\D/', '', strtok($jid, ':@') ?: '');

        return $digits !== '' ? $digits : null;
    }

    private function academyOf(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            throw new RuntimeException('A WhatsApp connection belongs to an academy.');
        }

        return $ctx->academyId;
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
}
