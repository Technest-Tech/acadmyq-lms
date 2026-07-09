<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Whatsapp\WasenderClient;
use App\Services\Whatsapp\WhatsAppSender;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The external, API-key-authenticated WhatsApp API (docs/whatsapp-api). Every request has already
 * been authenticated and scoped to an academy by the `wa.apikey` middleware, which stashes the
 * academy id on the request; RLS scopes all queries to that academy. This controller only speaks the
 * public contract — it delegates delivery to the same WhatsAppSender seam the internal app uses, so
 * idempotency and the automation_send_log are shared.
 */
final class WhatsAppApiController extends Controller
{
    public function __construct(
        private readonly WhatsAppSender $sender,
        private readonly WasenderClient $wasender,
    ) {}

    /**
     * POST /api/wa/v1/messages
     * Body: { to, text } | { to, image_url, caption? }. Optional Idempotency-Key header dedupes
     * retries. Returns { status, message_id }.
     */
    public function send(Request $request): JsonResponse
    {
        $data = $request->validate([
            'to' => ['required', 'string', 'min:5', 'max:32'],
            'text' => ['required_without:image_url', 'prohibits:image_url', 'string', 'min:1', 'max:4096'],
            'image_url' => ['required_without:text', 'string', 'url', 'starts_with:https://', 'max:2048'],
            'caption' => ['nullable', 'string', 'max:1024'],
        ]);

        $academyId = $this->academyId($request);
        $meta = [
            'automation_type' => 'API',
            'recipient_kind' => 'EXTERNAL',
            'dedupe_key' => $this->dedupeKey($request),
        ];

        $result = isset($data['image_url'])
            ? $this->sender->sendImage($academyId, $data['to'], $data['image_url'], $data['caption'] ?? null, $meta)
            : $this->sender->sendOrLink($academyId, $data['to'], $data['text'], $meta);

        return $this->deliveryResponse($result);
    }

    /**
     * GET /api/wa/v1/contacts/{phone} — is this number registered on WhatsApp?
     */
    public function checkNumber(Request $request, string $phone): JsonResponse
    {
        $token = $this->sender->tokenFor($this->academyId($request));
        if ($token === null) {
            return response()->json(['error' => 'not_connected', 'message' => 'This account has no connected WhatsApp session.'], 409);
        }

        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if ($digits === '') {
            return response()->json(['error' => 'invalid_phone', 'message' => 'Provide a phone number in digits or E.164.'], 422);
        }

        return response()->json(['phone' => $digits, 'exists' => $this->wasender->onWhatsApp($token, $digits)]);
    }

    /**
     * GET /api/wa/v1/status — the account's WhatsApp connection state.
     */
    public function status(Request $request): JsonResponse
    {
        $token = $this->sender->tokenFor($this->academyId($request));
        if ($token === null) {
            return response()->json(['status' => 'DISCONNECTED', 'connected' => false]);
        }

        $status = $this->wasender->sessionStatus($token) ?? 'UNKNOWN';

        return response()->json(['status' => $status, 'connected' => $status === 'CONNECTED']);
    }

    private function academyId(Request $request): string
    {
        return (string) $request->attributes->get('wa_academy_id');
    }

    /** Optional client-supplied idempotency key, namespaced so it never collides with internal keys. */
    private function dedupeKey(Request $request): ?string
    {
        $key = $request->header('Idempotency-Key');
        $key = is_string($key) ? trim($key) : '';

        return $key === '' ? null : 'api:'.substr($key, 0, 180);
    }

    /**
     * Map a WhatsAppSender SendResult to the public HTTP contract.
     *
     * @param  array{transport: string, sent: bool, duplicate: bool, phone: string, message: string, deeplink: string, error: ?string}  $result
     */
    private function deliveryResponse(array $result): JsonResponse
    {
        if ($result['duplicate']) {
            return response()->json(['status' => 'duplicate', 'message_id' => null], 200);
        }

        if ($result['sent']) {
            return response()->json(['status' => 'accepted', 'message_id' => $result['message_id']], 202);
        }

        // No active/connected session (text falls back to a DEEPLINK transport; image reports it).
        if ($result['transport'] === 'DEEPLINK' || $result['error'] === 'no_active_session') {
            return response()->json(['error' => 'not_connected', 'message' => 'This account has no connected WhatsApp session.'], 409);
        }

        if ($result['error'] === 'no_recipient') {
            return response()->json(['error' => 'invalid_phone', 'message' => 'Provide a valid recipient phone number.'], 422);
        }

        return response()->json(['error' => 'send_failed', 'message' => $result['error'] ?? 'The message could not be sent.'], 502);
    }
}
