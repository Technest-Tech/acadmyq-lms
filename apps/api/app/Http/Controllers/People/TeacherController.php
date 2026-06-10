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
        $data = $this->validatePayload($request, creating: true);

        $teacherId = (string) Str::uuid();
        $userId = null;

        // Optional teacher login. Owner-only sub-action — guarded by the same caps as Sprint 3
        // owner provisioning, so a role without them cannot mint users via this path.
        if (($data['create_login'] ?? false) === true) {
            Gate::authorize('user.invite');
            Gate::authorize('role.assign');
            $userId = $this->provisionLogin($academyId, $data['full_name'], strtolower((string) $data['email']));
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

        return response()->json(['teacher' => $teacher, 'students' => $students]);
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

    /** Create a TEACHER login (users row + role) inside the current academy context. */
    private function provisionLogin(string $academyId, string $fullName, string $email): string
    {
        $userId = (string) Str::uuid();

        try {
            DB::table('users')->insert([
                'id' => $userId,
                'academy_id' => $academyId,
                'full_name' => $fullName,
                'email' => $email,
                'password' => Hash::make(Str::random(40)),
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
        }

        return $request->validate($rules);
    }
}
