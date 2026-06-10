<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\Phone;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Students — the learner (R-STU). Each belongs to exactly one guardian (the adult-solo case
 * still gets a real guardian row, R-STU-2). Price lives on the per-student subscription, never
 * the student (R-STU-4); the active teacher is a close+open assignment with full history
 * (R-STU-3). All money is integer minor units; currencies may differ per student (AC-4.6).
 *
 * A TEACHER may read ONLY their currently-assigned students (Sprint 2 §3.6): the list is
 * row-scoped and detail/history endpoints reject a student they do not teach (AC-4.10).
 */
final class StudentController extends Controller
{
    use InteractsWithPeople;

    private const PRICE_BASES = ['PER_SESSION', 'PER_MONTH'];

    private const SUB_STATUSES = ['ACTIVE', 'PAUSED', 'ENDED'];

    /** GET /api/students — server-driven DataTable joined to guardian, active sub & teacher. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('student.read');

        $query = $this->baseListQuery();
        $this->applyActiveScope($query, $request, 's.deleted_at');
        $this->applyTeacherRowScope($query);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 's.id',
            'searchable' => ['s.full_name', 'g.full_name', 's.whatsapp_phone'],
            'sortable' => [
                'name' => 's.full_name',
                'price' => 'sub.price_minor',
                'start_date' => 'sub.start_date',
                'created_at' => 's.created_at',
            ],
            'filters' => [
                'teacher_id' => fn (Builder $q, $value) => $q->where('sta.teacher_id', (string) $value),
                'subscription_status' => fn (Builder $q, $value) => $q->where('sub.status', (string) $value),
            ],
            'defaultSort' => 'name',
        ]);

        return response()->json($result);
    }

    /** POST /api/students — create student (+ optional inline subscription + teacher assignment). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('student.create');

        $academyId = $this->currentAcademyId();
        $data = $this->validateStudent($request, creating: true);

        $selfGuardian = (bool) ($data['is_self_guardian'] ?? false);

        // R-STU-2: an adult-solo student still gets a real guardian row, mirrored from their
        // own details, so Sprint 7 invoicing always has a consistent billing anchor.
        if ($selfGuardian) {
            $guardianId = $this->createSelfGuardian($academyId, $data);
        } else {
            $guardianId = $data['guardian_id'];
            $exists = DB::table('guardians')->where('id', $guardianId)->whereNull('deleted_at')->exists();
            if (! $exists) {
                throw ValidationException::withMessages(['guardian_id' => ['Unknown or inactive guardian.']]);
            }
        }

        $studentId = (string) Str::uuid();
        DB::table('students')->insert([
            'id' => $studentId,
            'academy_id' => $academyId,
            'guardian_id' => $guardianId,
            'full_name' => $data['full_name'],
            'whatsapp_phone' => Phone::normalize($data['whatsapp_phone'] ?? null, 'whatsapp_phone'),
            'country' => $data['country'] ?? null,
            'status' => $data['status'] ?? 'REGULAR',
            'is_self_guardian' => $selfGuardian,
            'notes' => $data['notes'] ?? null,
        ]);
        Audit::log('student.create', 'student', $studentId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $data['full_name'],
            'guardian_id' => $guardianId,
            'is_self_guardian' => $selfGuardian,
        ]);

        // Optional inline subscription (the per-student price, R-STU-4).
        if (isset($data['subscription'])) {
            $this->writeSubscription($academyId, $studentId, $data['subscription'], replace: false);
        }

        // Optional inline first teacher assignment (R-STU-3).
        if (! empty($data['teacher_id'])) {
            $this->openAssignment($academyId, $studentId, $data['teacher_id'], now());
            Audit::log('student.teacher_reassigned', 'student', $studentId, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['teacher_id' => $data['teacher_id'], 'effective_date' => now()->toDateString()],
                before: ['teacher_id' => null]);
        }

        return response()->json(['studentId' => $studentId, 'guardianId' => $guardianId], 201);
    }

    /** GET /api/students/{id} — detail: subscription, current teacher, guardian. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('student.read');

        $student = DB::table('students')->where('id', $id)->first();
        if ($student === null) {
            abort(404, 'Student not found.');
        }
        $this->assertTeacherMayRead($id);

        $guardian = DB::table('guardians')->where('id', $student->guardian_id)->first();
        $subscription = $this->activeSubscription($id);
        $current = DB::table('student_teacher_assignments as a')
            ->leftJoin('teachers as t', 't.id', '=', 'a.teacher_id')
            ->where('a.student_id', $id)
            ->whereNull('a.ended_at')
            ->first(['a.teacher_id', 't.full_name as teacher_name', 'a.started_at']);

        return response()->json([
            'student' => $student,
            'guardian' => $guardian,
            'subscription' => $subscription,
            'currentTeacher' => $current,
        ]);
    }

    /** PATCH /api/students/{id} — edit the student's own fields. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.update');

        $existing = DB::table('students')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Student not found.');
        }

        $data = $this->validateStudent($request, creating: false);
        if (array_key_exists('whatsapp_phone', $data)) {
            $data['whatsapp_phone'] = Phone::normalize($data['whatsapp_phone'], 'whatsapp_phone');
        }

        $before = [];
        $after = [];
        foreach (['full_name', 'whatsapp_phone', 'country', 'status', 'notes'] as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col] = $data[$col];
            }
        }
        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('students')->where('id', $id)->update($after + ['updated_at' => now()]);
        Audit::log('student.update', 'student', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /** POST /api/students/{id}/deactivate — soft-delete; history preserved (AC-4.7). */
    public function deactivate(string $id): JsonResponse
    {
        Gate::authorize('student.deactivate');

        $student = DB::table('students')->where('id', $id)->whereNull('deleted_at')->first();
        if ($student === null) {
            abort(404, 'Student not found.');
        }

        DB::table('students')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        Audit::log('student.deactivate', 'student', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: ['deleted_at' => now()->toIso8601String()]);

        return response()->json(['ok' => true]);
    }

