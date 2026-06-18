<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Throwable;

/**
 * The single WhatsApp sending seam used by BOTH the manual controllers (invoice/academy-bill
 * "send") and the scheduled automation jobs. It decides per-academy between two transports:
 *
 *   • WASENDER  — when the academy has an active Wasender token, the message is delivered through
 *                 the Wasender API using THAT academy's token (full tenant isolation).
 *   • DEEPLINK  — the fallback (and today's default while tokens are not yet provisioned): build a
 *                 wa.me deep link the operator opens/sends manually. Behaviour is byte-identical to
 *                 the pre-seam manual flow.
 *
 * Token resolution + the send log are guarded by Schema::hasTable so this seam works unchanged
 * before and after the automation tables exist — it simply "lights up" the WASENDER path and
 * logging once academy_automation_settings / automation_send_log are migrated and a token is set.
 *
 * @phpstan-type SendResult array{transport: string, sent: bool, duplicate: bool, phone: string, message: string, deeplink: string, error: ?string}
 */
final class WhatsAppSender
{
    /** @var array<string,bool> memoised Schema::hasTable results (one instance per request/job). */
    private array $tableCache = [];

    public function __construct(private readonly WasenderClient $wasender) {}

    /**
     * Deliver $message to $toPhone for $academyId — via Wasender if the academy has an active
     * token, otherwise as a wa.me deep link for manual sending. Always returns a usable deep link.
     *
     * $meta drives the send log (and idempotency): automation_type, recipient_kind, recipient_id,
     * template_key, ref_type, ref_id, dedupe_key.
     *
     * @param  array<string,mixed>  $meta
     * @return SendResult
     */
    public function sendOrLink(string $academyId, string $toPhone, string $message, array $meta = []): array
    {
        $deeplink = $this->deeplink($toPhone, $message);

        // Idempotency: a logical send already delivered (by dedupe_key) is never repeated.
        $dedupeKey = isset($meta['dedupe_key']) ? (string) $meta['dedupe_key'] : null;
        if ($dedupeKey !== null && $this->alreadySent($academyId, $dedupeKey)) {
            return $this->result('DEEPLINK', sent: false, duplicate: true, phone: $toPhone, message: $message, deeplink: $deeplink, error: null);
        }

        $token = $this->activeTokenFor($academyId);

        if ($token !== null && $toPhone !== '') {
            $res = $this->wasender->sendMessage($token, $toPhone, $message);
            $this->record($academyId, $toPhone, $meta, $res['ok'] ? 'SENT' : 'FAILED', 'WASENDER', $res['error'], $res['message_id']);

            return $this->result('WASENDER', sent: $res['ok'], duplicate: false, phone: $toPhone, message: $message, deeplink: $deeplink, error: $res['error']);
        }

        // Fallback: no active token (or no phone on file) → produce the wa.me link for manual send.
        $this->record($academyId, $toPhone, $meta, 'SKIPPED', 'DEEPLINK', null, null);

        return $this->result('DEEPLINK', sent: false, duplicate: false, phone: $toPhone, message: $message, deeplink: $deeplink, error: null);
    }

    /** Build a wa.me deep link from an E.164 phone + message (matches WhatsAppReportBuilder). */
    public function deeplink(string $phone, string $message): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';

        return 'https://wa.me/'.$digits.'?text='.rawurlencode($message);
    }

    /**
     * The academy's decrypted, active Wasender token, or null to fall back to the deep link.
     * Returns null until academy_automation_settings exists and a token is stored (so the seam
     * behaves as deep-link-only today and switches to WASENDER automatically once configured).
     */
    private function activeTokenFor(string $academyId): ?string
    {
        if (! $this->tableExists('academy_automation_settings')) {
            return null;
        }

        $row = DB::table('academy_automation_settings')
            ->where('academy_id', $academyId)
            ->first(['wasender_token']);

        if ($row === null || $row->wasender_token === null || $row->wasender_token === '') {
            return null;
        }

        try {
            return Crypt::decryptString((string) $row->wasender_token);
        } catch (Throwable) {
            // A token encrypted under a rotated APP_KEY can't be read — fall back to the deep link
            // rather than throw; the academy re-enters the token to restore automated delivery.
            return null;
        }
    }

    /**
     * Has this (academy, dedupe_key) send already been handled? Transport-agnostic: a prior real
     * send (SENT) OR a produced deep link (SKIPPED) both count, so a daily/periodic key never
     * double-fires regardless of whether a token was configured.
     */
    private function alreadySent(string $academyId, string $dedupeKey): bool
    {
        if (! $this->tableExists('automation_send_log')) {
            return false;
        }

        return DB::table('automation_send_log')
            ->where('academy_id', $academyId)
            ->where('dedupe_key', $dedupeKey)
            ->exists();
    }

    /**
     * Append a send-log row (idempotent on academy_id+dedupe_key). Never throws — logging must not
     * break a send.
     *
     * @param  array<string,mixed>  $meta
     */
    private function record(string $academyId, string $phone, array $meta, string $status, string $transport, ?string $error, ?string $providerMessageId): void
    {
        if (! $this->tableExists('automation_send_log')) {
            return;
        }

        try {
            DB::table('automation_send_log')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'automation_type' => isset($meta['automation_type']) ? (string) $meta['automation_type'] : 'MANUAL',
                'channel' => 'WHATSAPP',
                'transport' => $transport,
                'recipient_kind' => isset($meta['recipient_kind']) ? (string) $meta['recipient_kind'] : 'ACADEMY_OWNER',
                'recipient_id' => $meta['recipient_id'] ?? null,
                'recipient_phone' => $phone !== '' ? $phone : null,
                'template_key' => $meta['template_key'] ?? null,
                'ref_type' => $meta['ref_type'] ?? null,
                'ref_id' => $meta['ref_id'] ?? null,
                'status' => $status,
                'error' => $error,
                'provider_message_id' => $providerMessageId,
                'dedupe_key' => $meta['dedupe_key'] ?? null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (Throwable) {
            // swallow — a logging failure must never abort the send/link
        }
    }

    private function tableExists(string $table): bool
    {
        return $this->tableCache[$table] ??= Schema::hasTable($table);
    }

    /**
     * @return SendResult
     */
    private function result(string $transport, bool $sent, bool $duplicate, string $phone, string $message, string $deeplink, ?string $error): array
    {
        return [
            'transport' => $transport,
            'sent' => $sent,
            'duplicate' => $duplicate,
            'phone' => $phone,
            'message' => $message,
            'deeplink' => $deeplink,
            'error' => $error,
        ];
    }
}
