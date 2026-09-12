<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Enums\SessionStatus;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\AttendanceService;
use App\Services\LessonPackages;
use App\Services\SessionDurationCorrection;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The Packages screen: live balances for every student on package billing, the history behind
 * each one, and the small set of actions that move a package's life along.
 *
 * Reads never compute money — the numbers here are the ones the engine already snapshotted
 * ({@see LessonPackages}) — and the attention counters that drive the sidebar badge are derived
 * from package state, not from unread notification rows, so the badge means "there is work to
 * do" rather than "you haven't looked at this yet".
 *
 * Every row is RLS-scoped to the caller's academy; capability gates are package.read (see) and
 * package.manage (change).
 */
final class LessonPackageController extends Controller
{
    use InteractsWithScheduling;

    /**
     * GET /api/packages — every package, newest first, with its live balance.
     * Filters: status (ACTIVE|COMPLETED|CANCELLED), student_id, q (student name).
     */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('package.read');

        $validated = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(['ACTIVE', 'COMPLETED', 'CANCELLED'])],
            'student_id' => ['sometimes', 'nullable', 'string'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);

        $query = $this->baseQuery();

        if (($validated['status'] ?? null) !== null) {
            $query->where('p.status', $validated['status']);
        }

        if (($validated['student_id'] ?? null) !== null) {
            $query->where('p.student_id', $validated['student_id']);
        }

        if (($validated['q'] ?? null) !== null && trim((string) $validated['q']) !== '') {
            $query->where('s.full_name', 'ilike', '%'.trim((string) $validated['q']).'%');
        }

        $rows = $query
            // Open packages first — they are the ones with a live balance to watch — then the
            // most recent history beneath them.
            ->orderByRaw("case when p.status = 'ACTIVE' then 0 else 1 end")
            ->orderByDesc('p.created_at')
            ->limit(500)
            ->get()
            ->map(fn ($row) => $this->present($row));

        return response()->json(['packages' => $rows]);
    }

    /**
     * GET /api/packages/summary — the attention counters behind the sidebar badge.
     *
     * These are things an owner has to DO, not things they haven't read: a closed package with no
     * bill, an overdraft still travelling, a finished package nobody paid for, and a balance about
     * to run out. An ON_START package that has only just opened has an unpaid invoice by design,
     * so `unpaid` deliberately counts closed packages only — otherwise the badge would never be
     * clear and would stop meaning anything.
     */
    public function summary(): JsonResponse
    {
        Gate::authorize('package.read');

        $needsBilling = (int) DB::table('lesson_packages')
            ->where('status', 'COMPLETED')
            ->whereNull('invoice_id')
            ->where('minutes_consumed', '>', 0)
            ->count();

        $pendingOverdraft = (int) DB::table('lesson_packages')
            ->where('status', 'COMPLETED')
            ->where('minutes_overdrawn', '>', 0)
            ->whereNull('overdraft_invoice_id')
            ->count();

        $unpaid = (int) DB::table('lesson_packages as p')
            ->join('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->where('p.status', 'COMPLETED')
            ->whereIn('i.status', ['OPEN', 'CLOSED', 'PARTIALLY_PAID'])
            ->whereRaw('i.total_minor > i.amount_paid_minor')
            ->count();

        $lowBalance = (int) DB::table('lesson_packages')
            ->where('status', 'ACTIVE')
            ->whereRaw('(minutes_total + carried_over_minutes - minutes_consumed) <= 60')
            ->count();

        $active = (int) DB::table('lesson_packages')->where('status', 'ACTIVE')->count();
        $completed = (int) DB::table('lesson_packages')->where('status', 'COMPLETED')->count();
        $cancelled = (int) DB::table('lesson_packages')->where('status', 'CANCELLED')->count();

        // Money is never combined across currencies. Each row is a complete package-finance
        // snapshot for one currency: contracted value, finished value, cash collected and debt.
        $financials = DB::table('lesson_packages as p')
            ->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->groupBy('p.currency')
            ->orderBy('p.currency')
            ->selectRaw('p.currency')
            ->selectRaw("coalesce(sum(case when p.status = 'ACTIVE' then p.price_minor else 0 end), 0) as active_value_minor")
            ->selectRaw("coalesce(sum(case when p.status = 'COMPLETED' then p.price_minor else 0 end), 0) as completed_value_minor")
            ->selectRaw('coalesce(sum(least(coalesce(i.amount_paid_minor, 0), coalesce(i.total_minor, 0))), 0) as collected_minor')
            ->selectRaw('coalesce(sum(greatest(coalesce(i.total_minor, 0) - coalesce(i.amount_paid_minor, 0), 0)), 0) as outstanding_minor')
            ->selectRaw("coalesce(sum(case when p.status = 'COMPLETED' then greatest(coalesce(i.total_minor, 0) - coalesce(i.amount_paid_minor, 0), 0) else 0 end), 0) as completed_outstanding_minor")
            ->get()
            ->map(fn ($row) => [
                'currency' => (string) $row->currency,
                'active_value_minor' => (int) $row->active_value_minor,
                'completed_value_minor' => (int) $row->completed_value_minor,
                'collected_minor' => (int) $row->collected_minor,
                'outstanding_minor' => (int) $row->outstanding_minor,
                'completed_outstanding_minor' => (int) $row->completed_outstanding_minor,
            ]);

        return response()->json([
            'active' => $active,
            'completed' => $completed,
            'cancelled' => $cancelled,
            'lowBalance' => $lowBalance,
            'needsBilling' => $needsBilling,
            'pendingOverdraft' => $pendingOverdraft,
            'unpaid' => $unpaid,
            'total' => $lowBalance + $needsBilling + $pendingOverdraft + $unpaid,
            'financials' => $financials,
        ]);
    }

    /**
     * GET /api/packages/students — every active student, with their current billing mode, their
     * open package (if any) and the rate to pre-fill the next one. Drives the "open a package"
     * form's picker.
     *
     * It lists EVERYONE on purpose. It used to return only students already flipped to
     * PER_PACKAGE, which made the picker a list of people someone had already prepared somewhere
     * else — the prerequisite step was invisible from the one screen that needed it. Opening a
     * package now performs that switch ({@see LessonPackages::ensurePackageBilling}), so the
     * picker's job is to show the consequence rather than to hide the student.
     *
     * The subscription is LEFT-joined: a student with none at all is a legitimate pick, and the
     * package creates one for them.
     */
    public function students(): JsonResponse
    {
        Gate::authorize('package.read');

        $rows = DB::table('students as s')
            ->leftJoin('subscriptions as sub', function ($join): void {
                $join->on('sub.student_id', '=', 's.id')
                    ->where('sub.status', '=', 'ACTIVE')
                    ->whereNull('sub.deleted_at');
            })
            ->leftJoin('lesson_packages as p', function ($join): void {
                $join->on('p.student_id', '=', 's.id')->where('p.status', '=', 'ACTIVE');
            })
            ->whereNull('s.deleted_at')
            ->orderBy('s.full_name')
            ->get([
                's.id', 's.full_name',
                'sub.currency', 'sub.price_minor as default_hourly_rate_minor',
                'sub.price_basis', 'sub.plan_label',
                'p.id as active_package_id', 'p.label as active_package_label',
            ])
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'full_name' => (string) $row->full_name,
                'currency' => (string) ($row->currency ?? $this->academyCurrency()),
                // Only an hourly figure pre-fills a package sensibly. A PER_MONTH or PER_SESSION
                // price is a different unit, so it is reported as zero rather than multiplied by
                // the hours and presented as a quote nobody agreed to.
                'default_hourly_rate_minor' => in_array($row->price_basis, ['PER_HOUR', LessonPackages::BASIS], true)
                    ? (int) $row->default_hourly_rate_minor
                    : 0,
                'price_basis' => $row->price_basis !== null ? (string) $row->price_basis : null,
                'plan_label' => $row->plan_label !== null ? (string) $row->plan_label : null,
                'on_package_billing' => $row->price_basis === LessonPackages::BASIS,
                'active_package_id' => $row->active_package_id !== null ? (string) $row->active_package_id : null,
                'active_package_label' => $row->active_package_label !== null ? (string) $row->active_package_label : null,
            ]);

        return response()->json(['students' => $rows]);
    }

    /** The academy's default currency — the fallback for a student who has no subscription yet. */
    private function academyCurrency(): string
    {
        $academyId = app(AuthContext::class)->academyId;

        return (string) (DB::table('academies')->where('id', $academyId)->value('default_currency') ?? 'EGP');
    }

    /** GET /api/packages/{id} — one package plus the lessons that consumed it. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('package.read');

        $row = $this->baseQuery()->where('p.id', $id)->first();

        if ($row === null) {
            abort(404, 'Package not found.');
        }

        return response()->json([
            'package' => $this->present($row),
            'credits' => $this->creditsFor($id),
        ]);
    }

    /**
     * POST /api/packages — open a package.
     *
     * The client sends HOURS because that is what the academy sells; the server converts to
     * minutes immediately and nothing downstream ever sees a fraction again. `hours` allows one
     * decimal place (1.5h is a real lesson length; 1.333h is a data-entry accident).
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('package.manage');

        $validated = $request->validate([
            'student_id' => ['required', 'string'],
            'label' => ['required', 'string', 'max:255'],
            'hours' => ['required', 'numeric', 'min:0.5', 'max:1000'],
            'price_minor' => ['required', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'bill_timing' => ['sometimes', 'nullable', Rule::in(['ON_START', 'ON_COMPLETION'])],
            'starts_on' => ['sometimes', 'nullable', 'date'],
            'expires_on' => ['sometimes', 'nullable', 'date', 'after_or_equal:starts_on'],
            'carry_over' => ['sometimes', 'boolean'],
        ]);

        $ctx = app(AuthContext::class);

        $result = app(LessonPackages::class)->open([
            'student_id' => (string) $validated['student_id'],
            'label' => (string) $validated['label'],
            'minutes_total' => (int) round(((float) $validated['hours']) * 60),
            'price_minor' => (int) $validated['price_minor'],
            'currency' => $validated['currency'] ?? null,
            'bill_timing' => $validated['bill_timing'] ?? null,
            'starts_on' => $validated['starts_on'] ?? null,
            'expires_on' => $validated['expires_on'] ?? null,
            'carry_over' => (bool) ($validated['carry_over'] ?? false),
        ], $ctx->userId, $ctx->role);

        return response()->json([
            'id' => $result['package_id'],
            'invoice_id' => $result['invoice_id'],
            'carried_over_minutes' => $result['carried_over_minutes'],
            'imported_lessons' => $result['imported_lessons'],
            'skipped_locked_lessons' => $result['skipped_locked_lessons'],
            'switched_to_package_billing' => $result['switched_to_package_billing'],
        ], 201);
    }

    /**
     * PATCH /api/packages/{id} — correct a package that was entered wrong.
     *
     * Deliberately narrow: the label, the hours, the price and the expiry, and only while the
     * package is open. It is a correction, not a second way to close or re-price history — see
     * {@see LessonPackages::edit()} for what that costs and why the bill is the hard edge.
     *
     * `hours` is sent for the same reason it is on store(): the academy sells hours, the server
     * keeps minutes, and nothing downstream ever sees a fraction.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');

        $validated = $request->validate([
            'label' => ['sometimes', 'string', 'max:255'],
            'hours' => ['sometimes', 'numeric', 'min:0.5', 'max:1000'],
            'price_minor' => ['sometimes', 'integer', 'min:0'],
            'expires_on' => ['sometimes', 'nullable', 'date'],
        ]);

        $changes = [];
        if (array_key_exists('label', $validated)) {
            $changes['label'] = (string) $validated['label'];
        }
        if (array_key_exists('hours', $validated)) {
            $changes['minutes_total'] = (int) round(((float) $validated['hours']) * 60);
        }
        if (array_key_exists('price_minor', $validated)) {
            $changes['price_minor'] = (int) $validated['price_minor'];
        }
        if (array_key_exists('expires_on', $validated)) {
            $changes['expires_on'] = $validated['expires_on'];
        }

        $ctx = app(AuthContext::class);
        $result = app(LessonPackages::class)->edit($id, $changes, $ctx->userId, $ctx->role);

        return response()->json(['ok' => true] + $result);
    }

    /** POST /api/packages/{id}/sync-lessons — repair/import lessons since the package start. */
    public function syncLessons(string $id): JsonResponse
    {
        Gate::authorize('package.manage');

        $ctx = app(AuthContext::class);
        $result = app(LessonPackages::class)->syncBackdatedLessons($id, $ctx->userId, $ctx->role);

        return response()->json($result);
    }

    /**
     * POST /api/packages/{id}/close — close a package early.
     *
     * A package that runs out closes itself; this is the owner ending one with hours still on it
     * (the student left, switched plan, or the terms changed). ON_COMPLETION packages bill
     * pro-rata for what was actually used, which is why this is a manage action and not a delete.
     *
     * `return_to_monthly` also puts the student back on the monthly clock — the exit that pairs
     * with {@see store()} putting them on the hour clock.
     */
    public function close(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');

        $validated = $request->validate([
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
            'return_to_monthly' => ['sometimes', 'boolean'],
        ]);

        $ctx = app(AuthContext::class);
        $packages = app(LessonPackages::class);
        $studentId = (string) DB::table('lesson_packages')->where('id', $id)->value('student_id');

        $result = $packages->complete(
            $id,
            (string) ($validated['reason'] ?? 'CLOSED_EARLY'),
            $ctx->userId,
            $ctx->role,
        );

        // The one way back to the monthly clock, offered at the moment an owner actually decides
        // a student is done buying blocks. Keeping it here rather than on the student's profile
        // is what makes the packages screen the whole story: every billing-mode decision, both
        // directions, happens where the packages are. It runs AFTER complete() on purpose —
        // returnToMonthly() refuses while a package is still open.
        $returned = false;
        if ($request->boolean('return_to_monthly') && $studentId !== '') {
            $returned = $packages->returnToMonthly($studentId, (string) $ctx->academyId, $ctx->userId, $ctx->role);
        }

        return response()->json([
            'ok' => true,
            'invoice_id' => $result['invoice_id'],
            'returned_to_monthly' => $returned,
        ]);
    }

    /** POST /api/packages/{id}/cancel — void a package opened by mistake (unused ones only). */
    public function cancel(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');

        $validated = $request->validate([
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $ctx = app(AuthContext::class);

        app(LessonPackages::class)->cancel($id, $validated['note'] ?? null, $ctx->userId, $ctx->role);

        return response()->json(['ok' => true]);
    }

    /**
     * POST /api/packages/{id}/bill-overdraft — put a stranded overdraft on its own invoice.
     *
     * An ON_START package's bill went out before the lessons happened, so it is immutable by the
     * time the last lesson overdraws it. The overdraft normally rides along on the next package's
     * invoice; this is the escape hatch for when there is no next package.
     */
    public function billOverdraft(string $id): JsonResponse
    {
        Gate::authorize('package.manage');

        $ctx = app(AuthContext::class);

        $invoiceId = app(LessonPackages::class)->billOverdraft($id, $ctx->userId, $ctx->role);

        if ($invoiceId === null) {
            abort(422, 'This package has no unbilled extra hours.');
        }

        return response()->json(['ok' => true, 'invoice_id' => $invoiceId], 201);
    }

    // =========================================================================
    // The ledger, by hand — add / correct / remove one lesson on this package
    // =========================================================================

    /**
     * GET /api/packages/{id}/available-lessons — attended lessons this package could still take.
     *
     * Everything the student has actually been taught which is not already sitting on some
     * package. Deliberately NOT filtered to the package's own date window: the commonest reason
     * to reach for this screen is that the window was wrong in the first place (a block sold
     * after the teaching started, a student moved onto package billing mid-month), so the owner
     * is shown the lessons and left to judge. A lesson whose invoice has already been issued is
     * still listed, but flagged `locked` — it cannot move without re-opening that bill.
     */
    public function availableLessons(string $id): JsonResponse
    {
        Gate::authorize('package.read');

        $package = DB::table('lesson_packages')->where('id', $id)->first();

        if ($package === null) {
            abort(404, 'Package not found.');
        }

        $rows = DB::table('sessions as sess')
            ->leftJoin('teachers as t', 't.id', '=', 'sess.teacher_id')
            ->leftJoin('lesson_package_credits as c', 'c.session_id', '=', 'sess.id')
            ->leftJoin('invoice_line_items as li', 'li.session_id', '=', 'sess.id')
            ->leftJoin('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->where('sess.student_id', $package->student_id)
            ->where('sess.status', 'ATTENDED')
            ->whereNull('c.id')
            ->orderByDesc('sess.scheduled_at_utc')
            ->limit(200)
            ->get([
                'sess.id', 'sess.scheduled_at_utc', 'sess.duration_minutes',
                't.full_name as teacher_name', 'i.status as invoice_status',
                'li.amount_minor', 'li.currency',
            ])
            ->map(fn ($s) => [
                'id' => (string) $s->id,
                'scheduled_at_utc' => Carbon::parse($s->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $s->duration_minutes,
                'teacher_name' => $s->teacher_name !== null ? (string) $s->teacher_name : null,
                'invoice_status' => $s->invoice_status !== null ? (string) $s->invoice_status : null,
                'amount_minor' => $s->amount_minor !== null ? (int) $s->amount_minor : null,
                'currency' => $s->currency !== null ? (string) $s->currency : null,
                // An issued invoice is immutable, so its lesson cannot be moved onto a package
                // until that bill is re-opened. Say so here rather than failing on submit.
                'locked' => $s->invoice_status !== null && (string) $s->invoice_status !== 'OPEN',
            ]);

        return response()->json(['lessons' => $rows]);
    }

    /**
     * POST /api/packages/{id}/lessons — put a lesson on this package.
     *
     * Two shapes, one endpoint, because from the owner's side it is one intention ("this lesson
     * belongs on this block"):
     *   - `session_id`  → an existing attended lesson moves onto the package.
     *   - otherwise     → a lesson that was taught but never recorded is CREATED and marked
     *     attended first, then moves on. That is the "affect attendance too" half: the lesson
     *     becomes a real attended session with a teacher payout, not a decorative ledger row.
     *
     * The create path goes through {@see AttendanceService} rather than writing the row itself,
     * so the payout accrues and the billing hooks fire exactly as they would have on the day.
     */
    public function addLesson(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');

        $package = DB::table('lesson_packages')->where('id', $id)->first();

        if ($package === null) {
            abort(404, 'Package not found.');
        }

        // Checked HERE and not only inside attachSession(): the create path below records real
        // attendance before anything is attached, so a package that cannot take the lesson has to
        // be refused before a session exists, or a failed add leaves a stray attended lesson.
        if ($package->status !== 'ACTIVE') {
            throw ValidationException::withMessages([
                'package_id' => ['Only an open package can take another lesson. / لا يمكن إضافة حصة إلا إلى باقة مفتوحة.'],
            ]);
        }

        $validated = $request->validate([
            'session_id' => ['sometimes', 'nullable', 'uuid'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['sometimes', 'integer', 'min:1', 'max:600'],
        ]);

        $ctx = app(AuthContext::class);
        $packages = app(LessonPackages::class);
        $sessionId = $validated['session_id'] ?? null;
        $created = false;

        if ($sessionId === null) {
            $sessionId = $this->createAttendedLesson($package, $validated, $ctx);
            $created = true;
        }

        // Marking a just-created lesson attended may already have credited it — the student is on
        // package billing and this IS their open package. That is the happy path, not a clash, so
        // only attach when the automatic route did not already do it. This short-circuit is
        // deliberately limited to the lesson we just made: asking to attach an EXISTING lesson
        // that is already here is a mistake worth reporting, not a no-op worth hiding.
        $existing = $created
            ? DB::table('lesson_package_credits')->where('session_id', $sessionId)->first()
            : null;

        if ($existing !== null && (string) $existing->package_id === $id) {
            return response()->json([
                'ok' => true,
                'session_id' => $sessionId,
                'created' => $created,
                'minutes' => (int) $existing->minutes,
                'minutes_overdrawn' => (int) $existing->minutes_overdrawn,
                'invoice_id' => null,
            ], $created ? 201 : 200);
        }

        $result = $packages->attachSession($id, (string) $sessionId, $ctx->userId, $ctx->role);

        return response()->json([
            'ok' => true,
            'session_id' => $sessionId,
            'created' => $created,
        ] + $result, $created ? 201 : 200);
    }

    /**
     * PATCH /api/packages/{id}/lessons/{creditId} — correct how long a lesson actually ran.
     *
     * Length is the only thing about a recorded lesson that changes what a package is worth, and
     * it is never only the package's business: the same minutes are on the parent's invoice and
     * in the teacher's payout. So this delegates to {@see SessionDurationCorrection}, which moves
     * all three together or refuses — rather than editing the credit row and letting the three
     * ledgers drift. When it refuses (an issued invoice, a finalized payout) the reason comes
     * back as a validation message the owner can act on.
     */
    public function updateLesson(Request $request, string $id, string $creditId): JsonResponse
    {
        Gate::authorize('package.manage');

        $credit = DB::table('lesson_package_credits')
            ->where('id', $creditId)
            ->where('package_id', $id)
            ->first();

        if ($credit === null) {
            abort(404, 'That lesson is not on this package.');
        }

        $validated = $request->validate([
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
        ]);

        $ctx = app(AuthContext::class);

        $impact = app(SessionDurationCorrection::class)->update(
            (string) $credit->session_id,
            (int) $validated['duration_minutes'],
            $ctx->userId,
            $ctx->role,
        );

        return response()->json(['ok' => true, 'impact' => $impact]);
    }

    /**
     * DELETE /api/packages/{id}/lessons/{creditId} — take a lesson back off this package.
     *
     * `rebill` is the whole decision and the caller must make it, because both answers are a
     * money decision: TRUE puts the lesson back on the parent's open invoice (the lesson happened,
     * someone pays for it), FALSE drops it entirely (it was never this student's lesson — the
     * shared sibling record, the mis-clicked attendance). Defaulting to TRUE is the conservative
     * half: it never silently loses revenue, and it is the reversible one.
     */
    public function removeLesson(Request $request, string $id, string $creditId): JsonResponse
    {
        Gate::authorize('package.manage');

        $validated = $request->validate([
            'rebill' => ['sometimes', 'boolean'],
        ]);

        $ctx = app(AuthContext::class);

        $result = app(LessonPackages::class)->detachCredit(
            $id,
            $creditId,
            (bool) ($validated['rebill'] ?? true),
            $ctx->userId,
            $ctx->role,
        );

        return response()->json(['ok' => true] + $result);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function baseQuery()
    {
        return DB::table('lesson_packages as p')
            ->join('students as s', 's.id', '=', 'p.student_id')
            ->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->select([
                'p.id', 'p.student_id', 'p.label', 'p.minutes_total', 'p.minutes_consumed',
                'p.carried_over_minutes', 'p.minutes_overdrawn', 'p.price_minor', 'p.currency',
                'p.hourly_rate_minor', 'p.bill_timing', 'p.status', 'p.sequence_no',
                'p.starts_on', 'p.expires_on', 'p.invoice_id', 'p.overdraft_invoice_id',
                'p.closed_at', 'p.closed_reason', 'p.created_at',
                's.full_name as student_name',
                'i.status as invoice_status', 'i.total_minor as invoice_total_minor',
                'i.amount_paid_minor as invoice_paid_minor', 'i.public_token as invoice_token',
                'i.payment_method', 'i.payment_reason', 'i.payment_reference', 'i.payment_proof_path',
            ])
            ->selectSub(
                DB::table('lesson_package_credits as pc')
                    ->selectRaw('count(*)')
                    ->whereColumn('pc.package_id', 'p.id'),
                'lesson_count',
            )
            ->selectSub(
                DB::table('sessions as upcoming')
                    ->selectRaw('count(*)')
                    ->whereColumn('upcoming.student_id', 'p.student_id')
                    ->whereIn('upcoming.status', ['SCHEDULED', 'RESCHEDULED'])
                    ->where('upcoming.scheduled_at_utc', '>=', now()),
                'upcoming_lesson_count',
            )
            ->selectSub(
                DB::table('sessions as next_session')
                    ->select('next_session.scheduled_at_utc')
                    ->whereColumn('next_session.student_id', 'p.student_id')
                    ->whereIn('next_session.status', ['SCHEDULED', 'RESCHEDULED'])
                    ->where('next_session.scheduled_at_utc', '>=', now())
                    ->orderBy('next_session.scheduled_at_utc')
                    ->limit(1),
                'next_lesson_at',
            );
    }

    /**
     * Shape one row for the client. `minutes_remaining` is clamped at zero and the overdraw is
     * reported separately — "how much is left" and "how far past the end we went" are two
     * different questions and collapsing them into one signed number reads wrong on a progress bar.
     *
     * @return array<string,mixed>
     */
    private function present(object $row): array
    {
        $sold = (int) $row->minutes_total + (int) $row->carried_over_minutes;
        $consumed = (int) $row->minutes_consumed;
        $remaining = max(0, $sold - $consumed);
        $outstanding = $row->invoice_status !== null
            ? max(0, (int) $row->invoice_total_minor - (int) $row->invoice_paid_minor)
            : 0;

        return [
            'id' => (string) $row->id,
            'student_id' => (string) $row->student_id,
            'student_name' => (string) $row->student_name,
            'label' => (string) $row->label,
            'sequence_no' => (int) $row->sequence_no,
            'status' => (string) $row->status,
            'bill_timing' => (string) $row->bill_timing,
            'minutes_total' => (int) $row->minutes_total,
            'carried_over_minutes' => (int) $row->carried_over_minutes,
            'minutes_sold' => $sold,
            'minutes_consumed' => $consumed,
            'minutes_remaining' => $remaining,
            'minutes_overdrawn' => (int) $row->minutes_overdrawn,
            'lesson_count' => (int) $row->lesson_count,
            'upcoming_lesson_count' => (int) $row->upcoming_lesson_count,
            'next_lesson_at' => $row->next_lesson_at !== null ? Carbon::parse($row->next_lesson_at)->utc()->toIso8601String() : null,
            'percent_used' => $sold > 0 ? min(100, (int) round($consumed / $sold * 100)) : 0,
            'price_minor' => (int) $row->price_minor,
            'hourly_rate_minor' => (int) $row->hourly_rate_minor,
            'currency' => (string) $row->currency,
            'starts_on' => (string) $row->starts_on,
            'expires_on' => $row->expires_on !== null ? (string) $row->expires_on : null,
            'closed_at' => $row->closed_at !== null ? Carbon::parse($row->closed_at)->utc()->toIso8601String() : null,
            'closed_reason' => $row->closed_reason !== null ? (string) $row->closed_reason : null,
            'invoice_id' => $row->invoice_id !== null ? (string) $row->invoice_id : null,
            'invoice_status' => $row->invoice_status !== null ? (string) $row->invoice_status : null,
            'invoice_token' => $row->invoice_token !== null ? (string) $row->invoice_token : null,
            'invoice_total_minor' => $row->invoice_total_minor !== null ? (int) $row->invoice_total_minor : 0,
            'invoice_paid_minor' => $row->invoice_paid_minor !== null ? (int) $row->invoice_paid_minor : 0,
            'outstanding_minor' => $outstanding,
            'payment_method' => $row->payment_method !== null ? (string) $row->payment_method : null,
            'payment_reason' => $row->payment_reason !== null ? (string) $row->payment_reason : null,
            'payment_reference' => $row->payment_reference !== null ? (string) $row->payment_reference : null,
            'payment_proof_url' => $row->payment_proof_path !== null
                ? "/api/invoices/{$row->invoice_id}/payment-proof"
                : null,
            'overdraft_billed' => $row->overdraft_invoice_id !== null,
            'created_at' => Carbon::parse($row->created_at)->utc()->toIso8601String(),
        ];
    }

    /** The teacher currently assigned to this student, if any. */
    private function currentTeacherFor(string $studentId): ?string
    {
        $id = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)
            ->whereNull('ended_at')
            ->value('teacher_id');

        return $id !== null ? (string) $id : null;
    }

    private function assertActiveTeacher(string $teacherId): void
    {
        if (DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages([
                'teacher_id' => ['Unknown or inactive teacher. / معلّم غير معروف أو غير نشط.'],
            ]);
        }
    }

    /**
     * One lesson per row, in the order the minutes were actually burned.
     *
     * `locked` answers "can this row still be touched" in the list rather than on submit, so the
     * UI can grey a control instead of offering an action that will fail. It is the same pair of
     * facts {@see SessionDurationCorrection} blocks on — an invoice that has left OPEN, a payout
     * that has been finalized — asked cheaply as a pair of exists-subqueries so the ledger stays
     * one query however long it gets.
     *
     * @return Collection<int, array<string,mixed>>
     */
    private function creditsFor(string $packageId)
    {
        return DB::table('lesson_package_credits as c')
            ->leftJoin('sessions as sess', 'sess.id', '=', 'c.session_id')
            ->leftJoin('teachers as t', 't.id', '=', 'sess.teacher_id')
            ->where('c.package_id', $packageId)
            ->orderBy('c.consumed_at')
            ->select([
                'c.id', 'c.session_id', 'c.minutes', 'c.minutes_overdrawn', 'c.amount_minor',
                'c.currency', 'c.description', 'c.consumed_at',
                'sess.scheduled_at_utc', 'sess.status as session_status',
                'sess.duration_minutes', 't.full_name as teacher_name',
            ])
            ->selectSub(
                DB::table('invoice_line_items as li')
                    ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
                    ->whereColumn('li.session_id', 'c.session_id')
                    ->where('i.status', '!=', 'OPEN')
                    ->selectRaw('1')
                    ->limit(1),
                'invoice_locked',
            )
            ->selectSub(
                DB::table('payout_line_items as pli')
                    ->join('payouts as po', 'po.id', '=', 'pli.payout_id')
                    ->whereColumn('pli.session_id', 'c.session_id')
                    ->whereNotNull('po.finalized_at')
                    ->selectRaw('1')
                    ->limit(1),
                'payout_locked',
            )
            ->get()
            ->map(fn ($c) => [
                'id' => (string) $c->id,
                'session_id' => $c->session_id !== null ? (string) $c->session_id : null,
                'minutes' => (int) $c->minutes,
                'minutes_overdrawn' => (int) $c->minutes_overdrawn,
                'amount_minor' => (int) $c->amount_minor,
                'currency' => (string) $c->currency,
                'description' => (string) $c->description,
                'consumed_at' => Carbon::parse($c->consumed_at)->utc()->toIso8601String(),
                'scheduled_at_utc' => $c->scheduled_at_utc !== null
                    ? Carbon::parse($c->scheduled_at_utc)->utc()->toIso8601String()
                    : null,
                'session_status' => $c->session_status !== null ? (string) $c->session_status : null,
                'duration_minutes' => $c->duration_minutes !== null ? (int) $c->duration_minutes : null,
                'teacher_name' => $c->teacher_name !== null ? (string) $c->teacher_name : null,
                'locked' => $c->invoice_locked !== null || $c->payout_locked !== null,
                'lock_reason' => $c->invoice_locked !== null
                    ? 'INVOICE_ISSUED'
                    : ($c->payout_locked !== null ? 'PAYOUT_FINALIZED' : null),
            ]);
    }

    /**
     * Record a lesson that was taught but never entered, and mark it attended.
     *
     * Ad-hoc on purpose — `schedule_id`, `slot_id` and `occurrence_local_date` all stay null — so
     * the timetable generator never adopts it, retimes it, or deletes it as a stale occurrence.
     *
     * @param  array<string,mixed>  $data
     */
    private function createAttendedLesson(object $package, array $data, AuthContext $ctx): string
    {
        $academyId = (string) $package->academy_id;

        if (($data['duration_minutes'] ?? null) === null) {
            throw ValidationException::withMessages([
                'duration_minutes' => ['How long was the lesson? / كم استغرقت الحصة؟'],
            ]);
        }

        $teacherId = $data['teacher_id'] ?? $this->currentTeacherFor((string) $package->student_id);

        if ($teacherId === null) {
            throw ValidationException::withMessages([
                'teacher_id' => ['No teacher given and the student has none assigned. / لم يتم تحديد معلّم ولا يوجد معلّم مسند للطالب.'],
            ]);
        }

        $this->assertActiveTeacher((string) $teacherId);

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $startUtc = $this->resolveInstant($data, $timezone);
        $sessionId = (string) Str::uuid();

        DB::table('sessions')->insert([
            'id' => $sessionId,
            'academy_id' => $academyId,
            'student_id' => $package->student_id,
            'teacher_id' => $teacherId,
            'schedule_id' => null,
            'slot_id' => null,
            'occurrence_local_date' => null,
            'scheduled_at_utc' => $startUtc->format('Y-m-d H:i:sP'),
            'duration_minutes' => (int) $data['duration_minutes'],
            'status' => 'SCHEDULED',
        ]);

        Audit::log('session.created', 'session', $sessionId, $academyId, $ctx->userId, $ctx->role, after: [
            'student_id' => (string) $package->student_id,
            'teacher_id' => (string) $teacherId,
            'scheduled_at_utc' => $startUtc->toIso8601String(),
            'duration_minutes' => (int) $data['duration_minutes'],
            'ad_hoc' => true,
            'source' => 'package_ledger',
        ]);

        $session = DB::table('sessions')->where('id', $sessionId)->first();

        app(AttendanceService::class)->record(
            $session,
            SessionStatus::Attended,
            null,
            $ctx->userId,
            $ctx->role,
        );

        return $sessionId;
    }
}
