<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Whatsapp\GroupAlerts;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Carbon\CarbonImmutable;
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
 *     (device unlinked or banned) raises an operator alert (the human-re-scan signal), and so does
 *     a DISCONNECTED, which the gateway sends only when a linked number stays down.
 *   • message.status    — move WhatsApp group alerts along sent → delivered → read (or back to
 *     FAILED for a retry), and flip an automation_send_log row to FAILED on a send failure (the
 *     synchronous send already recorded SENT/optimistic).
 *   • send.paused       — the gateway's anti-ban brake stopped a number's queue because WhatsApp
 *     started refusing its messages; an operator is told, since the next step may be a ban.
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
                'connection.update' => $this->onConnectionUpdate($academyId, (string) $request->json('sessionId', ''), $data),
                'message.status' => $this->onMessageStatus($academyId, $data),
                'send.paused' => $this->alertPaused($academyId, $data),
                default => null,
            };
        } catch (Throwable $e) {
            // Never 500 the gateway — it would just retry. Log and acknowledge.
            Log::error('wa webhook handling failed', ['event' => $event, 'academy' => $academyId, 'err' => $e->getMessage()]);
        }

        return response()->json(['ok' => true]);
    }

    /** @param array<string,mixed> $data */
    private function onConnectionUpdate(string $academyId, string $sessionId, array $data): void
    {
        $state = strtoupper((string) ($data['state'] ?? ''));

        // Only the academy's CURRENT session speaks for it. A replaced session's late "logged out"
        // used to land after the new one connected and paint a working number as disconnected.
        $current = $this->inAcademyContext($academyId, function () use ($academyId, $sessionId, $state): bool {
            $row = DB::table('academy_automation_settings')->where('academy_id', $academyId);
            if ($sessionId !== '') {
                $row->where('wa_session_id', $sessionId);
            }

            return $row->update([
                'wasender_session_status' => $state !== '' ? $state : null,
                'updated_at' => now(),
            ]) > 0;
        });

        // A QR nobody scanned in time is an abandoned pairing, not a number that dropped.
        if ($current && $state === 'LOGGED_OUT' && ($data['reason'] ?? null) !== 'qr_timeout') {
            $this->alertLoggedOut($academyId, $data);
        }

        // The gateway only reports DISCONNECTED once a linked number has failed to come back for a
        // while — short drops heal by themselves and are never sent.
        if ($current && $state === 'DISCONNECTED') {
            $minutes = (int) ($data['downMinutes'] ?? 0);
            $queued = (int) ($data['queued'] ?? 0);
            Log::warning("WhatsApp session down for academy {$academyId} for {$minutes} min.", ['academy' => $academyId, 'queued' => $queued]);
            $this->slack(":warning: WhatsApp number of academy `{$academyId}` has been disconnected for {$minutes} min and is not coming back by itself ({$queued} messages waiting). Check the gateway.");
        }
    }

    /** @param array<string,mixed> $data */
    private function onMessageStatus(string $academyId, array $data): void
    {
        $msgId = isset($data['msgId']) ? (string) $data['msgId'] : '';
        $status = strtoupper((string) ($data['status'] ?? ''));
        if ($msgId === '' || $status === '') {
            return;
        }
        $error = isset($data['error']) ? (string) $data['error'] : null;

        $this->inAcademyContext($academyId, function () use ($academyId, $msgId, $status, $error) {
            // Group alerts track the whole walk — sent, delivered, read, failed — because "it reached
            // the group" is the promise that feature makes.
            app(GroupAlerts::class)->applyStatus($msgId, $status, $error, CarbonImmutable::now());

            // The send log only learns about failures: its optimistic SENT was written at send time,
            // and its status enum has no DELIVERED/READ states.
            if ($status === 'FAILED') {
                DB::table('automation_send_log')
                    ->where('academy_id', $academyId)
                    ->where('provider_message_id', $msgId)
                    ->update([
                        'status' => 'FAILED',
                        'error' => $error ?? 'send_failed',
                        'updated_at' => now(),
                    ]);
            }
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
        $this->slack(":warning: WhatsApp session logged out for academy `{$academyId}` — {$reason}. An admin must re-scan the QR.");
    }

    /**
     * The gateway stopped sending for this number because WhatsApp is refusing its messages. The
     * queue starts again by itself at `until`; what needs a person is finding out why (too many
     * messages to people who never wrote to the number, a restriction on the account).
     *
     * @param  array<string,mixed>  $data
     */
    private function alertPaused(string $academyId, array $data): void
    {
        $reason = (string) ($data['reason'] ?? 'unknown');
        $until = (string) ($data['until'] ?? '');
        $phone = (string) ($data['phone'] ?? '');
        Log::warning("WhatsApp sending paused for academy {$academyId}: {$reason}.", [
            'academy' => $academyId, 'phone' => $phone, 'until' => $until,
        ]);

        $this->slack(":octagonal_sign: WhatsApp sending PAUSED for academy `{$academyId}` ({$phone}) — WhatsApp is refusing its messages: {$reason}. Sending resumes at {$until}. Check the number before it gets banned.");
    }

    private function slack(string $text): void
    {
        $token = (string) config('services.slack.notifications.bot_user_oauth_token', '');
        $channel = (string) config('services.slack.notifications.channel', '');
        if ($token === '' || $channel === '') {
            return;
        }
        try {
            Http::withToken($token)->asJson()->timeout(8)->post('https://slack.com/api/chat.postMessage', [
                'channel' => $channel,
                'text' => $text,
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
