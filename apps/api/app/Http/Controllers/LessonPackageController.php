<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\LessonPackages;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

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

        return response()->json([
            'active' => $active,
            'lowBalance' => $lowBalance,
            'needsBilling' => $needsBilling,
            'pendingOverdraft' => $pendingOverdraft,
            'unpaid' => $unpaid,
            'total' => $lowBalance + $needsBilling + $pendingOverdraft + $unpaid,
        ]);
    }

    /**
     * GET /api/packages/students — students on package billing, each with their open package (if
     * any) and the default hourly rate to pre-fill the next one. Drives the "open a package" form.
     */
    public function students(): JsonResponse
    {
        Gate::authorize('package.read');

        $rows = DB::table('students as s')
            ->join('subscriptions as sub', function ($join): void {
                $join->on('sub.student_id', '=', 's.id')
                    ->where('sub.status', '=', 'ACTIVE')
                    ->whereNull('sub.deleted_at');
            })
            ->leftJoin('lesson_packages as p', function ($join): void {
                $join->on('p.student_id', '=', 's.id')->where('p.status', '=', 'ACTIVE');
            })
            ->where('sub.price_basis', LessonPackages::BASIS)
            ->whereNull('s.deleted_at')
            ->orderBy('s.full_name')
            ->get([
                's.id', 's.full_name',
                'sub.currency', 'sub.price_minor as default_hourly_rate_minor',
                'p.id as active_package_id', 'p.label as active_package_label',
            ])
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'full_name' => (string) $row->full_name,
                'currency' => (string) $row->currency,
                'default_hourly_rate_minor' => (int) $row->default_hourly_rate_minor,
                'active_package_id' => $row->active_package_id !== null ? (string) $row->active_package_id : null,
                'active_package_label' => $row->active_package_label !== null ? (string) $row->active_package_label : null,
            ]);

        return response()->json(['students' => $rows]);
    }

    /** GET /api/packages/{id} — one package plus the lessons that consumed it. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('package.read');

        $row = $this->baseQuery()->where('p.id', $id)->first();

        if ($row === null) {
            abort(404, 'Package not found.');
        }

        $credits = DB::table('lesson_package_credits as c')
            ->leftJoin('sessions as sess', 'sess.id', '=', 'c.session_id')
            ->leftJoin('teachers as t', 't.id', '=', 'sess.teacher_id')
            ->where('c.package_id', $id)
            ->orderBy('c.consumed_at')
            ->get([
                'c.id', 'c.session_id', 'c.minutes', 'c.minutes_overdrawn', 'c.amount_minor',
                'c.currency', 'c.description', 'c.consumed_at',
                'sess.scheduled_at_utc', 'sess.status as session_status', 't.full_name as teacher_name',
            ])
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
                'teacher_name' => $c->teacher_name !== null ? (string) $c->teacher_name : null,
            ]);

        return response()->json([
            'package' => $this->present($row),
            'credits' => $credits,
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
     */
    public function close(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');

        $validated = $request->validate([
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $ctx = app(AuthContext::class);

        $result = app(LessonPackages::class)->complete(
            $id,
            (string) ($validated['reason'] ?? 'CLOSED_EARLY'),
            $ctx->userId,
            $ctx->role,
        );

        return response()->json(['ok' => true, 'invoice_id' => $result['invoice_id']]);
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
            'outstanding_minor' => $outstanding,
            'overdraft_billed' => $row->overdraft_invoice_id !== null,
            'created_at' => Carbon::parse($row->created_at)->utc()->toIso8601String(),
        ];
    }
}