    /** PUT /api/students/{id}/subscription — set/replace the single active subscription (TC-4.9). */
    public function setSubscription(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.update');

        $academyId = $this->currentAcademyId();
        if (DB::table('students')->where('id', $id)->whereNull('deleted_at')->doesntExist()) {
            abort(404, 'Student not found.');
        }

        $data = $this->validateSubscription($request->input('subscription', $request->all()));
        $subId = $this->writeSubscription($academyId, $id, $data, replace: true);

        return response()->json(['subscriptionId' => $subId], 200);
    }

    /** PATCH /api/students/{id}/subscription/price — change price (audited, future-only). */
    public function changePrice(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.update');

        $academyId = $this->currentAcademyId();
        $sub = $this->activeSubscription($id);
        if ($sub === null) {
            abort(422, 'This student has no active subscription to reprice.');
        }

        $data = $request->validate([
            'price_minor' => ['required', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'price_basis' => ['sometimes', Rule::in(self::PRICE_BASES)],
        ]);

        $after = ['price_minor' => $data['price_minor']];
        $before = ['price_minor' => $sub->price_minor];
        if (isset($data['currency'])) {
            $after['currency'] = strtoupper($data['currency']);
            $before['currency'] = $sub->currency;
        }
        if (isset($data['price_basis'])) {
            $after['price_basis'] = $data['price_basis'];
            $before['price_basis'] = $sub->price_basis;
        }

        // Forward-only: start_date is untouched, so already-closed invoices (Sprint 7) are never
        // back-dated (R-INV-3, decision §3.2). Only future billing sees the new price.
        DB::table('subscriptions')->where('id', $sub->id)->update($after + ['updated_at' => now()]);
        Audit::log('subscription.price_changed', 'subscription', $sub->id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true]);
    }

    /** POST /api/students/{id}/teacher — reassign teacher (close current + open new, audited). */
    public function reassignTeacher(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.update');

        $academyId = $this->currentAcademyId();
        if (DB::table('students')->where('id', $id)->whereNull('deleted_at')->doesntExist()) {
            abort(404, 'Student not found.');
        }

        $data = $request->validate([
            'teacher_id' => ['required', 'uuid'],
            'effective_date' => ['sometimes', 'nullable', 'date'],
        ]);
        $this->assertActiveTeacher($data['teacher_id']);

        $effective = ! empty($data['effective_date']) ? $data['effective_date'] : now();
        $previous = $this->openAssignment($academyId, $id, $data['teacher_id'], $effective);

        Audit::log('student.teacher_reassigned', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['teacher_id' => $data['teacher_id'], 'effective_date' => (string) $effective],
            before: ['teacher_id' => $previous]);

        return response()->json(['ok' => true]);
    }

