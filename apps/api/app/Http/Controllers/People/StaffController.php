<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Support\Audit;
use App\Support\DataTable;
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
 * (user_id → users row) with the STAFF role, so they can access the dashboard with
 * a capability set appropriate to their function.
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
        ]);

        $this->applyActiveScope($query, $request);

        $result = DataTable::paginate($query, $request, [
            'searchable' => ['full_name', 'phone', 'department'],
            'sortable'   => [
                'name'       => 'full_name',
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
        $data      = $this->validatePayload($request, creating: true);

        $staffId = (string) Str::uuid();
        $userId  = null;

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
            'id'            => $staffId,
            'academy_id'    => $academyId,
            'user_id'       => $userId,
            'full_name'     => $data['full_name'],
            'department'    => strtoupper($data['department'] ?? 'OTHER'),
            'phone'         => Phone::normalize($data['phone'] ?? null, 'phone'),
            'salary_minor'  => $data['salary_minor'] ?? 0,
            'currency'      => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'notes'         => $data['notes'] ?? null,
            'is_active'     => true,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        Audit::log('staff.create', 'staff', $staffId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name'    => $data['full_name'],
            'department'   => strtoupper($data['department'] ?? 'OTHER'),
            'salary_minor' => $data['salary_minor'] ?? 0,
            'has_login'    => $userId !== null,
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

        return response()->json(['staff' => $member]);
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
        $after  = [];

        foreach (['full_name', 'department', 'phone', 'salary_minor', 'currency', 'notes'] as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col]  = $data[$col];
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

        DB::table('staff')->where('id', $id)->update([
            'is_active'  => false,
            'deleted_at' => now(),
            'updated_at' => now(),
        ]);

        Audit::log('staff.deactivate', 'staff', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: [
            'deleted_at' => now()->toIso8601String(),
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

        DB::table('staff')->where('id', $id)->update([
            'is_active'  => true,
            'deleted_at' => null,
            'updated_at' => now(),
        ]);

        Audit::log('staff.reactivate', 'staff', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: [
            'is_active' => true,
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
        if (in_array($role, self::ASSIGNABLE_SYSTEM_ROLES, true)) {
            return $role;
        }

        $exists = DB::table('academy_roles')
            ->where('code', $role)
            ->where('is_active', true)
            ->exists();

        if (! $exists) {
            throw ValidationException::withMessages(['role' => ['That role is not available for this academy.']]);
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
                'id'         => $userId,
                'academy_id' => $academyId,
                'full_name'  => $fullName,
                'email'      => $email,
                'password'   => Hash::make($password !== null && $password !== '' ? $password : Str::random(40)),
                'is_active'  => true,
                'invited_at' => now(),
            ]);
        } catch (\Throwable $e) {
            if (($e->getCode() === '23505') || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505')) {
                throw ValidationException::withMessages(['email' => ['That email is already in use.']]);
            }
            throw $e;
        }

        DB::table('user_roles')->insert([
            'id'         => (string) Str::uuid(),
            'user_id'    => $userId,
            'academy_id' => $academyId,
            'role'       => $roleCode,
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
            'full_name'    => [$req, 'string', 'max:255'],
            // Department is deprecated in the UI (employees are classified by ROLE now) but the
            // column is retained; still validated against the catalog when explicitly provided.
            'department'   => ['sometimes', 'nullable', 'string', 'max:120', Rule::exists('staff_departments', 'name')->where('is_active', true)],
            'phone'        => ['nullable', 'string', 'max:32'],
            'salary_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency'     => ['sometimes', 'nullable', 'string', 'size:3'],
            'notes'        => ['nullable', 'string', 'max:2000'],
        ];

        if ($creating) {
            $rules['create_login'] = ['sometimes', 'boolean'];
            $rules['email']        = ['required_if:create_login,true', 'nullable', 'email', 'max:255'];
            $rules['password']     = ['required_if:create_login,true', 'nullable', 'string', 'min:8', 'max:255'];
            // Login role: STAFF baseline or a custom academy role code (validated in resolveStaffRole).
            $rules['role']         = ['sometimes', 'nullable', 'string', 'max:64'];
        }

        return $request->validate($rules);
    }
}
