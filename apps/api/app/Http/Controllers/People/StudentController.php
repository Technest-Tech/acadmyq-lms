<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Services\Invoicing;
use App\Services\LessonPackages;
use App\Services\SessionGenerator;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\Entitlement;
use App\Support\Phone;
use App\Support\StudentStatus;
use App\Support\StudentTeachers;
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
 * the student (R-STU-4). A student may have several teachers at once, one per course; each
 * teacher is a close+open assignment with full history (R-STU-3), and each has their own
 * timetable. All money is integer minor units; currencies may differ per student (AC-4.6).
 *
 * A TEACHER may read ONLY their currently-assigned students (Sprint 2 §3.6): the list is
 * row-scoped and detail/history endpoints reject a student they do not teach (AC-4.10).
 */
final class StudentController extends Controller
{
    use InteractsWithPeople;

    private const PRICE_BASES = ['PER_SESSION', 'PER_MONTH', 'PER_HOUR', 'PER_PACKAGE'];

    private const SUB_STATUSES = ['ACTIVE', 'PAUSED', 'ENDED'];

    public function __construct(private readonly SessionGenerator $generator) {}

    /** GET /api/students — server-driven DataTable joined to guardian, active sub & teacher. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('student.read');

        $query = $this->baseListQuery();
        $this->applyActiveScope($query, $request, 's.deleted_at');
        $this->applyTeacherRowScope($query);

        // Withholding the power to reprice is pointless if the rate is still printed in the list,
        // so a caller without `student.set_price` gets neither the number nor a sort that would
        // rank students by it (ordering by a hidden column leaks the ordering).
        $seesPricing = $this->seesPricing();

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 's.id',
            'searchable' => ['s.full_name', 'g.full_name', 's.whatsapp_phone'],
            'sortable' => [
                'name' => 's.full_name',
                ...($seesPricing ? ['price' => 'sub.price_minor'] : []),
                'start_date' => 'sub.start_date',
                'created_at' => 's.created_at',
            ],
            'filters' => [
                // ANY of the student's teachers — not just the first one the row happens to show.
                'teacher_id' => fn (Builder $q, $value) => $q->whereExists(function ($e) use ($value): void {
                    $e->select(DB::raw(1))->from('student_teacher_assignments as fa')
                        ->whereColumn('fa.student_id', 's.id')
                        ->whereNull('fa.ended_at')
                        ->where('fa.teacher_id', (string) $value);
                }),
                'subscription_status' => fn (Builder $q, $value) => $q->where('sub.status', (string) $value),
                'student_status' => fn (Builder $q, $value) => $q->where('s.status', (string) $value),
                'trial_any' => fn (Builder $q, $value) => $value === '1' ? $q->whereIn('s.status', [StudentStatus::TRIAL, StudentStatus::TRIAL_BOOKED]) : null,
            ],
            'defaultSort' => 'name',
        ]);

        $result['rows'] = $result['rows']->map(StudentTeachers::decodeRow(...));
        if (! $seesPricing) {
            $result['rows'] = $result['rows']->map($this->redactPricing(...));
        }

        return response()->json($result);
    }

    /** POST /api/students — create student (+ optional inline subscription + their teachers). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('student.create');

        $academyId = $this->currentAcademyId();

        // Plan limit: BASIC caps students (AC-9.2). Checked before any write so the 31st
        // student on a 30-cap plan is rejected with an at-limit/upgrade message, not created.
        $this->enforceLimit($academyId, 'students', 'maxStudents', 'students');

        $data = $this->validateStudent($request, creating: true);

        // An inline package is the other billing clock, chosen at the moment the student is
        // created — so the owner never has to create them, then go to /packages, then find them
        // again. Every check happens BEFORE the first write: a refused package must not leave a
        // half-created student behind.
        $package = $data['package'] ?? null;
        if ($package !== null) {
            if (isset($data['subscription'])) {
                // The two clocks are mutually exclusive; accepting both would be a double bill.
                throw ValidationException::withMessages([
                    'package' => ['Choose monthly billing or a lesson package, not both. / اختر الفوترة الشهرية أو باقة الحصص، وليس الاثنين معًا.'],
                ]);
            }
            // Selling a block names a price AND opens a package, so it needs both rights — and the
            // plan must include invoicing, the same entitlement that gates /api/packages. Without
            // this the create form would be a way around the 402.
            Gate::authorize('student.set_price');
            Gate::authorize('package.manage');
            if (! Entitlement::check($this->ctx(), 'invoicing')) {
                return response()->json([
                    'error' => 'upgrade_required',
                    'message' => 'Lesson packages are not included in your current plan.',
                    'feature' => 'invoicing',
                ], 402);
            }
        }

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
            'status' => $data['status'] ?? StudentStatus::REGULAR,
            'is_self_guardian' => $selfGuardian,
            'notes' => $data['notes'] ?? null,
        ]);
        Audit::log('student.create', 'student', $studentId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $data['full_name'],
            'guardian_id' => $guardianId,
            'is_self_guardian' => $selfGuardian,
        ]);

        // Optional inline subscription (the per-student price, R-STU-4). Naming a price is a
        // pricing act wherever it happens, so it needs `student.set_price` even on the create
        // form — otherwise a role denied repricing could set any rate it liked at enrolment.
        if (isset($data['subscription'])) {
            Gate::authorize('student.set_price');
            $this->writeSubscription($academyId, $studentId, $data['subscription'], replace: false);
        }

        // The package path. LessonPackages::open() creates the PER_PACKAGE subscription itself
        // (ensurePackageBilling), so a package student is REGULAR from the first second with a
        // billing anchor, and the package is on /packages the moment this returns. The request
        // runs in one tenant transaction, so a package that fails to open rolls the student back
        // with it rather than leaving a learner nobody bills.
        $packageResult = null;
        if ($package !== null) {
            $packageResult = app(LessonPackages::class)->open([
                'student_id' => $studentId,
                'label' => (string) $package['label'],
                'minutes_total' => (int) round(((float) $package['hours']) * 60),
                'price_minor' => (int) $package['price_minor'],
                'currency' => $package['currency'] ?? null,
                'bill_timing' => $package['bill_timing'] ?? null,
                'starts_on' => $package['starts_on'] ?? null,
                'expires_on' => $package['expires_on'] ?? null,
                // A brand-new student has no earlier package to carry hours from.
                'carry_over' => false,
            ], $this->ctx()->userId, $this->ctx()->role);
        }

        // Optional inline teachers (R-STU-3) — one per course. `teacher_id` is the older
        // single-teacher shape, still accepted.
        $links = $this->normaliseLinks($data);
        foreach ($links as $link) {
            $this->assertActiveTeacher($link['teacher_id']);
            $this->openLink($academyId, $studentId, $link['teacher_id'], $link['course'], now());
            Audit::log('student.teacher_added', 'student', $studentId, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['teacher_id' => $link['teacher_id'], 'course' => $link['course'], 'effective_date' => now()->toDateString()]);
        }

        return response()->json([
            'studentId' => $studentId,
            'guardianId' => $guardianId,
            'packageId' => $packageResult['package_id'] ?? null,
            'packageInvoiceId' => $packageResult['invoice_id'] ?? null,
        ], 201);
    }

    /** GET /api/students/{id} — detail: subscription, teachers, guardian. */
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
        $teachers = StudentTeachers::active($id);