    /** GET /api/students/{id}/teacher-history — every assignment, current + historical. */
    public function teacherHistory(string $id): JsonResponse
    {
        Gate::authorize('student.read');

        if (DB::table('students')->where('id', $id)->doesntExist()) {
            abort(404, 'Student not found.');
        }
        $this->assertTeacherMayRead($id);

        $history = DB::table('student_teacher_assignments as a')
            ->leftJoin('teachers as t', 't.id', '=', 'a.teacher_id')
            ->where('a.student_id', $id)
            ->orderByDesc('a.started_at')
            ->get(['a.id', 'a.teacher_id', 't.full_name as teacher_name', 'a.started_at', 'a.ended_at']);

        return response()->json(['history' => $history]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** The DataTable base query: student + guardian + the one active sub + the active teacher. */
    private function baseListQuery(): Builder
    {
        return DB::table('students as s')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->leftJoin('subscriptions as sub', function ($j): void {
                $j->on('sub.student_id', '=', 's.id')
                    ->whereNull('sub.deleted_at')
                    ->where('sub.status', '=', 'ACTIVE');
            })
            ->leftJoin('student_teacher_assignments as sta', function ($j): void {
                $j->on('sta.student_id', '=', 's.id')->whereNull('sta.ended_at');
            })
            ->leftJoin('teachers as t', 't.id', '=', 'sta.teacher_id')
            ->select([
                's.id', 's.full_name', 's.whatsapp_phone', 's.status', 's.is_self_guardian',
                's.guardian_id', 's.deleted_at', 's.created_at',
                'g.full_name as guardian_name',
                'sub.id as subscription_id', 'sub.price_minor', 'sub.currency as price_currency',
                'sub.price_basis', 'sub.plan_label', 'sub.sessions_per_month',
                'sub.start_date', 'sub.status as subscription_status',
                'sta.teacher_id', 't.full_name as teacher_name',
            ]);
    }

    /** Restrict the list to the calling teacher's currently-assigned students (§3.6). */
    private function applyTeacherRowScope(Builder $query): void
    {
        $ctx = $this->ctx();
        if ($ctx->role !== 'TEACHER') {
            return;
        }

        $teacherId = DB::table('teachers')->where('user_id', $ctx->userId)->value('id');
        $query->whereExists(function ($q) use ($teacherId): void {
            $q->select(DB::raw(1))
                ->from('student_teacher_assignments as ta')
                ->whereColumn('ta.student_id', 's.id')
                ->whereNull('ta.ended_at')
                ->where('ta.teacher_id', $teacherId);
        });
    }

    /** A teacher may only read a student they currently teach; others fall through (owner/admin). */
    private function assertTeacherMayRead(string $studentId): void
    {
        $ctx = $this->ctx();
        if ($ctx->role !== 'TEACHER') {
            return;
        }

        $teacherId = DB::table('teachers')->where('user_id', $ctx->userId)->value('id');
        $teaches = $teacherId !== null && DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)
            ->where('teacher_id', $teacherId)
            ->whereNull('ended_at')
            ->exists();

        if (! $teaches) {
            abort(403, 'You may only view your own students.');
        }
    }

    /** Mirror the student's details into a fresh guardian row (adult-solo case). */
    private function createSelfGuardian(string $academyId, array $data): string
    {
        $guardianId = (string) Str::uuid();
        DB::table('guardians')->insert([
            'id' => $guardianId,
            'academy_id' => $academyId,
            'full_name' => $data['full_name'],
            'whatsapp_phone' => Phone::normalize($data['whatsapp_phone'] ?? null, 'whatsapp_phone')
                ?? throw ValidationException::withMessages(['whatsapp_phone' => ['A self-guardian student needs a WhatsApp number for billing.']]),
            'country' => $data['country'] ?? null,
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
        ]);
        Audit::log('guardian.create', 'guardian', $guardianId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $data['full_name'],
            'self_guardian' => true,
        ]);

        return $guardianId;
    }

