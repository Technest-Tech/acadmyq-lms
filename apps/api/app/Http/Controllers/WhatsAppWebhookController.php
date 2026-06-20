<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Receives signed webhooks from the self-hosted WhatsApp gateway (apps/wa-gateway). The HMAC is
 * verified by the `wa.webhook` middleware before we get here, so the payload is trusted. The gateway
 * is unauthenticated to Laravel (no Sanctum session), so writes to tenant tables run inside an
 * explicit academy context (Tenancy::withContext) keyed by the academyId in the payload.
 *
 * Events handled:
 *   • connection.update — mirror the session state onto academy_automation_settings; a LOGGED_OUT
 *     (device unlinked or banned) raises an operator alert (the human-re-scan signal).
 *   • message.status    — flip an automation_send_log row to FAILED when the gateway reports a send
 *     failure (the synchronous send already recorded SENT/optimistic).
 */
final class WhatsAppWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        $event = (string) $request->json('event', '');
        $academyId = (string) $request->json('academyId', '');
        $data = (array) $request->json('data', []);

        if ($academyId === '' || $event === '') {
            return response()->json(['ok' => false, 'error' => 'invalid_payload'], 422);
        }

        try {
            match ($event) {
                'connection.update' => $this->onConnectionUpdate($academyId, $data),
                'message.status' => $this->onMessageStatus($academyId, $data),
                default => null, // qr.generated / message.inbound: not consumed server-side (panel polls QR)
            };
        } catch (Throwable $e) {
            // Never 500 the gateway — it would just retry. Log and acknowledge.
            Log::error('wa webhook handling failed', ['event' => $event, 'academy' => $academyId, 'err' => $e->getMessage()]);
        }

        return response()->json(['ok' => true]);
    }

    /** @param array<string,mixed> $data */
    private function onConnectionUpdate(string $academyId, array $data): void
    {
        $state = strtoupper((string) ($data['state'] ?? ''));

        $this->inAcademyContext($academyId, function () use ($academyId, $state) {
            DB::table('academy_automation_settings')->where('academy_id', $academyId)->update([
                'wasender_session_status' => $state !== '' ? $state : null,
                'updated_at' => now(),
            ]);
        });

        if ($state === 'LOGGED_OUT') {
            $this->alertLoggedOut($academyId, $data);
        }
    }

    /** @param array<string,mixed> $data */
    private function onMessageStatus(string $academyId, array $data): void
    {
        $msgId = isset($data['msgId']) ? (string) $data['msgId'] : '';
        $status = strtoupper((string) ($data['status'] ?? ''));
        // Only failures are actionable: the optimistic SENT was already logged at send time, and the
        // send-log status enum has no DELIVERED/READ states.
        if ($msgId === '' || $status !== 'FAILED') {
            return;
        }

        $this->inAcademyContext($academyId, function () use ($academyId, $msgId, $data) {
            DB::table('automation_send_log')
                ->where('academy_id', $academyId)
                ->where('provider_message_id', $msgId)
                ->update([
                    'status' => 'FAILED',
                    'error' => isset($data['error']) ? (string) $data['error'] : 'send_failed',
                    'updated_at' => now(),
                ]);
        });
    }

    /** @param array<string,mixed> $data */
    private function alertLoggedOut(string $academyId, array $data): void
    {
        $probableBan = (bool) ($data['probableBan'] ?? false);
        $reason = $probableBan ? 'probable ban (403)' : 'device unlinked / 14-day offline (401)';
        Log::warning("WhatsApp session logged out for academy {$academyId}: {$reason}. Re-scan required.", [
            'academy' => $academyId,
            'reasonCode' => $data['reasonCode'] ?? null,
            'probableBan' => $probableBan,
        ]);

        // Best-effort Slack ping so an operator re-scans quickly (the human-in-the-loop signal).
        $token = (string) config('services.slack.notifications.bot_user_oauth_token', '');
        $channel = (string) config('services.slack.notifications.channel', '');
        if ($token === '' || $channel === '') {
            return;
        }
        try {
            Http::withToken($token)->asJson()->timeout(8)->post('https://slack.com/api/chat.postMessage', [
                'channel' => $channel,
                'text' => ":warning: WhatsApp session logged out for academy `{$academyId}` — {$reason}. An admin must re-scan the QR.",
            ]);
        } catch (Throwable) {
            // Slack is best-effort; the Log::warning above is the durable record.
        }
    }

    /**
     * Run a closure inside the given academy's RLS context. The webhook has no authenticated user, so
     * the user GUC is empty; the academy + SUPER_ADMIN role are enough for the automation tables'
     * tenant_isolation policy (using academy_id = app.current_academy_id()).
     *
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = new AuthContext(userId: '', academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);

        return Tenancy::withContext($ctx, $fn);
    }
}
