<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Whatsapp\WhatsAppConnection;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use RuntimeException;

/**
 * Settings → WhatsApp: the academy pairs (and unlinks) its own number, so a disconnect no longer
 * waits on a Super Admin sending a fresh QR link. Same `specialization.manage` gate as the rest of
 * Settings; the route is plan-gated on `whatsapp.automation`. Pairing itself is
 * {@see WhatsAppConnection}, shared with the Super Admin panel and the public connect link.
 */
final class AcademyWhatsAppController extends Controller
{
    public function __construct(private readonly WhatsAppConnection $connection) {}

    /** GET /api/academy/whatsapp — live state, the linked phone, and the QR while pairing. */
    public function show(): JsonResponse
    {
        Gate::authorize('specialization.manage');

        return response()->json($this->present($this->connection->status($this->context())));
    }

    /** POST /api/academy/whatsapp/connect — start pairing; a live session is returned untouched. */
    public function connect(): JsonResponse
    {
        Gate::authorize('specialization.manage');
        $ctx = $this->context();

        $before = $this->connection->sessionId($ctx);
        try {
            $result = $this->connection->start($ctx);
        } catch (RuntimeException) {
            return response()->json(['error' => 'gateway_unavailable', 'message' => 'The WhatsApp service is temporarily unavailable. Please try again in a minute.'], 502);
        }

        if ($result['session_id'] !== $before) {
            Audit::log('whatsapp.session_connect', 'academy', $ctx->academyId, $ctx->academyId, $ctx->userId, $ctx->role, after: ['session_started' => true, 'self_serve' => true]);
        }

        return response()->json($this->present($result + ['last_connected_at' => null]));
    }

    /** POST /api/academy/whatsapp/logout — unlink the number (to switch to another one). */
    public function logout(): JsonResponse
    {
        Gate::authorize('specialization.manage');
        $ctx = $this->context();

        if (! $this->connection->logout($ctx)) {
            return response()->json(['error' => 'gateway_unavailable', 'message' => 'Could not reach the WhatsApp service; nothing was changed. Please retry.'], 502);
        }

        Audit::log('whatsapp.session_logout', 'academy', $ctx->academyId, $ctx->academyId, $ctx->userId, $ctx->role, after: ['logged_out' => true, 'self_serve' => true]);

        return response()->json($this->present($this->connection->status($ctx)));
    }

    /**
     * @param  array{state: string, qr: ?string, phone: ?string, last_connected_at: ?string}  $s
     * @return array<string,mixed>
     */
    private function present(array $s): array
    {
        return [
            'state' => $s['state'],
            'qr' => $s['qr'],
            'phone' => $s['phone'],
            'last_connected_at' => $s['last_connected_at'],
        ];
    }

    private function context(): AuthContext
    {
        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its WhatsApp number.');
        }

        return $ctx;
    }
}