    /**
     * Insert a subscription; when $replace, first end any current ACTIVE one so exactly one
     * stays active (TC-4.9). Returns the new subscription id.
     *
     * @param  array<string,mixed>  $data
     */
    private function writeSubscription(string $academyId, string $studentId, array $data, bool $replace): string
    {
        if ($replace) {
            DB::table('subscriptions')
                ->where('student_id', $studentId)
                ->where('status', 'ACTIVE')
                ->update(['status' => 'ENDED', 'updated_at' => now()]);
        }

        $subId = (string) Str::uuid();
        DB::table('subscriptions')->insert([
            'id' => $subId,
            'academy_id' => $academyId,
            'student_id' => $studentId,
            'plan_label' => $data['plan_label'],
            'sessions_per_month' => $data['sessions_per_month'] ?? null,
            'price_minor' => $data['price_minor'],
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'price_basis' => $data['price_basis'] ?? 'PER_SESSION',
            'status' => $data['status'] ?? 'ACTIVE',
            'start_date' => $data['start_date'],
        ]);
        Audit::log('subscription.set', 'subscription', $subId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'price_minor' => $data['price_minor'],
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'price_basis' => $data['price_basis'] ?? 'PER_SESSION',
        ]);

        return $subId;
    }

    /**
     * Close the current active assignment and open a new one, in this order so the partial
     * unique index (one active per student) is never violated mid-flight. Returns the previous
     * teacher id, or null when this is the first assignment.
     */
    private function openAssignment(string $academyId, string $studentId, string $teacherId, $effective): ?string
    {
        $current = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)
            ->whereNull('ended_at')
            ->first();

        $previous = $current?->teacher_id;
        if ($current !== null) {
            DB::table('student_teacher_assignments')->where('id', $current->id)
                ->update(['ended_at' => $effective, 'updated_at' => now()]);
        }

        DB::table('student_teacher_assignments')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'started_at' => $effective,
            'ended_at' => null,
        ]);

        return $previous;
    }

    private function activeSubscription(string $studentId): ?object
    {
        return DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->first();
    }

    private function assertActiveTeacher(string $teacherId): void
    {
        $ok = DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->exists();
        if (! $ok) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown or inactive teacher.']]);
        }
    }

    /** @return array<string,mixed> */
    private function validateStudent(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        $rules = [
            'full_name' => [$req, 'string', 'max:255'],
            'whatsapp_phone' => ['nullable', 'string', 'max:32'],
            'country' => ['nullable', 'string', 'max:2'],
            'status' => ['sometimes', 'nullable', 'string', 'max:32'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];

        if ($creating) {
            $rules['is_self_guardian'] = ['sometimes', 'boolean'];
            // Presence is enforced in store(): required unless is_self_guardian (R-STU-2).
            $rules['guardian_id'] = ['nullable', 'uuid'];
            $rules['currency'] = ['sometimes', 'nullable', 'string', 'size:3'];
            $rules['teacher_id'] = ['sometimes', 'nullable', 'uuid'];
            $rules['subscription'] = ['sometimes', 'array'];
            $rules += $this->subscriptionRules('subscription.');
        }

        return $request->validate($rules);
    }

    /** @return array<string,mixed> */
    private function validateSubscription(array $payload): array
    {
        $validator = validator($payload, [
            'plan_label' => ['required', 'string', 'max:255'],
            'sessions_per_month' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000'],
            'price_minor' => ['required', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'price_basis' => ['sometimes', Rule::in(self::PRICE_BASES)],
            'status' => ['sometimes', Rule::in(self::SUB_STATUSES)],
            'start_date' => ['required', 'date'],
        ]);

        return $validator->validate();
    }

    /**
     * Inline-subscription rules, prefixed so they nest under POST /students { subscription: … }.
     *
     * @return array<string,mixed>
     */
    private function subscriptionRules(string $prefix): array
    {
        return [
            "{$prefix}plan_label" => ['required_with:subscription', 'string', 'max:255'],
            "{$prefix}sessions_per_month" => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000'],
            "{$prefix}price_minor" => ['required_with:subscription', 'integer', 'min:0'],
            "{$prefix}currency" => ['sometimes', 'nullable', 'string', 'size:3'],
            "{$prefix}price_basis" => ['sometimes', Rule::in(self::PRICE_BASES)],
            "{$prefix}start_date" => ['required_with:subscription', 'date'],
        ];
    }
}
