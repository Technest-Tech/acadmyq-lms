<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\PermissionResolver;
use App\Support\Phone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Non-teaching staff — support, accounting, reception, HR, IT, administration, etc.
 *
 * Each staff member belongs to one department and may optionally hold a system login
 * (user_id → users row) with the STAFF/SUPERVISOR role or one of the academy's own custom roles,
 * so they can access the dashboard with a capability set appropriate to their function. The login
 * has a lifecycle of its own (updateLogin): credentials and role can be changed, it can be switched
 * off, and deactivating the employee switches it off with them.
 *
 * Soft-delete (deleted_at) is used for deactivation — staff records are never hard-deleted
 * so historical references (audit trails, payroll) remain intact.
 */
final class StaffController extends Controller
{
    use InteractsWithPeople;

    /** GET /api/staff — server-driven DataTable. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('staff.read');

        $query = DB::table('staff')->select([
            'id', 'user_id', 'full_name', 'department', 'phone',
            'salary_minor', 'currency', 'notes',
            'is_active', 'deleted_at', 'created_at',
            // What the employee's login lets them do — the one fact about a staff member that
            // matters more than their department. Null when they have no login.
            DB::raw('(select ur.role from user_roles ur where ur.user_id = staff.user_id order by ur.created_at limit 1) as login_role'),
        ]);

        $this->applyActiveScope($query, $request);

        $result = DataTable::paginate($query, $request, [
            'searchable' => ['full_name', 'phone', 'department'],
            'sortable' => [
                'name' => 'full_name',
                'department' => 'department',
                'created_at' => 'created_at',
            ],
            'filters' => [
                'department' => fn ($q, $value) => $q->where('department', strtoupper((string) $value)),
            ],
            'defaultSort' => 'name',
        ]);

        return response()->json($result);
    }

    /** POST /api/staff — create staff member (+ optional login). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('staff.create');

        $academyId = $this->currentAcademyId();
        $data = $this->validatePayload($request, creating: true);

        $staffId = (string) Str::uuid();
        $userId = null;

        if (($data['create_login'] ?? false) === true) {
            Gate::authorize('user.invite');
            Gate::authorize('role.assign');
            $userId = $this->provisionLogin(
                $academyId,
                $data['full_name'],
                strtolower((string) $data['email']),
                $data['password'] ?? null,
                $this->resolveStaffRole($data['role'] ?? 'STAFF'),
            );
        }

        DB::table('staff')->insert([
            'id' => $staffId,
            'academy_id' => $academyId,
            'user_id' => $userId,
            'full_name' => $data['full_name'],
            'department' => strtoupper($data['department'] ?? 'OTHER'),
            'phone' => Phone::normalize($data['phone'] ?? null, 'phone'),
            'salary_minor' => $data['salary_minor'] ?? 0,
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'notes' => $data['notes'] ?? null,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Audit::log('staff.create', 'staff', $staffId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $data['full_name'],
            'department' => strtoupper($data['department'] ?? 'OTHER'),
            'salary_minor' => $data['salary_minor'] ?? 0,
            'has_login' => $userId !== null,
        ]);

        return response()->json(['staffId' => $staffId, 'userId' => $userId], 201);
    }

    /** GET /api/staff/{id} — detail view. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('staff.read');

        $member = DB::table('staff')->where('id', $id)->first();
        if ($member === null) {
            abort(404, 'Staff member not found.');
        }

        return response()->json(['staff' => $member, 'login' => $this->loginFor($member)]);
    }

    /**
     * The employee's sign-in login as the detail page shows it: whether one exists, its email and
     * state, and the role it carries. Created logins used to vanish from view the moment the form
     * closed — the email was never shown again and nothing could change it.
     *
     * @return array{has_login: bool, email: ?string, is_active: ?bool, role: ?string}
     */
    private function loginFor(object $member): array
    {
        if ($member->user_id === null) {
            return ['has_login' => false, 'email' => null, 'is_active' => null, 'role' => null];
        }

        $user = DB::table('users')->where('id', $member->user_id)->first(['email', 'is_active']);
        $role = DB::table('user_roles')->where('user_id', $member->user_id)->orderBy('created_at')->value('role');

        return [
            'has_login' => $user !== null,
            'email' => $user?->email,
            'is_active' => $user === null ? null : (bool) $user->is_active,
            'role' => $role,
        ];
    }

