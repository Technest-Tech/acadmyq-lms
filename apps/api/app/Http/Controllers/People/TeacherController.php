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
use Illuminate\Validation\ValidationException;

/**
 * Teachers — a session rate + currency that will drive Sprint 8 payroll (R-PAY-1/3), plus
 * weekly availability that guides Sprint 5 scheduling. Editing the rate is forward-looking
 * metadata only; it is audited and never rewrites already-computed payouts (AC-4.5).
 *
 * Teacher self-view (Sprint 2 §3.6): a TEACHER lacks `teacher.read` (the full list) but holds
 * `teacher.read_own`, so `show` lets them read ONLY their own teacher row — never list all
 * teachers, never read or edit another's (AC-4.10 / TC-4.27/4.28).
 */
final class TeacherController extends Controller
{
    use InteractsWithPeople;

    /** GET /api/teachers — server-driven DataTable. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('teacher.read');

        $query = DB::table('teachers')->select([
            'id', 'user_id', 'full_name', 'phone', 'specialization',
            'session_rate_minor', 'currency', 'timezone', 'availability',
            'is_active', 'deleted_at', 'created_at',
        ]);
        $this->applyActiveScope($query, $request);

        $result = DataTable::paginate($query, $request, [
            'searchable' => ['full_name', 'phone', 'specialization'],
            'sortable' => [
                'name' => 'full_name',
                'rate' => 'session_rate_minor',
                'created_at' => 'created_at',
            ],
            'filters' => [
                'currency' => fn ($q, $value) => $q->where('currency', strtoupper((string) $value)),
                'specialization' => fn ($q, $value) => $q->where('specialization', (string) $value),
            ],
            'defaultSort' => 'name',
        ]);

        return response()->json($result);
    }

    /** POST /api/teachers — create teacher (+ optional login: users row + user_roles(TEACHER)). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('teacher.create');

        $academyId = $this->currentAcademyId();

        // Plan limit: BASIC caps teachers (AC-9.2). Enforced before any write.
        $this->enforceLimit($academyId, 'teachers', 'maxTeachers', 'teachers');

        $data = $this->validatePayload($request, creating: true);

        $teacherId = (string) Str::uuid();
        $userId = null;

        // Optional teacher login. Owner-only sub-action — guarded by the same caps as Sprint 3
        // owner provisioning, so a role without them cannot mint users via this path.
        if (($data['create_login'] ?? false) === true) {
            Gate::authorize('user.invite');
            Gate::authorize('role.assign');
            $userId = $this->provisionLogin($academyId, $data['full_name'], strtolower((string) $data['email']), $data['password'] ?? null);
        }

        DB::table('teachers')->insert([
            'id' => $teacherId,
            'academy_id' => $academyId,
            'user_id' => $userId,
            'full_name' => $data['full_name'],
            'phone' => Phone::normalize($data['phone'] ?? null, 'phone'),
            'specialization' => $data['specialization'] ?? null,
            'session_rate_minor' => $data['session_rate_minor'],
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'timezone' => $data['timezone'] ?? null,
            'availability' => json_encode($data['availability'] ?? []),
            'is_active' => true,
        ]);

        Audit::log('teacher.create', 'teacher', $teacherId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $data['full_name'],
            'session_rate_minor' => $data['session_rate_minor'],
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'has_login' => $userId !== null,
        ]);

        return response()->json(['teacherId' => $teacherId, 'userId' => $userId], 201);
    }

    /** GET /api/teachers/{id} — detail (rate, availability, current students). */
    public function show(Request $request, string $id): JsonResponse
    {
        $ctx = $this->ctx();

        $teacher = DB::table('teachers')->where('id', $id)->first();
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        // Capability: full read, OR a teacher reading strictly their own record (§3.6).
        $canReadAll = $ctx->can('teacher.read');
        $ownsRecord = $ctx->can('teacher.read_own') && $teacher->user_id === $ctx->userId;
        if (! $canReadAll && ! $ownsRecord) {
            abort(403, 'You may only view your own teacher record.');
        }

        $teacher->availability = json_decode((string) $teacher->availability, true);

        $students = DB::table('student_teacher_assignments as a')
            ->join('students as s', 's.id', '=', 'a.student_id')
            ->where('a.teacher_id', $id)
            ->whereNull('a.ended_at')
            ->whereNull('s.deleted_at')
            ->orderBy('s.full_name')
            ->get(['s.id', 's.full_name', 'a.started_at']);

        // The teacher's linked sign-in login (optional). Surfaced so the detail page can show the
        // current email and let an owner set/change the account (see updateLogin).
        $login = ['has_login' => false, 'email' => null, 'is_active' => null];
        if ($teacher->user_id !== null) {
            $user = DB::table('users')->where('id', $teacher->user_id)->first(['email', 'is_active']);
            if ($user !== null) {
                $login = ['has_login' => true, 'email' => $user->email, 'is_active' => (bool) $user->is_active];
            }
        }

        return response()->json(['teacher' => $teacher, 'students' => $students, 'login' => $login]);
    }

