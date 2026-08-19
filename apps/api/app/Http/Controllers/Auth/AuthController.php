<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
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
    /**
     * POST /api/auth/login (public) — Auth::attempt, regenerate session, audit auth.login.
     *
     * An optional `subdomain` names the client door the attempt came through (`<handle>.<root>`);
     * it binds the session to that client's own people. Absent ⇒ the platform login, unchanged.
     */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            // The client's own sign-in door (`<handle>.<root>`) posts its handle; the platform
            // login (app.<root>) omits it. See $belongsTo below for what it buys.
            'subdomain' => ['sometimes', 'nullable', 'string', 'max:63', 'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i'],
        ]);
        $credentials = ['email' => $data['email'], 'password' => $data['password']];

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

        // A client's own address is a door for that client's people only: signing in at
        // `<handle>.<root>` must never establish a session for a user of another academy, however
        // valid their password is. Rejected with the SAME neutral message as a wrong password, so
        // the door never becomes an oracle for "does this person work at that academy?".
        // A SUPER_ADMIN belongs to no academy and is deliberately exempt — the platform admin can
        // sign in anywhere. An unknown handle matches nobody and therefore rejects everybody.
        if ($role !== 'SUPER_ADMIN' && ! $this->belongsTo($academyId, $data['subdomain'] ?? null)) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
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

    /**
     * GET /api/auth/me (auth) — resolved identity, role, academy, permissions, locale, and the
     * academy's plan capabilities.
     *
     * `capabilities` ships with the session on purpose. The web shell needs both the permission set
     * and the plan capabilities before it can paint a single nav item, and fetching them separately
     * made that a waterfall — /auth/me, then /entitlements, with the chrome held back behind both.
     * They resolve from the same request context, so there is no reason to pay two round-trips.
     * `null` (not `[]`) means "no academy scope" — a platform Super Admin has no plan to resolve,
     * which is a different thing from an academy whose plan grants nothing.
     *
     * GET /api/entitlements remains the full payload (limits, usage, add-ons, modules) for the
     * screens that need more than the capability list.
     */
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
            'capabilities' => $ctx->academyId === null
                ? null
                : Entitlement::resolve($ctx->academyId)['capabilities'],
            'academy' => $this->academyIdentity($ctx->academyId),
        ]);
    }

    /**
     * Who the panel belongs to — name and logo — travelling with the session for the same reason
     * `capabilities` does: the shell paints its sidebar brand before anything else, and a second
     * round-trip for two strings would show the platform's mark first and swap it a beat later.
     *
     * `null` for a platform Super Admin: they have no academy, so the chrome keeps the platform's
     * own identity. Readable under the caller's own context (academies_select is
     * `id = app.current_academy_id()`), so this can only ever describe the caller's academy.
     *
     * @return array{name: string, displayName: string, logoUrl: ?string}|null
     */
    private function academyIdentity(?string $academyId): ?array
    {
        if ($academyId === null) {
            return null;
        }

        $academy = DB::table('academies')
            ->where('id', $academyId)
            ->first(['name', 'brand_display_name', 'brand_logo_url']);

        if ($academy === null) {
            return null;
        }

        $name = (string) ($academy->name ?? '');
        $display = trim((string) ($academy->brand_display_name ?? ''));
        $logo = trim((string) ($academy->brand_logo_url ?? ''));

        return [
            'name' => $name,
            'displayName' => $display !== '' ? $display : $name,
            'logoUrl' => $logo !== '' ? $logo : null,
        ];
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

    /**
     * Is this user's academy the one that owns the sign-in handle they used? No handle (the platform
     * login) ⇒ always true; the tenant check exists only for the per-client door. Resolved with no
     * context via the same BYPASSRLS subdomain reader the public site uses.
     */
    private function belongsTo(?string $academyId, ?string $subdomain): bool
    {
        $handle = trim((string) $subdomain);
        if ($handle === '') {
            return true;
        }

        $owner = DB::selectOne('select app.lms_academy_by_subdomain(?) as id', [$handle])->id ?? null;

        return $owner !== null && $academyId !== null && (string) $owner === $academyId;
    }

    /** Is the academy SUSPENDED? Read with no context via the BYPASSRLS status reader. */
    private function academyIsSuspended(string $academyId): bool
    {
        $status = DB::selectOne('select app.auth_academy_status(?::uuid) as s', [$academyId])->s;

        return $status === 'SUSPENDED';
    }
}