    /**
     * PATCH /api/staff/{id}/login — the employee's login, end to end.
     *
     * No login yet ⇒ creates one (email + password required, role optional, STAFF by default) under
     * the same authority as the create form: user.invite + role.assign. Otherwise any of:
     *   - email / password  — re-issuing credentials is handing out a login, so user.invite.
     *   - role              — role.assign, clamped like the builder: never a role holding more than
     *                         the actor does (see resolveStaffRole).
     *   - is_active         — switch the login off (or back on) without touching the staff record;
     *                         user.invite. Never your own.
     * staff.update is the floor for all of it.
     */
    public function updateLogin(Request $request, string $id): JsonResponse
    {
        Gate::authorize('staff.update');

        $member = DB::table('staff')->where('id', $id)->first();
        if ($member === null) {
            abort(404, 'Staff member not found.');
        }

        $academyId = $this->currentAcademyId();
        $creating = $member->user_id === null;
        $req = $creating ? 'required' : 'sometimes';

        $data = $request->validate([
            'email' => [$req, 'email', 'max:255'],
            'password' => [$req, 'string', 'min:8', 'max:255'],
            'role' => ['sometimes', 'nullable', 'string', 'max:64'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if ($creating) {
            Gate::authorize('user.invite');
            Gate::authorize('role.assign');

            $email = strtolower((string) $data['email']);
            $role = $this->resolveStaffRole($data['role'] ?? 'STAFF');
            $userId = $this->provisionLogin($academyId, (string) $member->full_name, $email, (string) $data['password'], $role);
            DB::table('staff')->where('id', $id)->update(['user_id' => $userId, 'updated_at' => now()]);

            Audit::log('staff.login_created', 'staff', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
                'user_id' => $userId,
                'email' => $email,
                'role' => $role,
            ]);

            return response()->json(['ok' => true, 'created' => true, 'changed' => ['email', 'password', 'role']], 201);
        }

        $touchesCredentials = array_key_exists('email', $data) || array_key_exists('password', $data) || array_key_exists('is_active', $data);
        $touchesRole = array_key_exists('role', $data) && $data['role'] !== null;

        if (! $touchesCredentials && ! $touchesRole) {
            throw ValidationException::withMessages([
                'email' => ['Provide a new email, password, role or status to update. / أدخل بريدًا أو كلمة مرور أو دورًا أو حالة للتحديث.'],
            ]);
        }

        $userId = (string) $member->user_id;
        $changed = [];

        if ($touchesCredentials) {
            Gate::authorize('user.invite');

            if (array_key_exists('is_active', $data) && $userId === $this->ctx()->userId) {
                throw ValidationException::withMessages(['is_active' => ['You cannot switch off your own login.']]);
            }

            $update = ['updated_at' => now()];
            if (array_key_exists('email', $data)) {
                $update['email'] = strtolower((string) $data['email']);
                $changed[] = 'email';
            }
            if (array_key_exists('password', $data)) {
                $update['password'] = Hash::make((string) $data['password']);
                $changed[] = 'password';
            }
            if (array_key_exists('is_active', $data)) {
                $update['is_active'] = (bool) $data['is_active'];
                $changed[] = 'is_active';
            }

            try {
                DB::table('users')->where('id', $userId)->update($update);
            } catch (\Throwable $e) {
                if (($e->getCode() === '23505') || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505')) {
                    throw ValidationException::withMessages(['email' => ['That email is already in use.']]);
                }
                throw $e;
            }

            Audit::log('user.update', 'user', $userId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
                'changed' => $changed,
                'email' => $update['email'] ?? null,
                'is_active' => $update['is_active'] ?? null,
            ]);
        }

        if ($touchesRole) {
            Gate::authorize('role.assign');

            $role = $this->resolveStaffRole((string) $data['role']);
            $current = DB::table('user_roles')->where('user_id', $userId)->where('academy_id', $academyId)->orderBy('created_at')->first();

            if ($current === null || $current->role !== $role) {
                DB::transaction(function () use ($userId, $academyId, $role): void {
                    // One role per user per academy: the middleware only ever reads one.
                    DB::table('user_roles')->where('user_id', $userId)->where('academy_id', $academyId)->delete();
                    DB::table('user_roles')->insert([
                        'id' => (string) Str::uuid(),
                        'user_id' => $userId,
                        'academy_id' => $academyId,
                        'role' => $role,
                    ]);
                });
                Audit::log('role.assign', 'user_role', $userId, $academyId, $this->ctx()->userId, $this->ctx()->role,
                    after: ['role' => $role], before: ['role' => $current?->role]);
                $changed[] = 'role';
            }
        }

        return response()->json(['ok' => true, 'created' => false, 'changed' => $changed]);
    }

    /** PATCH /api/staff/{id} — update; audit before/after for all changed fields. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('staff.update');

        $existing = DB::table('staff')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Staff member not found.');
        }

        $data = $this->validatePayload($request, creating: false);

        if (array_key_exists('phone', $data)) {
            $data['phone'] = Phone::normalize($data['phone'], 'phone');
        }
        if (array_key_exists('currency', $data) && $data['currency'] !== null) {
            $data['currency'] = strtoupper($data['currency']);
        }
        if (array_key_exists('department', $data) && $data['department'] !== null) {
            $data['department'] = strtoupper($data['department']);
        }

        $before = [];
        $after = [];

        foreach (['full_name', 'department', 'phone', 'salary_minor', 'currency', 'notes'] as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col] = $data[$col];
            }
        }

        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('staff')->where('id', $id)->update($after + ['updated_at' => now()]);
        Audit::log('staff.update', 'staff', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /** POST /api/staff/{id}/deactivate — soft delete. */
    public function deactivate(string $id): JsonResponse
    {
        Gate::authorize('staff.deactivate');

        $member = DB::table('staff')->where('id', $id)->whereNull('deleted_at')->first();
        if ($member === null) {
            abort(404, 'Staff member not found or already deactivated.');
        }

        // Leaving the roster means losing the login too: a deactivated employee used to keep a
        // working sign-in with their full role, because only the staff row was ever touched.
        if ($member->user_id !== null && (string) $member->user_id === $this->ctx()->userId) {
            throw ValidationException::withMessages(['staff' => ['You cannot deactivate your own account.']]);
        }

        DB::transaction(function () use ($id, $member): void {
            DB::table('staff')->where('id', $id)->update([
                'is_active' => false,
                'deleted_at' => now(),
                'updated_at' => now(),
            ]);
            if ($member->user_id !== null) {
                DB::table('users')->where('id', $member->user_id)->update(['is_active' => false, 'updated_at' => now()]);
            }
        });

        Audit::log('staff.deactivate', 'staff', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: [
            'deleted_at' => now()->toIso8601String(),
            'login_disabled' => $member->user_id !== null,
        ]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/staff/{id}/reactivate — undo soft delete. */
    public function reactivate(string $id): JsonResponse
    {
        Gate::authorize('staff.update');

        $member = DB::table('staff')->where('id', $id)->whereNotNull('deleted_at')->first();
        if ($member === null) {
            abort(404, 'Staff member not found or already active.');
        }

        DB::transaction(function () use ($id, $member): void {
            DB::table('staff')->where('id', $id)->update([
                'is_active' => true,
                'deleted_at' => null,
                'updated_at' => now(),
            ]);
            if ($member->user_id !== null) {
                DB::table('users')->where('id', $member->user_id)->update(['is_active' => true, 'updated_at' => now()]);
            }
        });

        Audit::log('staff.reactivate', 'staff', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: [
            'is_active' => true,
            'login_restored' => $member->user_id !== null,
        ]);

        return response()->json(['ok' => true]);
    }

    /** System roles the staff form may assign: the minimal baseline and the supervisor. */
    private const ASSIGNABLE_SYSTEM_ROLES = ['STAFF', 'SUPERVISOR'];

    /**
     * Resolve the login role for a new staff member. Either an assignable SYSTEM role (the STAFF
     * baseline or SUPERVISOR — the whole academy minus the money) or one of the academy's own
     * active CUSTOM roles (academy_roles, tenant-scoped by RLS). Any other value — including the
     * privileged ACADEMY_OWNER/TEACHER/SUPER_ADMIN codes — is rejected, so the staff form can
     * never escalate a hire into an owner or a teacher.
     */
    private function resolveStaffRole(string $role): string
    {
        if (! in_array($role, self::ASSIGNABLE_SYSTEM_ROLES, true)) {
            $exists = DB::table('academy_roles')
                ->where('code', $role)
                ->where('is_active', true)
                ->exists();

            if (! $exists) {
                throw ValidationException::withMessages(['role' => ['That role is not available for this academy.']]);
            }
        }

        // The assignment clamp, the twin of the builder's grant clamp: whoever hands out a role must
        // hold everything it grants. Without this, anyone delegated staff.create + user.invite +
        // role.assign (an HR role) could mint a login carrying an owner-built role bigger than their
        // own and simply sign in as it.
        $beyond = array_values(array_diff(PermissionResolver::forRole($role), $this->ctx()->permissions));
        if ($beyond !== []) {
            throw ValidationException::withMessages([
                'role' => ['You cannot assign a role with capabilities you do not hold: '.implode(', ', $beyond)],
            ]);
        }

        return $role;
    }

    /**
     * Provision a system login for the staff member — users row + the chosen role
     * ($roleCode: STAFF or a custom academy role).
     */
    private function provisionLogin(string $academyId, string $fullName, string $email, ?string $password = null, string $roleCode = 'STAFF'): string
    {
        $userId = (string) Str::uuid();

        try {
            DB::table('users')->insert([
                'id' => $userId,
                'academy_id' => $academyId,
                'full_name' => $fullName,
                'email' => $email,
                'password' => Hash::make($password !== null && $password !== '' ? $password : Str::random(40)),
                'is_active' => true,
                'invited_at' => now(),
            ]);
        } catch (\Throwable $e) {
            if (($e->getCode() === '23505') || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505')) {
                throw ValidationException::withMessages(['email' => ['That email is already in use.']]);
            }
            throw $e;
        }

        DB::table('user_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'academy_id' => $academyId,
            'role' => $roleCode,
        ]);

        Audit::log('user.invite', 'user', $userId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: ['email' => $email]);
        Audit::log('role.assign', 'user_role', $userId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: ['role' => $roleCode]);

        return $userId;
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        $rules = [
            'full_name' => [$req, 'string', 'max:255'],
            // Department is deprecated in the UI (employees are classified by ROLE now) but the
            // column is retained; still validated against the catalog when explicitly provided.
            'department' => ['sometimes', 'nullable', 'string', 'max:120', Rule::exists('staff_departments', 'name')->where('is_active', true)],
            'phone' => ['nullable', 'string', 'max:32'],
            'salary_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];

        if ($creating) {
            $rules['create_login'] = ['sometimes', 'boolean'];
            $rules['email'] = ['required_if:create_login,true', 'nullable', 'email', 'max:255'];
            $rules['password'] = ['required_if:create_login,true', 'nullable', 'string', 'min:8', 'max:255'];
            // Login role: STAFF baseline or a custom academy role code (validated in resolveStaffRole).
            $rules['role'] = ['sometimes', 'nullable', 'string', 'max:64'];
        }

        return $request->validate($rules);
    }
}
