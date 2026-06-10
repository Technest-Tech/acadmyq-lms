<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Sanctum SPA session auth (Sprint 2 §2, §8). Login is public and runs OUTSIDE the tenant
 * context (the user is not yet known); it relies on the RlsBypassUserProvider to find the
 * user under RLS. Everything else here runs inside the authenticated group, so the
 * per-request AuthContext + GUCs are already set.
 */
final class AuthController extends Controller
{
    /** POST /api/auth/login (public) — Auth::attempt, regenerate session, audit auth.login. */
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        // Fail closed on bad credentials: no session, no context (TC-2.2 / AC-2.13).
        if (! Auth::guard('web')->attempt($credentials)) {
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        $user = Auth::guard('web')->user();

        // Inactive accounts may not establish a session (fail closed, §4.1 step 3).
        if (! $user->is_active) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['message' => 'These credentials do not match our records.'], 403);
        }

        [$role, $academyId] = $this->primaryRole($user->getKey());

        // A SUSPENDED academy blocks its owner/teacher logins; data is retained (AC-3.6,
        // TC-3.15). Read the status via the BYPASSRLS reader since no context is set yet.
        // SUPER_ADMIN has no home academy, so this never gates a platform admin.
        if ($role !== 'SUPER_ADMIN' && $academyId !== null && $this->academyIsSuspended($academyId)) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['message' => 'This academy is suspended.'], 403);
        }

        $request->session()->regenerate();

        // Stamp + audit the login. Both touch the RLS users/audit tables with no tenant
        // context, so the last-login write goes through the BYPASSRLS function.
        DB::statement('select app.auth_touch_last_login(?::uuid)', [$user->getKey()]);

        Audit::log('auth.login', 'user', (string) $user->getKey(), $academyId, (string) $user->getKey(), $role);

        return response()->json(['role' => $role, 'academyId' => $academyId]);
    }

    /** POST /api/auth/logout (auth) — invalidate session, audit auth.logout. */
    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        $ctx = app(AuthContext::class);

        Audit::log('auth.logout', 'user', (string) $user->getKey(), $ctx->academyId, $ctx->userId, $ctx->role);

        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['ok' => true]);
    }

    /** GET /api/auth/me (auth) — resolved identity, role, academy, permissions, locale. */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        $ctx = app(AuthContext::class);

        return response()->json([
            'user' => [
                'id' => (string) $user->getKey(),
                'fullName' => $user->full_name,
                'email' => $user->email,
            ],
            'role' => $ctx->role,
            'academyId' => $ctx->academyId,
            'permissions' => $ctx->permissions,
            'locale' => $user->preferred_locale,
        ]);
    }

    /** PATCH /api/auth/locale (auth) — persist preferred_locale; report layout direction. */
    public function setLocale(Request $request): JsonResponse
    {
        $data = $request->validate([
            'locale' => ['required', Rule::in(['ar', 'en'])],
        ]);

        $user = $request->user();
        DB::table('users')->where('id', $user->getKey())->update(['preferred_locale' => $data['locale']]);

        return response()->json([
            'locale' => $data['locale'],
            'dir' => $data['locale'] === 'ar' ? 'rtl' : 'ltr',
        ]);
    }

    /**
     * The user's primary (role, academy) for audit attribution at login time — read via the
     * BYPASSRLS function since no context is set yet. SUPER_ADMIN wins when present.
     *
     * @return array{0: string, 1: ?string}
     */
    private function primaryRole(string $userId): array
    {
        $roles = DB::select('select role, academy_id from app.auth_user_roles(?::uuid)', [$userId]);
        $super = collect($roles)->firstWhere('role', 'SUPER_ADMIN');

        if ($super !== null) {
            return ['SUPER_ADMIN', null];
        }

        $first = $roles[0] ?? null;

        return [
            $first->role ?? 'TEACHER',
            isset($first->academy_id) && $first->academy_id !== null ? (string) $first->academy_id : null,
        ];
    }

    /** Is the academy SUSPENDED? Read with no context via the BYPASSRLS status reader. */
    private function academyIsSuspended(string $academyId): bool
    {
        $status = DB::selectOne('select app.auth_academy_status(?::uuid) as s', [$academyId])->s;

        return $status === 'SUSPENDED';
    }
}