    /**
     * PATCH /api/teachers/{id}/login — set or change a teacher's sign-in login (email + password).
     *
     * A teacher's login is optional. When one does NOT exist yet, this provisions it (email +
     * password both required) — an owner-only sub-action guarded by the same caps as creating a
     * teacher login on the create form (user.invite + role.assign). When one DOES exist, it updates
     * the email and/or password directly (at least one required), mirroring the academy-owner editor.
     */
    public function updateLogin(Request $request, string $id): JsonResponse
    {
        Gate::authorize('teacher.update');

        $teacher = DB::table('teachers')->where('id', $id)->first();
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        $academyId = $this->currentAcademyId();
        $creating = $teacher->user_id === null;
        $req = $creating ? 'required' : 'sometimes';

        $data = $request->validate([
            'email' => [$req, 'email', 'max:255'],
            'password' => [$req, 'string', 'min:8', 'max:255'],
        ]);

        if ($creating) {
            // Minting a new login is the same authority as provisioning one on the create form.
            Gate::authorize('user.invite');
            Gate::authorize('role.assign');

            $userId = $this->provisionLogin($academyId, (string) $teacher->full_name, strtolower((string) $data['email']), (string) $data['password']);
            DB::table('teachers')->where('id', $id)->update(['user_id' => $userId, 'updated_at' => now()]);

            Audit::log('teacher.login_created', 'teacher', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
                'user_id' => $userId,
                'email' => strtolower((string) $data['email']),
            ]);

            return response()->json(['ok' => true, 'created' => true, 'changed' => ['email', 'password']], 201);
        }

        if (! array_key_exists('email', $data) && ! array_key_exists('password', $data)) {
            throw ValidationException::withMessages([
                'email' => ['Provide a new email or password to update. / أدخل بريدًا أو كلمة مرور جديدة للتحديث.'],
            ]);
        }

        $update = [];
        $changed = [];
        if (array_key_exists('email', $data)) {
            $update['email'] = strtolower((string) $data['email']);
            $changed[] = 'email';
        }
        if (array_key_exists('password', $data)) {
            $update['password'] = Hash::make((string) $data['password']);
            $changed[] = 'password';
        }
        $update['updated_at'] = now();

        try {
            DB::table('users')->where('id', $teacher->user_id)->update($update);
        } catch (\Throwable $e) {
            if (($e->getCode() === '23505') || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505')) {
                throw ValidationException::withMessages(['email' => ['That email is already in use.']]);
            }
            throw $e;
        }

