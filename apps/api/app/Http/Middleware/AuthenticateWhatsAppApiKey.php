<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Entitlement;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authenticates the public WhatsApp API (docs/whatsapp-api) with a per-academy API key and bridges
 * it to the tenant RLS context — a machine-to-machine, login-less analogue of TenantContextMiddleware.
 *
 * The key arrives as `Authorization: Bearer <key>`. It is resolved to an academy BEFORE any context
 * exists (whatsapp_api_keys is RLS-protected) via the BYPASSRLS reader app.wa_api_key_lookup, then the
 * rest of the request runs inside ONE transaction whose app.* GUCs are set transaction-locally — so
 * RLS scopes every query and the key can only ever act as its own academy. Suspended academies and
 * academies whose plan does not include whatsapp.automation are rejected, so revoking a plan or
 * suspending a tenant disables its API immediately.
 */
final class AuthenticateWhatsAppApiKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $this->bearerToken($request);
        if ($key === null || $key === '') {
            return $this->error('missing_api_key', 'Provide your API key as a Bearer token.', 401);
        }

        $hash = hash('sha256', $key);
        $row = DB::selectOne('select id, academy_id, revoked_at from app.wa_api_key_lookup(?)', [$hash]);

        if ($row === null || $row->revoked_at !== null) {
            return $this->error('invalid_api_key', 'The API key is invalid or has been revoked.', 401);
        }

        $academyId = (string) $row->academy_id;
        $keyId = (string) $row->id;

        $status = DB::selectOne('select app.auth_academy_status(?::uuid) as s', [$academyId])->s;
        if ($status === null) {
            return $this->error('invalid_api_key', 'The API key is invalid or has been revoked.', 401);
        }
        if ($status === 'SUSPENDED') {
            return $this->error('account_suspended', 'This account is suspended.', 403);
        }

        // Everything below runs inside the academy's tenant context (transaction-local GUCs). userId
        // is null — there is no user behind an API key; RLS on the send-path tables only checks
        // app.current_academy_id(), and an unknown role grants no platform-write (the safe default).
        return DB::transaction(function () use ($request, $next, $academyId, $keyId) {
            TenantContext::apply(userId: null, academyId: $academyId, role: 'API_CLIENT', local: true);

            if (! in_array('whatsapp.automation', Entitlement::resolve($academyId)['capabilities'], true)) {
                return $this->error('not_entitled', 'WhatsApp automation is not enabled for this account.', 403);
            }

            $request->attributes->set('wa_academy_id', $academyId);
            $request->attributes->set('wa_api_key_id', $keyId);

            // Best-effort usage stamp — never block the request on it.
            try {
                DB::table('whatsapp_api_keys')->where('id', $keyId)->update(['last_used_at' => now()]);
            } catch (\Throwable) {
                // ignore
            }

            return $next($request);
        });
    }

    /** Extract a Bearer token from the Authorization header (case-insensitive scheme). */
    private function bearerToken(Request $request): ?string
    {
        $header = (string) $request->header('Authorization', '');
        if (preg_match('/^Bearer\s+(.+)$/i', $header, $m) === 1) {
            return trim($m[1]);
        }

        return null;
    }

    private function error(string $code, string $message, int $status): JsonResponse
    {
        return response()->json(['error' => $code, 'message' => $message], $status);
    }
}
