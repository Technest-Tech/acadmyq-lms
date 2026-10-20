<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Settings → Admins: the academy's full-access logins (ACADEMY_OWNER). An admin adds another
 * admin with a name, email and password, resets an admin's password, or switches one off.
 *
 * Only an admin may do any of it — the team page (StaffController) can never mint an owner, and a
 * delegated role holding user.invite still cannot reach here. Two rules keep the academy from
 * locking itself out: nobody switches off their own login, and the last active admin stays on.
 */
final class AcademyAdminController extends Controller
{
    /** GET /api/academy/admins */
    public function index(): JsonResponse
    {
        $academyId = $this->authorizeAdmin();
        $me = app(AuthContext::class)->userId;

        $admins = DB::table('user_roles as ur')
            ->join('users as u', 'u.id', '=', 'ur.user_id')
            ->where('ur.academy_id', $academyId)
            ->where('ur.role', 'ACADEMY_OWNER')
            ->orderBy('ur.created_at')
            ->get(['u.id', 'u.full_name', 'u.email', 'u.is_active', 'u.last_login_at', 'ur.created_at'])
            ->map(fn ($row) => [
                'id' => $row->id,
                'fullName' => $row->full_name,
                'email' => $row->email,
                'isActive' => (bool) $row->is_active,
                'lastLoginAt' => $row->last_login_at,
                'createdAt' => $row->created_at,
                'isYou' => $row->id === $me,
            ]);

        return response()->json(['admins' => $admins]);
    }

    /** POST /api/academy/admins — a new full-access login for this academy. */
    public function store(Request $request): JsonResponse
    {
        $academyId = $this->authorizeAdmin();

        $data = $request->validate([
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'min:8', 'max:255'],
        ]);
        $email = strtolower(trim((string) $data['email']));
        $userId = (string) Str::uuid();

        // Both rows or neither — a users row without its role would hold the email hostage.
        DB::transaction(function () use ($userId, $academyId, $data, $email): void {
            try {
                DB::table('users')->insert([
                    'id' => $userId,
                    'academy_id' => $academyId,
                    'full_name' => trim((string) $data['full_name']),
                    'email' => $email,
                    'password' => Hash::make((string) $data['password']),
                    'is_active' => true,
                    'invited_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            } catch (\Throwable $e) {
                if (self::isUniqueViolation($e)) {
                    throw ValidationException::withMessages([
                        'email' => ['That email is already in use. / هذا البريد مستخدم بالفعل.'],
                    ]);
                }
                throw $e;
            }

            DB::table('user_roles')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $userId,
                'academy_id' => $academyId,
                'role' => 'ACADEMY_OWNER',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        $ctx = app(AuthContext::class);
        Audit::log('user.invite', 'user', $userId, $academyId, $ctx->userId, $ctx->role, after: ['email' => $email]);
        Audit::log('role.assign', 'user_role', $userId, $academyId, $ctx->userId, $ctx->role, after: ['role' => 'ACADEMY_OWNER']);

        return response()->json(['id' => $userId], 201);
    }

    /** PATCH /api/academy/admins/{id} — new password and/or switch the login on or off. */
    public function update(Request $request, string $id): JsonResponse
    {
        $academyId = $this->authorizeAdmin();
        $ctx = app(AuthContext::class);

        $data = $request->validate([
            'password' => ['sometimes', 'string', 'min:8', 'max:255'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        if ($data === []) {
            throw ValidationException::withMessages(['password' => ['Nothing to change. / لا يوجد تغيير.']]);
        }

        $isAdmin = DB::table('user_roles')
            ->where('user_id', $id)->where('academy_id', $academyId)->where('role', 'ACADEMY_OWNER')
            ->exists();
        if (! $isAdmin) {
            abort(404, 'Admin not found.');
        }

        if (array_key_exists('is_active', $data) && ! $data['is_active']) {
            if ($id === $ctx->userId) {
                throw ValidationException::withMessages([
                    'is_active' => ['You cannot switch off your own login. / لا يمكنك إيقاف حسابك.'],
                ]);
            }
            $othersActive = DB::table('user_roles as ur')
                ->join('users as u', 'u.id', '=', 'ur.user_id')
                ->where('ur.academy_id', $academyId)->where('ur.role', 'ACADEMY_OWNER')
                ->where('u.is_active', true)->where('u.id', '!=', $id)
                ->exists();
            if (! $othersActive) {
                throw ValidationException::withMessages([
                    'is_active' => ['The academy needs at least one active admin. / يجب أن يبقى مدير واحد نشط على الأقل.'],
                ]);
            }
        }

        $update = ['updated_at' => now()];
        if (array_key_exists('password', $data)) {
            $update['password'] = Hash::make((string) $data['password']);
        }
        if (array_key_exists('is_active', $data)) {
            $update['is_active'] = (bool) $data['is_active'];
        }
        DB::table('users')->where('id', $id)->update($update);

        Audit::log('user.update', 'user', $id, $academyId, $ctx->userId, $ctx->role, after: [
            'changed' => array_keys($data),
            'is_active' => $update['is_active'] ?? null,
        ]);

        return response()->json(['ok' => true]);
    }

    private function authorizeAdmin(): string
    {
        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its admins.');
        }
        if (! in_array($ctx->role, ['ACADEMY_OWNER', 'SUPER_ADMIN'], true)) {
            abort(403, 'Only the academy admins can manage admins.');
        }

        return $ctx->academyId;
    }

    private static function isUniqueViolation(\Throwable $e): bool
    {
        return $e->getCode() === '23505' || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505');
    }
}