        Audit::log('user.update', 'user', (string) $teacher->user_id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'changed' => $changed,
            'email' => $update['email'] ?? null,
        ]);

        return response()->json(['ok' => true, 'created' => false, 'changed' => $changed]);
    }

    /** PATCH /api/teachers/{id} — edit; a rate change is captured in the before/after audit. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('teacher.update');

        $existing = DB::table('teachers')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Teacher not found.');
        }

        $data = $this->validatePayload($request, creating: false);
        if (array_key_exists('phone', $data)) {
            $data['phone'] = Phone::normalize($data['phone'], 'phone');
        }
        if (array_key_exists('currency', $data) && $data['currency'] !== null) {
            $data['currency'] = strtoupper($data['currency']);
        }

        $before = [];
        $after = [];
        foreach (['full_name', 'phone', 'specialization', 'session_rate_minor', 'currency', 'timezone'] as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col] = $data[$col];
            }
        }
        if (array_key_exists('availability', $data)
            && json_encode($data['availability']) !== (string) $existing->availability) {
            $before['availability'] = json_decode((string) $existing->availability, true);
            $after['availability'] = json_encode($data['availability']);
        }

        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('teachers')->where('id', $id)->update($after + ['updated_at' => now()]);
        Audit::log('teacher.update', 'teacher', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /** POST /api/teachers/{id}/deactivate — blocked while the teacher has active students. */
    public function deactivate(string $id): JsonResponse
    {
        Gate::authorize('teacher.deactivate');

        $teacher = DB::table('teachers')->where('id', $id)->whereNull('deleted_at')->first();
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        $activeStudents = DB::table('student_teacher_assignments as a')
            ->join('students as s', 's.id', '=', 'a.student_id')
            ->where('a.teacher_id', $id)
            ->whereNull('a.ended_at')
            ->whereNull('s.deleted_at')
            ->count();
        if ($activeStudents > 0) {
            abort(422, 'Reassign this teacher\'s active students before deactivating them.');
        }

        DB::table('teachers')->where('id', $id)->update([
            'is_active' => false,
            'deleted_at' => now(),
            'updated_at' => now(),
        ]);
        Audit::log('teacher.deactivate', 'teacher', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: ['deleted_at' => now()->toIso8601String()]);

        return response()->json(['ok' => true]);
    }

    /**
     * DELETE /api/teachers/{id} — PERMANENT hard delete. Removes the teacher and ALL of their
     * history in one cascade: schedule, sessions + lesson reports, payroll (payouts and their
     * lines/adjustments), student assignments, and performance reports. This is irreversible
     * and destroys financial/audit data — it is the explicit "remove from the system" action.
     *
     * Guardian invoices survive: line items that referenced a deleted session are detached
     * (session_id nulled) rather than removed, so billing totals stay intact. The teacher's
     * login is deleted too; if it ever wrote an append-only audit entry (which cannot be
     * unlinked under RLS) the account is disabled instead so audit attribution is preserved.
     */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('teacher.deactivate');

        $teacher = DB::table('teachers')->where('id', $id)->first();
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        $sessionIds = DB::table('sessions')->where('teacher_id', $id)->pluck('id')->all();
        $scheduleIds = DB::table('schedules')->where('teacher_id', $id)->pluck('id')->all();

        $removed = [
            'sessions' => count($sessionIds),
            'schedules' => count($scheduleIds),
            'payouts' => DB::table('payouts')->where('teacher_id', $id)->count(),
            'assignments' => DB::table('student_teacher_assignments')->where('teacher_id', $id)->count(),
            'reports' => DB::table('teacher_reports')->where('teacher_id', $id)->count(),
        ];

        DB::transaction(function () use ($teacher, $id, $sessionIds, $scheduleIds) {
            if ($sessionIds !== []) {
                // Keep the guardian's invoice intact — just unlink the deleted session.
                DB::table('invoice_line_items')->whereIn('session_id', $sessionIds)->update(['session_id' => null]);
                DB::table('session_reports')->whereIn('session_id', $sessionIds)->delete();
                DB::table('payout_line_items')->whereIn('session_id', $sessionIds)->delete();
                // Break the self-reference from any reschedule that points at these sessions.
                DB::table('sessions')->whereIn('original_session_id', $sessionIds)->update(['original_session_id' => null]);
            }

            // Payroll: cascades payout_line_items + payout_adjustments for this teacher.
            DB::table('payouts')->where('teacher_id', $id)->delete();

            DB::table('sessions')->where('teacher_id', $id)->delete();

            if ($scheduleIds !== []) {
                // Detach any stray (cross-teacher reschedule) session still pointing at this
                // teacher's schedule/slots before the schedule cascade removes the slots.
                $slotIds = DB::table('schedule_slots')->whereIn('schedule_id', $scheduleIds)->pluck('id')->all();
                if ($slotIds !== []) {
                    DB::table('sessions')->whereIn('slot_id', $slotIds)->update(['slot_id' => null]);
                }
                DB::table('sessions')->whereIn('schedule_id', $scheduleIds)->update(['schedule_id' => null]);
            }
            DB::table('schedules')->where('teacher_id', $id)->delete(); // cascades schedule_slots

            DB::table('student_teacher_assignments')->where('teacher_id', $id)->delete();
            DB::table('teacher_reports')->where('teacher_id', $id)->delete();
            DB::table('teachers')->where('id', $id)->delete();

            if ($teacher->user_id !== null) {
                DB::table('user_roles')->where('user_id', $teacher->user_id)->delete();
                try {
                    // Savepoint: a login that authored audit entries can't be hard-deleted
                    // (audit_log is append-only under RLS); fall back to disabling it.
                    DB::transaction(function () use ($teacher) {
                        DB::table('users')->where('id', $teacher->user_id)->delete();
                    });
                } catch (\Throwable) {
                    DB::table('users')->where('id', $teacher->user_id)->update([
                        'is_active' => false,
                        'updated_at' => now(),
                    ]);
                }
            }
        });

        Audit::log('teacher.delete', 'teacher', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, before: [
            'full_name' => $teacher->full_name,
            'had_login' => $teacher->user_id !== null,
            'removed' => $removed,
        ]);

        return response()->json(['ok' => true]);
    }

    /**
     * Create a TEACHER login (users row + role) inside the current academy context. When the
     * owner supplies a password the teacher can sign in immediately with it; otherwise a random
     * one is set and the account waits on a set-password flow (parallel to owner provisioning).
     */
    private function provisionLogin(string $academyId, string $fullName, string $email, ?string $password = null): string
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
            'role' => 'TEACHER',
        ]);

        Audit::log('user.invite', 'user', $userId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: ['email' => $email]);
        Audit::log('role.assign', 'user_role', $userId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: ['role' => 'TEACHER']);

        return $userId;
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        $rules = [
            'full_name' => [$req, 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'specialization' => ['nullable', 'string', 'max:255'],
            'session_rate_minor' => [$req, 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'timezone' => ['nullable', 'string', 'max:64'],
            'availability' => ['sometimes', 'array'],
            'availability.*.weekday' => ['required_with:availability', 'integer', 'between:0,6'],
            'availability.*.start_local' => ['required_with:availability', 'string', 'regex:/^\d{2}:\d{2}$/'],
            'availability.*.end_local' => ['required_with:availability', 'string', 'regex:/^\d{2}:\d{2}$/'],
        ];

        if ($creating) {
            $rules['create_login'] = ['sometimes', 'boolean'];
            $rules['email'] = ['required_if:create_login,true', 'nullable', 'email', 'max:255'];
            $rules['password'] = ['required_if:create_login,true', 'nullable', 'string', 'min:8', 'max:255'];
        }

        return $request->validate($rules);
    }
}
