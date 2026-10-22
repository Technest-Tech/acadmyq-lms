<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * POST /api/client-errors — the web app's error page reports the exception that put it there.
 *
 * A crash inside the browser never reaches a server log: the page says "500" and the cause dies
 * with the tab, so a client's "the students page keeps breaking" left nothing to read. The error
 * boundary now posts the message, stack and page here, and they land in the Laravel log as a
 * `client.error` warning beside who hit it. Write-only and size-capped; nothing is stored in the
 * database and nothing is echoed back.
 */
final class ClientErrorController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'message' => ['nullable', 'string', 'max:2000'],
            'stack' => ['nullable', 'string', 'max:20000'],
            'digest' => ['nullable', 'string', 'max:100'],
            'path' => ['nullable', 'string', 'max:500'],
            'build' => ['nullable', 'string', 'max:100'],
        ]);
        $ctx = app(AuthContext::class);

        Log::warning('client.error', [
            'message' => $data['message'] ?? null,
            'path' => $data['path'] ?? null,
            'digest' => $data['digest'] ?? null,
            'build' => $data['build'] ?? null,
            'user_id' => $ctx->userId,
            'role' => $ctx->role,
            'academy_id' => $ctx->academyId,
            'user_agent' => Str::limit((string) $request->userAgent(), 300),
            'stack' => Str::limit((string) ($data['stack'] ?? ''), 6000),
        ]);

        return response()->json(['ok' => true], 202);
    }
}
