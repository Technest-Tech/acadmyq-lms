<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Enums\SessionStatus;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\AttendanceService;
use App\Services\LessonPackages;
use App\Services\SessionDurationCorrection;
use App\Services\Whatsapp\PackageReminderMessage;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\AcademyUrl;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\StudentTeachers;
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

    /** An invoice in one of these states, with money still on it, is a debt someone has to chase. */
    private const UNPAID_INVOICE_STATUSES = ['OPEN', 'CLOSED', 'PARTIALLY_PAID'];

    /**
     * GET /api/packages — every package, newest first, with its live balance.
     * Filters: scope (open = ACTIVE | finished = everything else | due = money still owed on it,
     * whatever its status), status (ACTIVE|COMPLETED|CANCELLED), student_id, q (student name).
     */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('package.read');

        $validated = $request->validate([
            'scope' => ['sometimes', 'nullable', Rule::in(['open', 'finished', 'due'])],
            'status' => ['sometimes', 'nullable', Rule::in(['ACTIVE', 'COMPLETED', 'CANCELLED'])],
            'student_id' => ['sometimes', 'nullable', 'string'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);

        $query = $this->baseQuery();

        // The three pages of the screen: Due (a payment to collect, open or finished), Open
        // packages and Finished packages.
        match ($validated['scope'] ?? null) {
            'open' => $query->where('p.status', 'ACTIVE'),
            'finished' => $query->where('p.status', '!=', 'ACTIVE'),
            'due' => $this->whereDue($query),
            default => null,
        };

        if (($validated['status'] ?? null) !== null) {
            $query->where('p.status', $validated['status']);
        }

        if (($validated['student_id'] ?? null) !== null) {
            $query->where('p.student_id', $validated['student_id']);
        }

        if (($validated['q'] ?? null) !== null && trim((string) $validated['q']) !== '') {
            $like = '%'.trim((string) $validated['q']).'%';
            $query->where(fn ($q) => $q->where('s.full_name', 'ilike', $like)->orWhere('g.full_name', 'ilike', $like));
        }

        $rows = $query
            // Open packages first — they are the ones with a live balance to watch — then the
            // most recent history beneath them.
            ->orderByRaw("case when p.status = 'ACTIVE' then 0 else 1 end")
            ->orderByDesc('p.created_at')
            ->limit(500)
            ->get();

        $gaps = $this->gapsFor($rows->pluck('id')->all());
        $previous = $this->previousUnpaidFor(
            $rows->where('status', 'ACTIVE')->pluck('student_id')->map(fn ($id) => (string) $id)->all(),
        );

        return response()->json([
            'packages' => $rows->map(fn ($row) => $this->present($row, $gaps, $previous)),
        ]);
    }

    /**
     * GET /api/packages/summary — the attention counters behind the sidebar badge.
     *
     * These are things an owner has to DO, not things they haven't read: a closed package with no
     * bill, an overdraft still travelling, a finished package nobody paid for, a balance about
     * to run out, and a student still being taught with no package open at all (`outOfHours`,
     * {@see gapsFor()}). An ON_START package that has only just opened has an unpaid invoice by design,
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

        // An overdraft the next block absorbed is settled — its minutes are paid for there.
        $pendingOverdraft = (int) DB::table('lesson_packages')
            ->where('status', 'COMPLETED')
            ->where('minutes_overdrawn', '>', 0)
            ->whereNull('overdraft_invoice_id')
            ->whereNull('overdraft_absorbed_by')
            ->count();

        $unpaid = (int) DB::table('lesson_packages as p')
            ->join('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->where('p.status', 'COMPLETED')
            ->whereIn('i.status', self::UNPAID_INVOICE_STATUSES)
            ->whereRaw('i.total_minor > i.amount_paid_minor')
            ->count();

        $lowBalance = (int) DB::table('lesson_packages')
            ->where('status', 'ACTIVE')
            ->whereRaw('(minutes_total + carried_over_minutes - minutes_consumed) <= 60')
            ->count();

        // Students still being taught after their block ran out, with nobody having decided what
        // comes next — the case every other counter missed once the old bill was paid.
        $gapIds = array_keys(array_filter(
            $this->gapsFor(null),
            fn (array $gap): bool => $gap['lessons'] > 0,
        ));
        $outOfHours = count($gapIds);

        // The red badge on "Finished packages": how many finished packages still need someone to
        // follow up — counted per PACKAGE, so one that is both unpaid and out of hours is one, not
        // two. The same rule as each row's `follow_up` flag ({@see present()}).
        $finishedAttention = count(array_unique([
            ...DB::table('lesson_packages as p')
                ->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id')
                ->where('p.status', '!=', 'ACTIVE')
                ->where(fn ($q) => $q
                    ->where(fn ($unpaid) => $unpaid
                        ->whereIn('i.status', self::UNPAID_INVOICE_STATUSES)
                        ->whereRaw('i.total_minor > i.amount_paid_minor'))
                    ->orWhere(fn ($unbilled) => $unbilled
                        ->where('p.status', 'COMPLETED')
                        ->whereNull('p.invoice_id')
                        ->where('p.minutes_consumed', '>', 0))
                    ->orWhere(fn ($overdraft) => $overdraft
                        ->where('p.status', 'COMPLETED')
                        ->where('p.minutes_overdrawn', '>', 0)
                        ->whereNull('p.overdraft_invoice_id')
                        ->whereNull('p.overdraft_absorbed_by')))
                ->pluck('p.id')
                ->map(fn ($id) => (string) $id)
                ->all(),
            ...$gapIds,
        ]));

        // The red badge on "Due": packages whose money has not arrived, open or finished — the
        // academy is paid up front, so a block that has just opened is already a payment to
        // collect. Per currency, never summed across them.
        $dueRows = $this->whereDue(
            DB::table('lesson_packages as p')->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id'),
        )
            ->selectRaw('p.currency, count(*) as n')
            ->selectRaw('coalesce(sum(greatest(coalesce(i.total_minor, 0) - coalesce(i.amount_paid_minor, 0), 0)), 0) as due_minor')
            ->groupBy('p.currency')
            ->orderBy('p.currency')
            ->get();
        $due = (int) $dueRows->sum('n');
        $dueAmounts = $dueRows
            ->filter(fn ($row) => (int) $row->due_minor > 0)
            ->map(fn ($row) => ['currency' => trim((string) $row->currency), 'amount_minor' => (int) $row->due_minor])
            ->values();

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
            'outOfHours' => $outOfHours,
            'finishedAttention' => $finishedAttention,
            'due' => $due,
            'dueAmounts' => $dueAmounts,
            'total' => $lowBalance + $needsBilling + $pendingOverdraft + $unpaid + $outOfHours,
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
            // The untied open block only: with blocks per subject a student may hold several, and
            // they are listed under `open_subjects` instead of multiplying the row.
            ->leftJoin('lesson_packages as p', function ($join): void {
                $join->on('p.student_id', '=', 's.id')->where('p.status', '=', 'ACTIVE')->whereNull('p.teacher_id');
            })
            ->whereNull('s.deleted_at')
            ->orderBy('s.full_name')
            ->select([
                's.id', 's.full_name',
                'sub.currency', 'sub.price_minor as default_hourly_rate_minor',
                'sub.price_basis', 'sub.plan_label',
                'p.id as active_package_id', 'p.label as active_package_label',
            ])
            // The rate of the last block they bought, in their own currency — the same figure a
            // lesson after that block ran out is billed at ({@see LessonPackages::lastPackageRate}).
            ->selectSub(
                DB::table('lesson_packages as last')
                    ->select('last.hourly_rate_minor')
                    ->whereColumn('last.student_id', 's.id')
                    ->whereColumn('last.currency', 'sub.currency')
                    ->whereIn('last.status', ['ACTIVE', 'COMPLETED'])
                    ->orderByDesc('last.sequence_no')
                    ->limit(1),
                'last_package_rate_minor',
            )
            ->get();

        // Each student's subjects (the teachers they take one with) and the subjects already holding
        // an open block — what a centre's "subscription for a subject" picker offers.
        $ids = $rows->pluck('id')->all();
        $subjects = DB::table('student_teacher_assignments as a')
            ->join('teachers as t', 't.id', '=', 'a.teacher_id')
            ->whereIn('a.student_id', $ids ?: ['00000000-0000-0000-0000-000000000000'])
            ->whereNull('a.ended_at')
            ->orderBy('t.full_name')
            ->get(['a.student_id', 'a.teacher_id', 't.full_name as teacher_name', 'a.course'])
            ->groupBy(fn ($a) => (string) $a->student_id);
        $openScopes = DB::table('lesson_packages')
            ->whereIn('student_id', $ids ?: ['00000000-0000-0000-0000-000000000000'])
            ->where('status', 'ACTIVE')->whereNotNull('teacher_id')
            ->get(['student_id', 'teacher_id'])
            ->groupBy(fn ($p) => (string) $p->student_id);

        $rows = $rows
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'full_name' => (string) $row->full_name,
                'subjects' => ($subjects[(string) $row->id] ?? collect())->map(fn ($a) => [
                    'teacher_id' => (string) $a->teacher_id,
                    'teacher_name' => $a->teacher_name,
                    'course' => $a->course,
                ])->values()->all(),
                'open_subjects' => ($openScopes[(string) $row->id] ?? collect())->pluck('teacher_id')->map(fn ($v) => (string) $v)->values()->all(),
                'currency' => (string) ($row->currency ?? $this->academyCurrency()),
                // Only an hourly figure pre-fills a package sensibly. A PER_MONTH or PER_SESSION
                // price is a different unit, so it is reported as zero rather than multiplied by
                // the hours and presented as a quote nobody agreed to. A package student's next
                // block is quoted at their LAST block's rate, not the subscription figure, which
                // is never rewritten after their first one.
                'default_hourly_rate_minor' => match (true) {
                    $row->price_basis === LessonPackages::BASIS && $row->last_package_rate_minor !== null => (int) $row->last_package_rate_minor,
                    in_array($row->price_basis, ['PER_HOUR', LessonPackages::BASIS], true) => (int) $row->default_hourly_rate_minor,
                    default => 0,
                },
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
            'package' => $this->present(
                $row,
                $this->gapsFor([$id]),
                $row->status === 'ACTIVE' ? $this->previousUnpaidFor([(string) $row->student_id]) : [],
            ),
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
            'auto_renew' => ['sometimes', 'boolean'],
            // A centre's subscription for one subject: the student's teacher for it (null = any lesson).
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
        ]);

        $ctx = app(AuthContext::class);

        $result = app(LessonPackages::class)->open([
            'student_id' => (string) $validated['student_id'],
            'teacher_id' => $validated['teacher_id'] ?? null,
            'label' => (string) $validated['label'],
            'minutes_total' => (int) round(((float) $validated['hours']) * 60),
            'price_minor' => (int) $validated['price_minor'],
            'currency' => $validated['currency'] ?? null,
            'bill_timing' => $validated['bill_timing'] ?? null,
            'starts_on' => $validated['starts_on'] ?? null,
            'expires_on' => $validated['expires_on'] ?? null,
            'carry_over' => (bool) ($validated['carry_over'] ?? false),
            'auto_renew' => (bool) ($validated['auto_renew'] ?? true),
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
     * Deliberately narrow: the label, the hours, the price, the expiry and whether it renews
     * itself, and only while the package is open. It is a correction, not a second way to close or re-price history — see
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
            'auto_renew' => ['sometimes', 'boolean'],
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
        if (array_key_exists('auto_renew', $validated)) {
            $changes['auto_renew'] = (bool) $validated['auto_renew'];
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
     * The overdraft of a block's last lesson is normally absorbed by the next block, which opens
     * itself when the last one runs out. This is the escape hatch for when nothing will absorb
     * it — the student left package billing, or the renewal was cancelled.
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
     *
     * `pay_teacher` (default TRUE) is the teacher's half of the same decision. FALSE takes the
     * lesson off the teacher's open statement too, and needs payout.adjust on top of
     * package.manage.
     */
    public function removeLesson(Request $request, string $id, string $creditId): JsonResponse
    {
        Gate::authorize('package.manage');

        $validated = $request->validate([
            'rebill' => ['sometimes', 'boolean'],
            'pay_teacher' => ['sometimes', 'boolean'],
        ]);

        // Stopping a teacher's pay is a payroll decision, not a package one.
        $payTeacher = (bool) ($validated['pay_teacher'] ?? true);
        if (! $payTeacher) {
            Gate::authorize('payout.adjust');
        }

        $ctx = app(AuthContext::class);

        $result = app(LessonPackages::class)->detachCredit(
            $id,
            $creditId,
            (bool) ($validated['rebill'] ?? true),
            $ctx->userId,
            $ctx->role,
            $payTeacher,
        );

        return response()->json(['ok' => true] + $result);
    }

    /**
     * POST /api/packages/{id}/remind — send the payer a short WhatsApp reminder about this package,
     * and count it.
     *
     * What it says follows the package: money still due on its bill → a payment reminder with the
     * invoice link; a finished block that is paid and has no next block → a renewal reminder.
     * Anything else has nothing to remind about and is refused.
     *
     * It never goes through the WhatsApp gateway: it is handed back as a wa.me link that opens the
     * staff member's own WhatsApp with the message written, and they press send. A reminder about
     * money is a personal message from the academy, not an automated one. Every press counts — the
     * counter and the last date tell the next person on the case that the family has already been
     * chased, and how often.
     */
    public function remind(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.read');
        Gate::authorize('invoice.send_link');

        $validated = $request->validate([
            'locale' => ['sometimes', 'nullable', Rule::in(['ar', 'en'])],
        ]);

        $row = $this->baseQuery()->where('p.id', $id)->first();
        if ($row === null) {
            abort(404, 'Package not found.');
        }

        $presented = $this->present($row, $this->gapsFor([$id]));
        $kind = match (true) {
            $presented['outstanding_minor'] > 0 => PackageReminderMessage::PAYMENT,
            $presented['awaiting_next_package'] => PackageReminderMessage::RENEWAL,
            default => null,
        };

        if ($kind === null) {
            throw ValidationException::withMessages([
                'package' => ['Nothing to remind about: this package is paid and not waiting on a renewal. / لا يوجد ما يُذكَّر به: الباقة مدفوعة ولا تنتظر تجديدًا.'],
            ]);
        }

        // Who gets it: the guardian the bill is addressed to, else the student's guardian, else the
        // student. A package bill is addressed to the child (it never folds into the guardian's
        // invoice), so stopping at the invoice would message a child instead of the parent who pays.
        $payer = DB::table('lesson_packages as p')
            ->join('students as s', 's.id', '=', 'p.student_id')
            ->join('academies as a', 'a.id', '=', 'p.academy_id')
            ->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->leftJoin('guardians as gi', 'gi.id', '=', 'i.guardian_id')
            ->leftJoin('guardians as gs', 'gs.id', '=', 's.guardian_id')
            ->where('p.id', $id)
            ->first([
                'p.academy_id', 'p.student_id', 'a.name as academy_name', 'a.timezone as academy_timezone',
                'gi.id as invoice_guardian_id', 'gi.whatsapp_phone as invoice_guardian_phone',
                'gs.id as student_guardian_id', 'gs.whatsapp_phone as student_guardian_phone',
                's.whatsapp_phone as student_phone',
            ]);

        [$phone, $recipientKind, $recipientId] = match (true) {
            trim((string) $payer->invoice_guardian_phone) !== '' => [$payer->invoice_guardian_phone, 'GUARDIAN', $payer->invoice_guardian_id],
            trim((string) $payer->student_guardian_phone) !== '' => [$payer->student_guardian_phone, 'GUARDIAN', $payer->student_guardian_id],
            default => [$payer->student_phone, 'STUDENT', $payer->student_id],
        };
        $phone = trim((string) $phone);
        if ($phone === '') {
            throw ValidationException::withMessages([
                'phone' => ['No WhatsApp number on file for this student or their guardian. / لا يوجد رقم واتساب مسجّل للطالب أو ولي الأمر.'],
            ]);
        }

        $academyId = (string) $payer->academy_id;
        $url = $kind === PackageReminderMessage::PAYMENT && $row->invoice_token !== null
            ? AcademyUrl::invoice($academyId, (string) $row->invoice_token)
            : null;

        $message = PackageReminderMessage::build($kind, (string) ($validated['locale'] ?? 'ar'), [
            'academy' => (string) $payer->academy_name,
            'student' => (string) $row->student_name,
            'label' => (string) $row->label,
            'sequence_no' => $presented['sequence_no'],
            'minutes_total' => $presented['minutes_sold'],
            'minutes_remaining' => $presented['minutes_remaining'],
            'finished' => $row->status !== 'ACTIVE',
            // The day it ran out, in the academy's own calendar — what the family remembers.
            'finished_on' => $row->closed_at !== null
                ? Carbon::parse($row->closed_at)->setTimezone((string) ($payer->academy_timezone ?: 'UTC'))->toDateString()
                : null,
            'total_minor' => $presented['invoice_total_minor'],
            'paid_minor' => $presented['invoice_paid_minor'],
            'balance_minor' => $presented['outstanding_minor'],
            'currency' => (string) $row->currency,
            'url' => $url,
        ]);

        $send = [
            'transport' => 'DEEPLINK',
            'sent' => false,
            'deeplink' => app(WhatsAppSender::class)->deeplink($phone, $message),
        ];

        // Bound WITH its offset: a bare Carbon lands in timestamptz as a naive local time, read in
        // the database's own zone (Africa/Cairo), and the date shown on the card comes out hours off.
        $now = now();
        DB::table('lesson_packages')->where('id', $id)->update([
            'reminders_sent' => DB::raw('reminders_sent + 1'),
            'last_reminded_at' => $now->toIso8601String(),
            'updated_at' => $now->toIso8601String(),
        ]);
        $count = (int) DB::table('lesson_packages')->where('id', $id)->value('reminders_sent');

        $ctx = app(AuthContext::class);
        Audit::log('lesson_package.reminder_sent', 'lesson_package', $id, $academyId, $ctx->userId, $ctx->role, after: [
            'kind' => $kind,
            'phone' => $phone,
            'transport' => $send['transport'],
            'sent' => $send['sent'],
            'recipient_kind' => $recipientKind,
            'recipient_id' => (string) $recipientId,
            'reminders_sent' => $count,
        ]);

        return response()->json([
            'kind' => $kind,
            'phone' => $phone,
            'message' => $message,
            'transport' => $send['transport'],
            'sent' => $send['sent'],
            'deeplink' => $send['deeplink'],
            'reminders_sent' => $count,
            'last_reminded_at' => $now->utc()->toIso8601String(),
        ]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function baseQuery()
    {
        return DB::table('lesson_packages as p')
            ->join('students as s', 's.id', '=', 'p.student_id')
            // The family it belongs to — the Due page gathers a parent's children under one card.
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->leftJoin('teachers as st', 'st.id', '=', 'p.teacher_id')
            ->select([
                'p.id', 'p.student_id', 'p.label', 'p.minutes_total', 'p.minutes_consumed',
                'p.carried_over_minutes', 'p.minutes_overdrawn', 'p.price_minor', 'p.currency',
                'p.hourly_rate_minor', 'p.bill_timing', 'p.status', 'p.sequence_no',
                'p.starts_on', 'p.expires_on', 'p.invoice_id', 'p.overdraft_invoice_id',
                'p.closed_at', 'p.closed_reason', 'p.created_at',
                'p.reminders_sent', 'p.last_reminded_at',
                'p.auto_renew', 'p.opened_automatically', 'p.renewal_held_at', 'p.absorbed_overdraft_minutes', 'p.overdraft_absorbed_by',
                'p.teacher_id as subject_teacher_id', 'p.course as subject_course', 'st.full_name as subject_teacher_name',
                's.full_name as student_name',
                'g.id as guardian_id', 'g.full_name as guardian_name', 'g.whatsapp_phone as guardian_phone',
                'i.status as invoice_status', 'i.total_minor as invoice_total_minor',
                'i.amount_paid_minor as invoice_paid_minor', 'i.public_token as invoice_token',
                'i.paid_at as invoice_paid_at',
                'i.payment_method', 'i.payment_reason', 'i.payment_reference', 'i.payment_proof_path',
            ])
            ->selectSub(
                DB::table('lesson_package_credits as pc')
                    ->selectRaw('count(*)')
                    ->whereColumn('pc.package_id', 'p.id'),
                'lesson_count',
            )
            ->selectSub(
                DB::table('lesson_packages as absorber')
                    ->select('absorber.sequence_no')
                    ->whereColumn('absorber.id', 'p.overdraft_absorbed_by'),
                'overdraft_absorbed_into',
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
     * The packages whose student ran out and is still on package billing with nothing open — and
     * what has been taught since: lessons, minutes and what they were billed, per currency.
     *
     * A package is in here when it is finished, it is the student's LATEST (so no next block has
     * been opened), and the student's subscription still says PER_PACKAGE (nobody moved them back
     * to monthly). Every lesson they take from then on is billed by the hour outside any package
     * ({@see LessonPackages::consume()} declines it), and those lines live on an invoice the
     * packages screen never showed — so a finished card read "next lesson tomorrow" with no hint
     * that the lesson would be billed somewhere else.
     *
     * "Since" is the invoice line's own created_at against the package's closed_at, not the lesson
     * date: a lesson taught before the block ran out but marked after it was billed outside it all
     * the same. Free trials are left out exactly as the backdated sync leaves them out.
     *
     * @param  list<string>|null  $packageIds  null = every such package in the academy.
     * @return array<string, array{lessons:int, minutes:int, amounts:list<array{currency:string, amount_minor:int}>}>
     */
    private function gapsFor(?array $packageIds): array
    {
        if ($packageIds === []) {
            return [];
        }

        $candidates = DB::table('lesson_packages as p')
            ->when($packageIds !== null, fn ($q) => $q->whereIn('p.id', $packageIds))
            ->where('p.status', '!=', 'ACTIVE')
            ->whereNotNull('p.closed_at')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('lesson_packages as later')
                ->whereColumn('later.student_id', 'p.student_id')
                ->whereColumn('later.sequence_no', '>', 'p.sequence_no')
                ->whereRaw('later.teacher_id is not distinct from p.teacher_id'))
            ->whereExists(fn ($q) => $q->select(DB::raw(1))
                ->from('subscriptions as sub')
                ->whereColumn('sub.student_id', 'p.student_id')
                ->where('sub.status', 'ACTIVE')
                ->whereNull('sub.deleted_at')
                ->where('sub.price_basis', LessonPackages::BASIS))
            ->pluck('p.id')
            ->map(fn ($id) => (string) $id)
            ->all();

        if ($candidates === []) {
            return [];
        }

        $gaps = [];
        foreach ($candidates as $id) {
            $gaps[$id] = ['lessons' => 0, 'minutes' => 0, 'amounts' => []];
        }

        $lines = DB::table('invoice_line_items as li')
            ->join('lesson_packages as p', 'p.student_id', '=', 'li.student_id')
            ->join('sessions as sess', 'sess.id', '=', 'li.session_id')
            ->leftJoin('schedules as gsch', 'gsch.id', '=', 'sess.schedule_id')
            ->leftJoin('lesson_package_credits as credit', 'credit.session_id', '=', 'li.session_id')
            ->leftJoin('session_reports as report', 'report.session_id', '=', 'li.session_id')
            ->whereIn('p.id', $candidates)
            ->whereRaw('(p.teacher_id is null or coalesce(gsch.teacher_id, sess.teacher_id) = p.teacher_id)')
            ->whereNull('credit.id')
            ->whereColumn('li.created_at', '>=', 'p.closed_at')
            ->whereRaw("coalesce((report.values->>'is_free_trial')::boolean, false) = false")
            ->groupBy('p.id', 'li.currency')
            ->orderBy('li.currency')
            ->selectRaw('p.id as package_id, li.currency, count(*) as lessons')
            ->selectRaw('coalesce(sum(sess.duration_minutes), 0) as minutes, coalesce(sum(li.amount_minor), 0) as amount_minor')
            ->get();

        foreach ($lines as $line) {
            $id = (string) $line->package_id;
            $gaps[$id]['lessons'] += (int) $line->lessons;
            $gaps[$id]['minutes'] += (int) $line->minutes;
            // Never summed across currencies — one entry per currency, as everywhere else here.
            $gaps[$id]['amounts'][] = [
                'currency' => trim((string) $line->currency),
                'amount_minor' => (int) $line->amount_minor,
            ];
        }

        return $gaps;
    }

    /**
     * Narrow a lesson_packages query (aliased `p`, invoices left-joined as `i`) to the packages
     * with money still owed on them — the SQL twin of the `due` flag in {@see present()}.
     */
    private function whereDue($query)
    {
        return $query->where(fn ($q) => $q
            ->where(fn ($unpaid) => $unpaid
                ->whereIn('i.status', self::UNPAID_INVOICE_STATUSES)
                ->whereRaw('i.total_minor > i.amount_paid_minor'))
            ->orWhere(fn ($unbilled) => $unbilled
                ->where('p.status', 'COMPLETED')
                ->whereNull('p.invoice_id')
                ->where('p.minutes_consumed', '>', 0))
            ->orWhere(fn ($overdraft) => $overdraft
                ->where('p.status', 'COMPLETED')
                ->where('p.minutes_overdrawn', '>', 0)
                ->whereNull('p.overdraft_invoice_id')
                ->whereNull('p.overdraft_absorbed_by')));
    }

    /**
     * What each student still owes on their EARLIER packages — the case where a new block was
     * opened before the last one was paid. Keyed by student; money per currency, never summed.
     *
     * Only the packages' own bills count, the same debt each finished card shows as "amount due",
     * so the open card and the finished card it points at can never disagree.
     *
     * @param  list<string>  $studentIds
     * @return array<string, array{packages:int, sequence_nos:list<int>, amounts:list<array{currency:string, amount_minor:int}>}>
     */
    private function previousUnpaidFor(array $studentIds): array
    {
        if ($studentIds === []) {
            return [];
        }

        $rows = DB::table('lesson_packages as p')
            ->join('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->whereIn('p.student_id', array_values(array_unique($studentIds)))
            ->where('p.status', '!=', 'ACTIVE')
            ->whereIn('i.status', self::UNPAID_INVOICE_STATUSES)
            ->whereRaw('i.total_minor > i.amount_paid_minor')
            ->groupBy('p.student_id', 'i.currency')
            ->orderBy('i.currency')
            ->selectRaw('p.student_id, i.currency, sum(i.total_minor - i.amount_paid_minor) as due_minor')
            ->selectRaw('json_agg(p.sequence_no order by p.sequence_no) as sequence_nos')
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $student = (string) $row->student_id;
            $out[$student] ??= ['packages' => 0, 'sequence_nos' => [], 'amounts' => []];
            $numbers = array_map('intval', (array) json_decode((string) $row->sequence_nos, true));
            $out[$student]['sequence_nos'] = array_values(array_unique([...$out[$student]['sequence_nos'], ...$numbers]));
            sort($out[$student]['sequence_nos']);
            $out[$student]['packages'] = count($out[$student]['sequence_nos']);
            $out[$student]['amounts'][] = [
                'currency' => trim((string) $row->currency),
                'amount_minor' => (int) $row->due_minor,
            ];
        }

        return $out;
    }

    /**
     * Shape one row for the client. `minutes_remaining` is clamped at zero and the overdraw is
     * reported separately — "how much is left" and "how far past the end we went" are two
     * different questions and collapsing them into one signed number reads wrong on a progress bar.
     *
     * @param  array<string, array{lessons:int, minutes:int, amounts:list<array{currency:string, amount_minor:int}>}>  $gaps  {@see gapsFor()}
     * @param  array<string, array{packages:int, sequence_nos:list<int>, amounts:list<array{currency:string, amount_minor:int}>}>  $previous  {@see previousUnpaidFor()}
     * @return array<string,mixed>
     */
    private function present(object $row, array $gaps = [], array $previous = []): array
    {
        $gap = $gaps[(string) $row->id] ?? null;
        $isActive = (string) $row->status === 'ACTIVE';
        $sold = (int) $row->minutes_total + (int) $row->carried_over_minutes;
        $consumed = (int) $row->minutes_consumed;
        $remaining = max(0, $sold - $consumed);
        $outstanding = $row->invoice_status !== null
            ? max(0, (int) $row->invoice_total_minor - (int) $row->invoice_paid_minor)
            : 0;

        // Money still owed on THIS package, whatever its status: its bill is unpaid, it was used but
        // never billed, or its overdraft is stranded. The rows of the Due page ({@see whereDue()} is
        // the same rule in SQL). A package opened today and not yet paid is due — payment is up
        // front, so "it just opened" is exactly when the money is expected.
        $due = (in_array((string) $row->invoice_status, self::UNPAID_INVOICE_STATUSES, true) && $outstanding > 0)
            || ($row->status === 'COMPLETED' && $row->invoice_id === null && $consumed > 0)
            || ($row->status === 'COMPLETED' && (int) $row->minutes_overdrawn > 0 && $row->overdraft_invoice_id === null && $row->overdraft_absorbed_by === null);

        // A finished package someone still has to follow up on — the rows behind the red badge on
        // "Finished packages" ({@see summary()} counts the same four conditions).
        $followUp = ! $isActive && (
            (in_array((string) $row->invoice_status, self::UNPAID_INVOICE_STATUSES, true) && $outstanding > 0)
            || ($row->status === 'COMPLETED' && $row->invoice_id === null && $consumed > 0)
            || ($row->status === 'COMPLETED' && (int) $row->minutes_overdrawn > 0 && $row->overdraft_invoice_id === null && $row->overdraft_absorbed_by === null)
            || ($gap !== null && $gap['lessons'] > 0)
        );

        return [
            'id' => (string) $row->id,
            'student_id' => (string) $row->student_id,
            'student_name' => (string) $row->student_name,
            'guardian_id' => $row->guardian_id !== null ? (string) $row->guardian_id : null,
            'guardian_name' => $row->guardian_name,
            'guardian_phone' => $row->guardian_phone,
            // A centre's block for one subject (null = any of the student's lessons).
            'subject' => $row->subject_teacher_id !== null ? [
                'teacher_id' => (string) $row->subject_teacher_id,
                'teacher_name' => $row->subject_teacher_name,
                'course' => $row->subject_course,
            ] : null,
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
            // When the bill was settled in full — the date the Paid tab of Finished packages filters on.
            'paid_at' => $row->invoice_paid_at !== null ? Carbon::parse($row->invoice_paid_at)->utc()->toIso8601String() : null,
            'payment_method' => $row->payment_method !== null ? (string) $row->payment_method : null,
            'payment_reason' => $row->payment_reason !== null ? (string) $row->payment_reason : null,
            'payment_reference' => $row->payment_reference !== null ? (string) $row->payment_reference : null,
            'payment_proof_url' => $row->payment_proof_path !== null
                ? "/api/invoices/{$row->invoice_id}/payment-proof"
                : null,
            'overdraft_billed' => $row->overdraft_invoice_id !== null,
            // The package # whose first minutes paid for this block's overdraft, instead of a bill.
            'overdraft_absorbed_into' => $row->overdraft_absorbed_into !== null ? (int) $row->overdraft_absorbed_into : null,
            // How many of THIS block's used minutes were the previous block's last lesson running over.
            'absorbed_overdraft_minutes' => (int) $row->absorbed_overdraft_minutes,
            'auto_renew' => (bool) $row->auto_renew,
            'opened_automatically' => (bool) $row->opened_automatically,
            // The student's latest block, finished, and they are still on package billing: the
            // owner owes a decision — open the next block or move them back to monthly.
            'awaiting_next_package' => $gap !== null,
            // Pay first: this block's renewal waits until the family's package bills are paid.
            'renewal_held' => $gap !== null && $row->renewal_held_at !== null,
            // What has been taught since it ran out, billed by the hour outside any package.
            'gap' => $gap !== null && $gap['lessons'] > 0 ? $gap : null,
            'follow_up' => $followUp,
            'due' => $due,
            // An open block whose student still owes on an earlier one: it was opened before the
            // last one was paid. Null when nothing earlier is owed.
            'previous_unpaid' => $isActive ? ($previous[(string) $row->student_id] ?? null) : null,
            'reminders_sent' => (int) ($row->reminders_sent ?? 0),
            'last_reminded_at' => $row->last_reminded_at !== null ? Carbon::parse($row->last_reminded_at)->utc()->toIso8601String() : null,
            'created_at' => Carbon::parse($row->created_at)->utc()->toIso8601String(),
        ];
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

        $teacherId = $data['teacher_id'] ?? StudentTeachers::defaultFor((string) $package->student_id);

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
