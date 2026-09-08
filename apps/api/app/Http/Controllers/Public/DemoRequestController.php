<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The marketing site's demo-request form (acadmyq.com → /contact and the product pages).
 *
 * PUBLIC and unauthenticated by definition — the person filling it in has no account, which is the
 * whole point of the form. It therefore sits outside `auth:sanctum`/`tenant.context` alongside the
 * other token-less public endpoints, and writes through the `demo_requests_insert` RLS policy,
 * the one policy on that table that does not require a super admin.
 *
 * Three layers keep an open POST endpoint from becoming a spam sink, in this order:
 *
 *  1. `throttle:demo-requests` (6/hour per IP, AppServiceProvider) — the blunt volume ceiling.
 *  2. The HONEYPOT below: a field no human ever sees and every naive bot fills. It is answered with
 *     the SAME 201 as a real submission, deliberately — telling a bot it was caught teaches it to
 *     try again differently.
 *  3. Server-side validation, which is the only validation that counts; the browser's is a
 *     convenience for the person typing.
 *
 * Nothing is echoed back. The response is a bare acknowledgement, so the endpoint can never be used
 * to read a lead — not even the one just written (hence `insert`, never `insertGetId`).
 */
final class DemoRequestController extends Controller
{
    /** Form fields a bot fills and a human cannot see (the input is hidden + aria-hidden). */
    private const HONEYPOT = 'website';

    /** POST /api/public/demo-requests */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            // Optional on purpose: in this market a phone number is the contact that always exists
            // and an email address often does not. Phone is the required one.
            'email' => ['nullable', 'email:rfc', 'max:180'],
            'phone' => ['required', 'string', 'min:6', 'max:32'],
            'country' => ['nullable', 'string', 'size:2', 'alpha'],
            'product' => ['required', Rule::in(['COURSE_PLATFORM', 'ACADEMY_MANAGEMENT', 'UNDECIDED'])],
            'role' => ['nullable', 'string', 'max:120'],
            'message' => ['nullable', 'string', 'max:2000'],
            // `accepted` rejects false/0/"" — consent has to be given, never merely not refused.
            'consent' => ['required', 'accepted'],
            'locale' => ['nullable', Rule::in(['ar', 'en'])],
            'source' => ['nullable', 'string', 'max:120'],
            self::HONEYPOT => ['nullable', 'string', 'max:200'],
        ]);

        // Caught bot: acknowledge exactly as a real submission would, and store nothing.
        if (trim((string) ($data[self::HONEYPOT] ?? '')) !== '') {
            return $this->accepted();
        }

        DB::table('demo_requests')->insert([
            'name' => trim($data['name']),
            'email' => $this->nullIfBlank($data['email'] ?? null),
            'phone' => trim($data['phone']),
            'country' => isset($data['country']) ? strtoupper($data['country']) : null,
            'product' => $data['product'],
            'role' => $this->nullIfBlank($data['role'] ?? null),
            'message' => $this->nullIfBlank($data['message'] ?? null),
            'consent' => true,
            'locale' => $data['locale'] ?? null,
            'source' => $this->nullIfBlank($data['source'] ?? null),
            'ip' => $request->ip(),
            // Truncated rather than rejected: a freak-long UA is a curiosity, not a reason to lose
            // a lead someone took the trouble to type.
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 500) ?: null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->accepted();
    }

    private function accepted(): JsonResponse
    {
        return response()->json(['ok' => true], 201)->header('Cache-Control', 'no-store');
    }

    private function nullIfBlank(?string $value): ?string
    {
        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
