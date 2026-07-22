<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Models\Learner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Learner auth on the LMS public site (docs/lms/02). Bearer-token auth (Sanctum), NOT the staff SPA
 * session — the token is minted here and the learner site sends it as `Authorization: Bearer`. Every
 * action is already scoped to the subdomain's academy by ResolveAcademyContext, so registration and
 * login look up / write learners under normal RLS.
 */
final class AuthController extends Controller
{
    use InteractsWithLearner;

    /** POST /api/learn/auth/register — self-signup for this academy's course site. */
    public function register(Request $request): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'min:8', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
        ]);

        // Email is unique per academy (the DB index is the backstop; this is the friendly message).
        $exists = Learner::whereRaw('lower(email) = lower(?)', [$data['email']])->exists();
        if ($exists) {
            throw ValidationException::withMessages(['email' => ['An account with this email already exists.']]);
        }

        $learner = Learner::create([
            'academy_id' => $academyId,
            'full_name' => trim($data['full_name']),
            'email' => strtolower(trim($data['email'])),
            'password' => $data['password'],
            'phone' => $data['phone'] ?? null,
            'status' => 'ACTIVE',
            'last_login_at' => now(),
        ]);

        return response()->json($this->authPayload($learner), 201);
    }

    /** POST /api/learn/auth/login. */
    public function login(Request $request): JsonResponse
    {
        $this->currentAcademyId();
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $learner = Learner::whereRaw('lower(email) = lower(?)', [$data['email']])->first();
        if ($learner === null || ! Hash::check($data['password'], $learner->password)) {
            throw ValidationException::withMessages(['email' => ['Wrong email or password.']]);
        }
        if ((string) $learner->status !== 'ACTIVE') {
            throw ValidationException::withMessages(['email' => ['This account is blocked.']]);
        }

        $learner->forceFill(['last_login_at' => now()])->save();

        return response()->json($this->authPayload($learner));
    }

    /** GET /api/learn/me — the signed-in learner + the course ids they are enrolled in. */
    public function me(): JsonResponse
    {
        $learner = $this->learner();

        $enrolled = DB::table('enrollments')
            ->where('learner_id', $learner->getKey())
            ->where('status', 'ACTIVE')
            ->pluck('course_id')
            ->map('strval')
            ->all();

        return response()->json([
            'learner' => $this->presentLearner($learner),
            'enrolled_course_ids' => $enrolled,
        ]);
    }

    /** POST /api/learn/auth/logout — revoke the current bearer token. */
    public function logout(Request $request): JsonResponse
    {
        $token = $request->user('learner')?->currentAccessToken();
        if ($token !== null && ! $token instanceof \Laravel\Sanctum\TransientToken) {
            $token->delete();
        }

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** @return array{token: string, learner: array<string,mixed>} */
    private function authPayload(Learner $learner): array
    {
        // A fresh token per login/registration; the learner site stores it and sends it as Bearer.
        $token = $learner->createToken('learner-site')->plainTextToken;

        return [
            'token' => $token,
            'learner' => $this->presentLearner($learner),
        ];
    }

    /** @return array<string,mixed> */
    private function presentLearner(Learner $learner): array
    {
        return [
            'id' => (string) $learner->getKey(),
            'full_name' => $learner->full_name,
            'email' => $learner->email,
            'phone' => $learner->phone,
        ];
    }
}