        // For a booked trial, has the trial session already been recorded (attended/cancelled/…)?
        // Drives the profile's "next step" call-to-action: once the trial is done the only path
        // left is to activate the student with pricing.
        $trialResolved = (string) $student->status === StudentStatus::TRIAL_BOOKED
            && DB::table('sessions')
                ->where('student_id', $id)
                ->whereNotIn('status', ['SCHEDULED', 'RESCHEDULED'])
                ->exists();

        return response()->json([
            'student' => $student,
            'guardian' => $guardian,
            'subscription' => $subscription !== null && ! $this->seesPricing()
                ? $this->redactPricing($subscription)
                : $subscription,
            'teachers' => $teachers->values(),
            // The first teacher, for callers that only ever wanted one (trial booking defaults).
            'currentTeacher' => $teachers->first(),
            'trialResolved' => $trialResolved,
        ]);
    }

    /**
     * PATCH /api/students/{id} — edit the student's own fields, and move them between families.
     *
     * `guardian_id` is the one field here that is not a plain column edit: it re-points the
     * learner at a different payer, so it validates the target, carries its own audit action
     * and drops the adult-solo flag (a student stops being their own guardian the moment a real
     * one takes over). The old self-guardian row is left alone — deactivating a record the user
     * did not ask about would be a surprise, and it is deactivatable from the parents page.
     */
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

        // Guard status transitions (R-STU). A plain edit may move between ACTIVE states only:
        //   - terminal states are reached solely via deactivate(), which preserves history and
        //     ends the active subscription + teacher assignment in one step;
        //   - a student cannot become REGULAR (the billable state) without an active
        //     subscription, or they would silently never be invoiced.
        if (array_key_exists('status', $data) && $data['status'] !== null && (string) $data['status'] !== (string) $existing->status) {
            $target = (string) $data['status'];
            if (StudentStatus::isTerminal($target)) {
                throw ValidationException::withMessages(['status' => ['Graduate or withdraw a student via deactivate, which preserves their history.']]);
            }
            if ($target === StudentStatus::REGULAR && $this->activeSubscription($id) === null) {
                throw ValidationException::withMessages(['status' => ['Set an active subscription before making this student REGULAR.']]);
            }
        }

        $before = [];
        $after = [];
        foreach (['full_name', 'whatsapp_phone', 'country', 'status', 'notes'] as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col] = $data[$col];
            }
        }

        // The move between families, kept apart from the field diff above so it gets its own
        // validation and its own audit line — "who pays for this child" is not a typo fix.
        $move = [];
        if (array_key_exists('guardian_id', $data) && $data['guardian_id'] !== null
            && (string) $data['guardian_id'] !== (string) $existing->guardian_id) {
            $target = DB::table('guardians')->where('id', $data['guardian_id'])->whereNull('deleted_at')->first();
            if ($target === null) {
                throw ValidationException::withMessages(['guardian_id' => ['Unknown or inactive guardian.']]);
            }
            $move = ['guardian_id' => (string) $data['guardian_id'], 'is_self_guardian' => false];
        }

        if ($after === [] && $move === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        $academyId = $this->currentAcademyId();
        DB::table('students')->where('id', $id)->update($after + $move + ['updated_at' => now()]);

        if ($after !== []) {
            Audit::log('student.update', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);
        }
        if ($move !== []) {
            Audit::log('student.guardian_reassigned', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: $move,
                before: ['guardian_id' => $existing->guardian_id, 'is_self_guardian' => $existing->is_self_guardian]);
        }

        return response()->json(['ok' => true, 'changed' => array_keys($after + $move)]);
    }

    /**
     * POST /api/students/{id}/deactivate — soft-delete; history preserved (AC-4.7). Records the
     * reason as the terminal status (default WITHDRAWN) and, atomically, ends the single active
     * subscription and closes the open teacher assignment so no dangling ACTIVE billing row or
     * open roster entry survives the learner leaving (R-STU-3/4).
     */
    public function deactivate(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.deactivate');

        $academyId = $this->currentAcademyId();
        $student = DB::table('students')->where('id', $id)->whereNull('deleted_at')->first();
        if ($student === null) {
            abort(404, 'Student not found.');
        }

        $reason = $request->validate([
            'reason' => ['sometimes', Rule::in(StudentStatus::TERMINAL)],
        ])['reason'] ?? StudentStatus::WITHDRAWN;

        $now = now();
        DB::transaction(function () use ($id, $academyId, $reason, $now, $student): void {
            $wound = $this->endActiveBilling($id, $now);

            DB::table('students')->where('id', $id)->update([
                'status' => $reason,
                'deleted_at' => $now,
                'updated_at' => $now,
            ]);

            Audit::log('student.deactivate', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: [
                    'status' => $reason,
                    'deleted_at' => $now->toIso8601String(),
                    'ended_subscription' => $wound['subscription'],
                    'closed_teacher_assignment' => $wound['assignment'],
                    'closed_package' => $wound['package'],
                    'ended_schedules' => $wound['schedules'],
                    'removed_future_sessions' => $wound['sessions_removed'],
                    'cancelled_unmarked_sessions' => $wound['sessions_cancelled'],
                ],
                before: ['status' => $student->status]);
        });

        return response()->json(['ok' => true]);
    }

    /**
     * DELETE /api/students/{id} — the owner-facing "remove from the system". Despite the verb
     * this is a RECOVERABLE soft-delete: physical deletion stays prohibited (design §3.7), so the
     * student row and every related record (subscriptions, sessions, invoices, …) remain in the
     * database and can be brought back via reactivate(). It hides the student from the roster and,
     * like deactivate, winds down everything still running (subscription, teacher assignment,
     * lesson package, timetable, unmarked lessons — see endActiveBilling) so nothing dangles.
     * The response tells the caller the removal is reversible.
     */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('student.deactivate');

        $academyId = $this->currentAcademyId();
        $student = DB::table('students')->where('id', $id)->whereNull('deleted_at')->first();
        if ($student === null) {
            abort(404, 'Student not found.');
        }

        $now = now();
        DB::transaction(function () use ($id, $academyId, $now, $student): void {
            $wound = $this->endActiveBilling($id, $now);

            DB::table('students')->where('id', $id)->update([
                'deleted_at' => $now,
                'updated_at' => $now,
            ]);

            Audit::log('student.delete', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: [
                    'deleted_at' => $now->toIso8601String(),
                    'recoverable' => true,
                    'ended_subscription' => $wound['subscription'],
                    'closed_teacher_assignment' => $wound['assignment'],
                    'closed_package' => $wound['package'],
                    'ended_schedules' => $wound['schedules'],
                    'removed_future_sessions' => $wound['sessions_removed'],
                    'cancelled_unmarked_sessions' => $wound['sessions_cancelled'],
                ],
                before: ['status' => $student->status]);
        });

        return response()->json([
            'ok' => true,
            'recoverable' => true,
            'message' => 'Student removed from your academy. The record and its history are retained and can be restored.',
        ]);
    }

    /**
     * POST /api/students/{id}/reactivate — undo a soft-delete, returning the learner to active
     * rosters as a plain REGULAR student. The subscription and teacher assignment ended at
     * deactivation are NOT auto-restored (their prices/teacher may have moved on) — re-add them
     * explicitly via the subscription/teacher endpoints.
     */
    public function reactivate(string $id): JsonResponse
    {
        Gate::authorize('student.deactivate');

        $academyId = $this->currentAcademyId();
        $student = DB::table('students')->where('id', $id)->whereNotNull('deleted_at')->first();
        if ($student === null) {
            abort(404, 'Student not found or already active.');
        }

        DB::table('students')->where('id', $id)->update([
            'status' => StudentStatus::REGULAR,
            'deleted_at' => null,
            'updated_at' => now(),
        ]);
        Audit::log('student.reactivate', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => StudentStatus::REGULAR, 'deleted_at' => null],
            before: ['status' => $student->status]);

        return response()->json(['ok' => true]);
    }

    /** PUT /api/students/{id}/subscription — set/replace the single active subscription (TC-4.9). */
    public function setSubscription(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.set_price');

        $academyId = $this->currentAcademyId();
        if (DB::table('students')->where('id', $id)->whereNull('deleted_at')->doesntExist()) {
            abort(404, 'Student not found.');
        }

        $data = $this->validateSubscription($request->input('subscription', $request->all()));
        $subId = $this->writeSubscription($academyId, $id, $data, replace: true);

        return response()->json([
            'subscriptionId' => $subId,
            'repriced' => $this->maybeRepriceOpenInvoices($request, $id, $academyId, $subId),
        ], 200);
    }

    /**
     * GET /api/students/{id}/subscription/reprice-preview — how many already-billed sessions on
     * how many OPEN invoices a reprice would recalculate. Read-only; drives the confirmation
     * text on the price dialog's "also update open invoices" option.
     */
    public function repricePreview(string $id): JsonResponse
    {
        Gate::authorize('student.set_price');

        return response()->json(app(Invoicing::class)->previewOpenInvoiceReprice($id));
    }

    /** PATCH /api/students/{id}/subscription/price — change price (audited, future-only). */
    public function changePrice(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.set_price');

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

        return response()->json([
            'ok' => true,
            'repriced' => $this->maybeRepriceOpenInvoices($request, $id, $academyId, (string) $sub->id),
        ]);
    }

    /**
     * Opt-in retroactive correction: when the caller passes `reprice_open`, replay the sessions
     * already billed onto this student's OPEN invoices at the new rate.
     *
     * Off by default, because the two reasons to change a price want opposite behaviour — a rate
     * that was simply typed wrong should fix the bill it has already produced, while a genuine
     * mid-month rate rise should NOT retroactively re-bill lessons taught at the old rate. Only
     * the person making the change knows which one this is, so they choose. Closed and paid
     * invoices are out of scope either way (R-INV-3).
     *
     * @return array{sessions:int, invoices:int}
     */
    private function maybeRepriceOpenInvoices(Request $request, string $studentId, string $academyId, string $subId): array
    {
        if (! $request->boolean('reprice_open')) {
            return ['sessions' => 0, 'invoices' => 0];
        }

        $result = app(Invoicing::class)->repriceOpenInvoicesForStudent($studentId);

        if ($result['sessions'] > 0) {
            Audit::log('subscription.open_invoices_repriced', 'subscription', $subId, $academyId,
                $this->ctx()->userId, $this->ctx()->role, after: $result);
        }

        return $result;
    }

    /**
     * POST /api/students/{id}/teacher — REPLACE one teacher with another from a date (close +
     * open, audited). The new teacher takes over the old one's course and timetable, so their
     * future lessons move across and nothing else about the student changes.
     *
     * `replaces_teacher_id` says which teacher is leaving. It may be omitted while the student has
     * at most one teacher (the original single-teacher call); with several it is required, because
     * guessing would hand the wrong course's lessons to the new teacher.
     */
    public function reassignTeacher(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.update');

        $academyId = $this->currentAcademyId();
        if (DB::table('students')->where('id', $id)->whereNull('deleted_at')->doesntExist()) {
            abort(404, 'Student not found.');
        }

        $data = $request->validate([
            'teacher_id' => ['required', 'uuid'],
            'replaces_teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'effective_date' => ['sometimes', 'nullable', 'date'],
        ]);
        $this->assertActiveTeacher($data['teacher_id']);

        $current = StudentTeachers::active($id)->keyBy(fn ($l) => (string) $l->teacher_id);
        $from = $data['replaces_teacher_id'] ?? null;
        if ($from === null) {
            if ($current->count() > 1) {
                throw ValidationException::withMessages([
                    'replaces_teacher_id' => ['This student has more than one teacher — choose which one to replace. / لهذا الطالب أكثر من معلّم، اختر المعلّم الذي تريد استبداله.'],
                ]);
            }
            $from = $current->keys()->first();
        } elseif (! $current->has($from)) {
            throw ValidationException::withMessages(['replaces_teacher_id' => ['That teacher does not teach this student. / هذا المعلّم لا يدرّس هذا الطالب.']]);
        }

        $to = (string) $data['teacher_id'];
        if ($from === $to) {
            return response()->json(['ok' => true]);
        }
        if ($current->has($to)) {
            throw ValidationException::withMessages(['teacher_id' => ['This teacher already teaches this student. / هذا المعلّم يدرّس هذا الطالب بالفعل.']]);
        }

        $effective = ! empty($data['effective_date']) ? $data['effective_date'] : now();
        $course = $from !== null ? $current->get($from)->course : null;
        if ($from !== null) {
            $this->closeLink($id, $from, $effective);
            // The leaving teacher's timetable becomes the new teacher's — same days, same times.
            DB::table('schedules')
                ->where('student_id', $id)->where('teacher_id', $from)
                ->where('is_active', true)->whereNull('deleted_at')
                ->update(['teacher_id' => $to, 'updated_at' => now()]);
        }
        $this->openLink($academyId, $id, $to, $course, $effective);

        Audit::log('student.teacher_reassigned', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['teacher_id' => $to, 'course' => $course, 'effective_date' => (string) $effective],
            before: ['teacher_id' => $from]);

        // Re-point this student's FUTURE untouched sessions to the newly assigned teacher, so the
        // teacher sees them immediately instead of waiting for the next schedule edit / monthly
        // roll (the generator reads each timetable's teacher, TC-5.25).
        $this->regenerateStudentSessions($id);

        return response()->json(['ok' => true]);
    }

    /**
     * PUT /api/students/{id}/teachers — the student's full set of teachers, each with the course
     * they teach: `{teachers: [{teacher_id, course?}], effective_date?}`. The server diffs it
     * against the open links:
     *   - a new teacher opens a link (they get a timetable from the Schedule tab, as any teacher);
     *   - a kept teacher keeps their link and history; only a changed course is written;
     *   - a dropped teacher's link closes AND their timetable for this student ends, removing
     *     their future untouched lessons (past and marked ones are history and stay). Ending a
     *     timetable is a scheduling act, so that part needs `schedule.manage` as well.
     */
    public function setTeachers(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.update');

        $academyId = $this->currentAcademyId();
        if (DB::table('students')->where('id', $id)->whereNull('deleted_at')->doesntExist()) {
            abort(404, 'Student not found.');
        }

        $data = $request->validate([
            'teachers' => ['present', 'array', 'max:20'],
            'teachers.*.teacher_id' => ['required', 'uuid', 'distinct'],
            'teachers.*.course' => ['sometimes', 'nullable', 'string', 'max:120'],
            'effective_date' => ['sometimes', 'nullable', 'date'],
        ]);
        $effective = ! empty($data['effective_date']) ? $data['effective_date'] : now();

        $desired = collect($this->normaliseLinks($data))->keyBy('teacher_id');
        $current = StudentTeachers::active($id)->keyBy(fn ($l) => (string) $l->teacher_id);

        $removed = $current->keys()->diff($desired->keys())->values();
        $added = $desired->keys()->diff($current->keys())->values();

        foreach ($added as $teacherId) {
            $this->assertActiveTeacher((string) $teacherId);
        }

        $endingSchedules = $removed->isEmpty() ? collect() : DB::table('schedules')
            ->where('student_id', $id)->whereIn('teacher_id', $removed->all())
            ->where('is_active', true)->whereNull('deleted_at')
            ->pluck('id');
        if ($endingSchedules->isNotEmpty()) {
            Gate::authorize('schedule.manage');
        }

        foreach ($removed as $teacherId) {
            $this->closeLink($id, (string) $teacherId, $effective);
            Audit::log('student.teacher_removed', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['effective_date' => (string) $effective],
                before: ['teacher_id' => (string) $teacherId, 'course' => $current->get($teacherId)->course]);
        }

        $lessonsRemoved = 0;
        if ($endingSchedules->isNotEmpty()) {
            DB::table('schedules')->whereIn('id', $endingSchedules->all())
                ->update(['is_active' => false, 'deleted_at' => now(), 'updated_at' => now()]);
            // Inactive timetable → empty intended set → only future untouched lessons are deleted.
            [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
            foreach ($endingSchedules as $scheduleId) {
                $lessonsRemoved += $this->generator->generateForSchedule((string) $scheduleId, $windowStart, $windowEnd)['removed'];
                Audit::log('schedule.deleted', 'schedule', (string) $scheduleId, $academyId, $this->ctx()->userId, $this->ctx()->role,
                    before: ['student_id' => $id, 'is_active' => true]);
            }
        }

        foreach ($added as $teacherId) {
            $course = $desired->get($teacherId)['course'];
            $this->openLink($academyId, $id, (string) $teacherId, $course, $effective);
            Audit::log('student.teacher_added', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['teacher_id' => (string) $teacherId, 'course' => $course, 'effective_date' => (string) $effective]);
        }

        foreach ($desired as $teacherId => $link) {
            $before = $current->get($teacherId);
            if ($before === null || (string) $before->course === (string) $link['course']) {
                continue;
            }
            DB::table('student_teacher_assignments')
                ->where('student_id', $id)->where('teacher_id', $teacherId)->whereNull('ended_at')
                ->update(['course' => $link['course'], 'updated_at' => now()]);
            Audit::log('student.teacher_course_changed', 'student', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['teacher_id' => (string) $teacherId, 'course' => $link['course']],
                before: ['teacher_id' => (string) $teacherId, 'course' => $before->course]);
        }

        return response()->json([
            'ok' => true,
            'added' => $added->all(),
            'removed' => $removed->all(),
            'timetables_ended' => $endingSchedules->count(),
            'lessons_removed' => $lessonsRemoved,
        ]);
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
            ->get(['a.id', 'a.teacher_id', 't.full_name as teacher_name', 'a.course', 'a.started_at', 'a.ended_at']);

        return response()->json(['history' => $history]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * May the caller see what a student PAYS? The same capability that lets them change it —
     * a role denied repricing (SUPERVISOR) is denied the rate itself, not just the button.
     */
    private function seesPricing(): bool
    {
        return Gate::allows('student.set_price');
    }

    /**
     * Blank the money on one student/subscription row, leaving everything a non-financial role
     * legitimately needs: the plan's label, how many sessions a month it buys, when it started
     * and whether it is active. The keys stay PRESENT and null so the shape never changes —
     * a missing key would read as "no subscription" rather than "not your business".
     */
    private function redactPricing(object $row): object
    {
        foreach (['price_minor', 'price_currency', 'price_basis', 'currency'] as $key) {
            if (property_exists($row, $key)) {
                $row->{$key} = null;
            }
        }

        return $row;
    }

    /**
     * The DataTable base query: student + guardian + the one active sub + their teachers. The
     * teachers come pre-aggregated (StudentTeachers::summary) — joining the assignments directly
     * would print a student once per teacher.
     */
    private function baseListQuery(): Builder
    {
        return DB::table('students as s')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->leftJoin('subscriptions as sub', function ($j): void {
                $j->on('sub.student_id', '=', 's.id')
                    ->whereNull('sub.deleted_at')
                    ->where('sub.status', '=', 'ACTIVE');
            })
            ->leftJoinSub(StudentTeachers::summary(), 'sta', 'sta.student_id', '=', 's.id')
            ->select([
                's.id', 's.full_name', 's.whatsapp_phone', 's.country', 's.status', 's.is_self_guardian',
                's.guardian_id', 's.deleted_at', 's.created_at',
                'g.full_name as guardian_name',
                'sub.id as subscription_id', 'sub.price_minor', 'sub.currency as price_currency',
                'sub.price_basis', 'sub.plan_label', 'sub.sessions_per_month',
                'sub.start_date', 'sub.status as subscription_status',
                'sta.teacher_id', 'sta.teacher_name', 'sta.teachers',
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

    /** Open a link between a student and one of their teachers. */
    private function openLink(string $academyId, string $studentId, string $teacherId, ?string $course, $effective): void
    {
        DB::table('student_teacher_assignments')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'course' => $course,
            'started_at' => $effective,
            'ended_at' => null,
        ]);
    }

    /** Close the open link for this pair; the row stays as history. */
    private function closeLink(string $studentId, string $teacherId, $effective): void
    {
        DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)->where('teacher_id', $teacherId)->whereNull('ended_at')
            ->update(['ended_at' => $effective, 'updated_at' => now()]);
    }

    /**
     * The teacher links a request asked for, as `[{teacher_id, course}]` with blank courses null
     * and each teacher once. Accepts `teachers` and the older single `teacher_id`.
     *
     * @param  array<string,mixed>  $data
     * @return list<array{teacher_id: string, course: ?string}>
     */
    private function normaliseLinks(array $data): array
    {
        $rows = $data['teachers'] ?? [];
        if ($rows === [] && ! empty($data['teacher_id'])) {
            $rows = [['teacher_id' => $data['teacher_id']]];
        }

        $links = [];
        foreach ($rows as $row) {
            $teacherId = (string) $row['teacher_id'];
            $course = trim((string) ($row['course'] ?? ''));
            $links[$teacherId] = ['teacher_id' => $teacherId, 'course' => $course === '' ? null : $course];
        }

        return array_values($links);
    }

    /**
     * Reconcile the student's active schedule(s) over the rolling window so future untouched
     * sessions re-point to the student's currently active teacher. Idempotent and future-only —
     * past and touched sessions are never rewritten (§4.5). A student with no active schedule is
     * a no-op. Runs inside the request's tenant context; RLS is the backstop.
     */
    private function regenerateStudentSessions(string $studentId): void
    {
        $scheduleIds = DB::table('schedules')
            ->where('student_id', $studentId)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->pluck('id');

        if ($scheduleIds->isEmpty()) {
            return;
        }

        [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
        foreach ($scheduleIds as $scheduleId) {
            $this->generator->generateForSchedule((string) $scheduleId, $windowStart, $windowEnd);
        }
    }

    /**
     * Wind down everything still running for a student who is leaving (shared by deactivate and
     * the recoverable delete): the ACTIVE subscription, the open teacher assignment, the open
     * lesson package, the timetable, and every lesson still waiting to be marked. Without the last
     * three a removed student kept a live package, kept generating lessons, and their unmarked
     * lessons sat in الحصص المعلقة, fired "not marked" group alerts and docked the teacher forever.
     *
     * @return array{subscription: bool, assignment: bool, package: ?string, schedules: int, sessions_removed: int, sessions_cancelled: int}
     */
    private function endActiveBilling(string $studentId, $now): array
    {
        // The package first, while the subscription that describes it is still ACTIVE.
        $package = $this->closeOpenPackage($studentId);

        $endedSubscription = DB::table('subscriptions')
            ->where('student_id', $studentId)->where('status', 'ACTIVE')->whereNull('deleted_at')
            ->update(['status' => 'ENDED', 'updated_at' => $now]);

        $closedAssignment = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)->whereNull('ended_at')
            ->update(['ended_at' => $now, 'updated_at' => $now]);

        return [
            'subscription' => $endedSubscription > 0,
            'assignment' => $closedAssignment > 0,
            'package' => $package,
        ] + $this->windDownLessons($studentId, $now);
    }

    /**
     * Close the student's open lesson package. An untouched one is voided; one with hours already
     * used is closed the way an owner closes one early, so ON_COMPLETION still bills what was
     * actually consumed. Returns what happened (CANCELLED / COMPLETED) or null when none was open.
     */
    private function closeOpenPackage(string $studentId): ?string
    {
        $packages = app(LessonPackages::class);
        $package = $packages->activeFor($studentId);
        if ($package === null) {
            return null;
        }

        $ctx = $this->ctx();
        if ((int) $package->minutes_consumed === 0) {
            $packages->cancel((string) $package->id, 'STUDENT_REMOVED', $ctx->userId, $ctx->role);

            return 'CANCELLED';
        }

        $packages->complete((string) $package->id, 'STUDENT_REMOVED', $ctx->userId, $ctx->role);

        return 'COMPLETED';
    }

    /**
     * Stop the timetable and clear every lesson still sitting in SCHEDULED. The schedule is ended
     * exactly as DELETE /students/{id}/schedule ends it (future untouched rows are removed by the
     * generator). Whatever is left — past lessons nobody marked, ad-hoc lessons, reschedule
     * successors — is closed as cancelled-by-student, which neither bills nor pays, and any
     * request still waiting on those lessons is rejected so it leaves the approvals queue.
     *
     * @return array{schedules: int, sessions_removed: int, sessions_cancelled: int}
     */
    private function windDownLessons(string $studentId, $now): array
    {
        $scheduleIds = DB::table('schedules')
            ->where('student_id', $studentId)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->pluck('id');

        $removed = 0;
        if ($scheduleIds->isNotEmpty()) {
            DB::table('schedules')->whereIn('id', $scheduleIds)->update([
                'is_active' => false,
                'deleted_at' => $now,
                'updated_at' => $now,
            ]);

            [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
            foreach ($scheduleIds as $scheduleId) {
                $removed += $this->generator->generateForSchedule((string) $scheduleId, $windowStart, $windowEnd)['removed'];
            }
        }

        $leftover = DB::table('sessions')
            ->where('student_id', $studentId)
            ->where('status', 'SCHEDULED')
            ->pluck('id');

        if ($leftover->isNotEmpty()) {
            DB::table('session_cancellation_requests')
                ->whereIn('session_id', $leftover)
                ->where('status', 'PENDING')
                ->update([
                    'status' => 'REJECTED',
                    'decided_by_user_id' => $this->ctx()->userId,
                    'decided_at' => $now,
                    'decision_note' => 'Student removed from the academy',
                    'updated_at' => $now,
                ]);

            DB::table('sessions')->whereIn('id', $leftover)->update([
                'status' => 'CANCELLED_BY_STUDENT',
                'status_reason' => 'Student removed from the academy',
                'updated_at' => $now,
            ]);
        }

        return [
            'schedules' => $scheduleIds->count(),
            'sessions_removed' => $removed,
            'sessions_cancelled' => $leftover->count(),
        ];
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

        // A new student may only start in an ACTIVE state; the terminal states (GRADUATED/
        // WITHDRAWN) are reachable only through deactivate(). On update the full vocabulary
        // validates, with the terminal/REGULAR transitions further gated in update().
        $statusVocab = $creating ? StudentStatus::ACTIVE : StudentStatus::ALL;

        $rules = [
            'full_name' => [$req, 'string', 'max:255'],
            'whatsapp_phone' => ['nullable', 'string', 'max:32'],
            'country' => ['nullable', 'string', 'max:2'],
            'status' => ['sometimes', 'nullable', Rule::in($statusVocab)],
            'notes' => ['nullable', 'string', 'max:2000'],
            // On create, presence is enforced in store(): required unless is_self_guardian
            // (R-STU-2). On update it is the reassignment — the student changes family.
            'guardian_id' => ['nullable', 'uuid'],
        ];

        if ($creating) {
            $rules['is_self_guardian'] = ['sometimes', 'boolean'];
            $rules['currency'] = ['sometimes', 'nullable', 'string', 'size:3'];
            $rules['teacher_id'] = ['sometimes', 'nullable', 'uuid'];
            $rules['teachers'] = ['sometimes', 'array', 'max:20'];
            $rules['teachers.*.teacher_id'] = ['required', 'uuid', 'distinct'];
            $rules['teachers.*.course'] = ['sometimes', 'nullable', 'string', 'max:120'];
            $rules['subscription'] = ['sometimes', 'array'];
            $rules += $this->subscriptionRules('subscription.');
            // Inline lesson package — the same fields and limits as POST /api/packages.
            $rules['package'] = ['sometimes', 'nullable', 'array'];
            $rules['package.label'] = ['required_with:package', 'string', 'max:255'];
            $rules['package.hours'] = ['required_with:package', 'numeric', 'min:0.5', 'max:1000'];
            $rules['package.price_minor'] = ['required_with:package', 'integer', 'min:0'];
            $rules['package.currency'] = ['sometimes', 'nullable', 'string', 'size:3'];
            $rules['package.bill_timing'] = ['sometimes', 'nullable', Rule::in(['ON_START', 'ON_COMPLETION'])];
            $rules['package.starts_on'] = ['sometimes', 'nullable', 'date'];
            $rules['package.expires_on'] = ['sometimes', 'nullable', 'date', 'after_or_equal:package.starts_on'];
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
