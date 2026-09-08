<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Invoicing;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Sprint 7 invoice surface. Covers listing, detail, period-close, mark-paid, send-link, and
 * the no-auth public token endpoint. All internal endpoints run through auth:sanctum +
 * tenant.context; RLS is the backstop for every DB::table() call. The public endpoint
 * (publicShow) deliberately sits outside those middleware groups in the router.
 */
final class InvoiceController extends Controller
{
    // -------------------------------------------------------------------------
    // GET /api/invoices
    // -------------------------------------------------------------------------

    /**
     * Paginated invoice list with optional filters (status, period, payer_type).
     * Joins guardian/student full_name as payer_name so the frontend never has to
     * request two endpoints.
     */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');

        $query = DB::table('invoices as inv')
            ->leftJoin('guardians as g', 'g.id', '=', 'inv.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'inv.student_id')
            ->select([
                'inv.id',
                'inv.kind',
                'inv.period_year',
                'inv.period_month',
                'inv.status',
                'inv.currency',
                'inv.subtotal_minor',
                'inv.total_minor',
                'inv.amount_paid_minor',
                DB::raw('coalesce(g.full_name, s.full_name) as payer_name'),
                DB::raw("case when inv.guardian_id is not null then 'GUARDIAN' else 'STUDENT' end as payer_type"),
                'inv.sent_at',
                'inv.closed_at',
                'inv.paid_at',
                'inv.public_token',
            ]);

        $result = DataTable::paginate($query, $request, [
            'searchable' => ['g.full_name', 's.full_name'],
            'filters' => [
                'status' => fn ($q, $v) => $q->where('inv.status', $v),
                'kind' => fn ($q, $v) => $q->where('inv.kind', $v),
                'period_year' => fn ($q, $v) => $q->where('inv.period_year', (int) $v),
                'period_month' => fn ($q, $v) => $q->where('inv.period_month', (int) $v),
                'payer_type' => function ($q, $v): void {
                    if ($v === 'guardian') {
                        $q->whereNotNull('inv.guardian_id');
                    } elseif ($v === 'student') {
                        $q->whereNull('inv.guardian_id')->whereNotNull('inv.student_id');
                    }
                },
            ],
            'sortable' => [
                'period' => DB::raw('inv.period_year * 100 + inv.period_month'),
                'period_year' => 'inv.period_year',
                'period_month' => 'inv.period_month',
                'total_minor' => 'inv.total_minor',
                'status' => 'inv.status',
                'created_at' => 'inv.created_at',
            ],
            'defaultSort' => '-period',
            'idColumn' => 'inv.id',
        ]);

        return response()->json([
            'rows' => $result['rows'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pageSize' => $result['pageSize'],
        ]);
    }

    // -------------------------------------------------------------------------
    // POST /api/invoices  — create a MANUAL itemized invoice (OPEN draft)
    // -------------------------------------------------------------------------

    /**
     * Create an operator-driven itemized invoice. Payer is a guardian OR a student; lines are
     * free-form (description + amount). Created as an OPEN MANUAL draft so it follows the same
     * close → send → mark-paid lifecycle as automatic invoices.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('invoice.create');

        $validated = $request->validate([
            'payer_type' => ['required', 'string', 'in:guardian,student'],
            'payer_id' => ['required', 'string'],
            'period_year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'period_month' => ['required', 'integer', 'min:1', 'max:12'],
            'currency' => ['nullable', 'string', 'size:3'],
            'line_items' => ['required', 'array', 'min:1'],
            'line_items.*.description' => ['required', 'string', 'max:500'],
            'line_items.*.amount_minor' => ['required', 'integer', 'min:0'],
            'line_items.*.student_id' => ['nullable', 'string'],
        ]);

        $ctx = app(AuthContext::class);
        $academyId = (string) $ctx->academyId;

        // Resolve payer + a sensible default currency. RLS already scopes these lookups to the
        // caller's academy, so a payer from another tenant simply isn't found.
        $guardianId = null;
        $studentId = null;
        $defaultCurrency = null;

        if ($validated['payer_type'] === 'guardian') {
            $guardian = DB::table('guardians')->where('id', $validated['payer_id'])->first();
            if ($guardian === null) {
                abort(422, 'Payer not found.');
            }
            $guardianId = (string) $guardian->id;
            $defaultCurrency = $guardian->currency ?? null;
        } else {
            $student = DB::table('students')->where('id', $validated['payer_id'])->first();
            if ($student === null) {
                abort(422, 'Payer not found.');
            }
            $studentId = (string) $student->id;
            $defaultCurrency = DB::table('subscriptions')
                ->where('student_id', $studentId)
                ->where('status', 'ACTIVE')
                ->whereNull('deleted_at')
                ->orderByDesc('start_date')
                ->value('currency');
        }

        if (empty($defaultCurrency)) {
            $defaultCurrency = DB::table('academies')->where('id', $academyId)->value('default_currency');
        }

        $currency = strtoupper((string) ($validated['currency'] ?? $defaultCurrency));

        $lines = array_map(fn (array $li): array => [
            'description' => (string) $li['description'],
            'amount_minor' => (int) $li['amount_minor'],
            'student_id' => $li['student_id'] ?? null,
        ], $validated['line_items']);

        $invoiceId = app(Invoicing::class)->createManualInvoice(
            $academyId,
            $guardianId,
            $studentId,
            (int) $validated['period_year'],
            (int) $validated['period_month'],
            $currency,
            $lines,
            (string) $ctx->userId,
            $ctx->role,
        );

        return response()->json(['id' => $invoiceId], 201);
    }

    // -------------------------------------------------------------------------
    // GET /api/invoices/advance-quote  — preview an advance-payment bill
    // -------------------------------------------------------------------------

    /**
     * Read-only preview of an advance-payment invoice: the remaining still-billable sessions
     * for a student from the given start date through month end, priced by their subscription.
     */
    public function advanceQuote(Request $request): JsonResponse
    {
        Gate::authorize('invoice.create');

        $validated = $request->validate([
            'student_id' => ['required', 'string'],
            'start_date' => ['required', 'date'],
        ]);

        $student = DB::table('students')
            ->where('id', $validated['student_id'])
            ->first(['id', 'full_name']);

        if ($student === null) {
            abort(422, 'Student not found.');
        }

        $quote = app(Invoicing::class)->advanceQuote(
            (string) $student->id,
            (string) $validated['start_date'],
        );

        return response()->json([
            'student_name' => $student->full_name,
            ...$quote,
        ]);
    }

    // -------------------------------------------------------------------------
    // POST /api/invoices/advance  — create an advance-payment invoice
    // -------------------------------------------------------------------------

    /**
     * Create the advance-payment invoice from the authoritative server-side quote. Amounts are
     * recomputed here (never trusted from the client) and the covered sessions are pre-billed.
     */
    public function storeAdvance(Request $request): JsonResponse
    {
        Gate::authorize('invoice.create');

        $validated = $request->validate([
            'student_id' => ['required', 'string'],
            'start_date' => ['required', 'date'],
        ]);

        $student = DB::table('students')->where('id', $validated['student_id'])->first(['id']);
        if ($student === null) {
            abort(422, 'Student not found.');
        }

        $ctx = app(AuthContext::class);

        $result = app(Invoicing::class)->createAdvanceInvoice(
            (string) $student->id,
            (string) $validated['start_date'],
            (string) $ctx->userId,
            $ctx->role,
        );

        if ($result['invoice_id'] === null) {
            abort(422, 'No billable sessions remain in this period for the student.');
        }

        return response()->json(['id' => $result['invoice_id'], 'count' => $result['count']], 201);
    }

    // -------------------------------------------------------------------------
    // GET /api/invoices/summary
    // -------------------------------------------------------------------------

    /**
     * Aggregate counters for the invoices dashboard cards. Counts are
     * currency-agnostic; monetary totals are grouped per currency so multi-currency
     * academies are never summed across incompatible units. Honours the same
     * period_year / period_month filters as the list. RLS scopes every row.
     */
    public function summary(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');

        $base = DB::table('invoices');

        if ($request->filled('kind')) {
            $base->where('kind', (string) $request->query('kind'));
        }
        if ($request->filled('period_year')) {
            $base->where('period_year', (int) $request->query('period_year'));
        }
        if ($request->filled('period_month')) {
            $base->where('period_month', (int) $request->query('period_month'));
        }

        $statusRows = (clone $base)
            ->select('status', DB::raw('count(*) as cnt'))
            ->groupBy('status')
            ->get();

        $counts = ['all' => 0, 'OPEN' => 0, 'CLOSED' => 0, 'PAID' => 0, 'PARTIALLY_PAID' => 0];
        foreach ($statusRows as $row) {
            $counts[$row->status] = (int) $row->cnt;
            $counts['all'] += (int) $row->cnt;
        }

        $moneyRows = (clone $base)
            ->select([
                'currency',
                DB::raw('coalesce(sum(total_minor), 0) as billed_minor'),
                DB::raw('coalesce(sum(amount_paid_minor), 0) as collected_minor'),
                DB::raw("coalesce(sum(case when status in ('CLOSED', 'PARTIALLY_PAID') then total_minor - amount_paid_minor else 0 end), 0) as outstanding_minor"),
                // Everything still owed: the unpaid balance of every non-VOID invoice, INCLUDING
                // OPEN ones (manual bills are created OPEN and paid directly, and accruing auto
                // invoices are real amounts owed). Wider than outstanding_minor, which is closed-only.
                DB::raw("coalesce(sum(case when status <> 'VOID' then total_minor - amount_paid_minor else 0 end), 0) as due_minor"),
            ])
            ->groupBy('currency')
            ->orderByDesc('billed_minor')
            ->get()
            ->map(fn ($r) => [
                'currency' => $r->currency,
                'billed_minor' => (int) $r->billed_minor,
                'collected_minor' => (int) $r->collected_minor,
                'outstanding_minor' => (int) $r->outstanding_minor,
                'due_minor' => (int) $r->due_minor,
            ]);

        return response()->json([
            'counts' => $counts,
            'money' => $moneyRows->values(),
        ]);
    }

    // -------------------------------------------------------------------------
    // GET /api/invoices/{id}
    // -------------------------------------------------------------------------

    /**
     * Full invoice detail: payer info + ordered line items with student name.
     */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('invoice.read');

        $invoice = DB::table('invoices as inv')
            ->leftJoin('guardians as g', 'g.id', '=', 'inv.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'inv.student_id')
            ->where('inv.id', $id)
            ->select([
                'inv.id',
                'inv.academy_id',
                'inv.kind',
                'inv.guardian_id',
                'inv.student_id',
                'inv.period_year',
                'inv.period_month',
                'inv.status',
                'inv.currency',
                'inv.subtotal_minor',
                'inv.total_minor',
                'inv.amount_paid_minor',
                'inv.public_token',
                'inv.closed_at',
                'inv.paid_at',
                'inv.payment_method',
                'inv.payment_reason',
                'inv.sent_at',
                'inv.sent_channel',
                'inv.created_at',
                DB::raw('coalesce(g.full_name, s.full_name) as payer_name'),
                DB::raw("case when inv.guardian_id is not null then 'GUARDIAN' else 'STUDENT' end as payer_type"),
                DB::raw('coalesce(g.whatsapp_phone, s.whatsapp_phone) as payer_phone'),
            ])
            ->first();

        if ($invoice === null) {
            abort(404, 'Invoice not found.');
        }

        $lineItems = DB::table('invoice_line_items as li')
            ->leftJoin('students as s', 's.id', '=', 'li.student_id')
            ->leftJoin('sessions as sess', 'sess.id', '=', 'li.session_id')
            ->leftJoin('teachers as tch', 'tch.id', '=', 'sess.teacher_id')
            ->where('li.invoice_id', $id)
            ->orderBy('li.session_date')
            ->orderBy('li.created_at')
            ->select([
                'li.id',
                'li.session_id',
                'li.student_id',
                's.full_name as student_name',
                'li.description',
                'li.amount_minor',
                'li.currency',
                'li.session_date',
                'sess.status as session_status',
                'sess.duration_minutes',
                'tch.full_name as teacher_name',
            ])
            ->get();

        // #19 — every non-billed lesson (cancelled by student/teacher, free, or any trial lesson) is
        // surfaced on the bill for the record, as zero-amount informational rows that never touch
        // subtotal/total. They carry no stored line item (non-billable), so they are derived live from
        // the sessions table at read time.
        $lineItems = $lineItems
            ->concat($this->nonBilledLessonLines($invoice))
            ->sortBy('session_date')
            ->values();

        return response()->json([
            'invoice' => $invoice,
            'lineItems' => $lineItems,
        ]);
    }

    /**
     * Non-billed lessons that fall on this AUTO invoice's payer + period + currency, shaped exactly
     * like a real line item but at zero amount (#19). Informational only — never billed, so they are
     * read live from `sessions` rather than stored. MANUAL/advance invoices are hand-built and keep
     * exactly the lines the operator gave them, so they are skipped.
     *
     * The surfaced set is every outcome-bearing lesson the billing engine left without a line:
     *   • FREE lessons (on the house) and cancelled lessons (by student OR teacher), for any student;
     *   • EVERY lesson of a TRIAL / TRIAL_BOOKED learner — trials are skipped wholesale by
     *     Invoicing::onSessionBillable, so none of their sessions carry a line item.
     * SCHEDULED / RESCHEDULED sessions (no outcome yet / superseded) are excluded.
     *
     * Matching mirrors the billing engine's own payer/currency resolution (see
     * Invoicing::resolvePayerAndCurrency): the local month is derived in the academy timezone, and a
     * lesson only attaches to the invoice whose currency matches the student's active subscription
     * (academy default when the student has none) — so a currency-split guardian never sees the same
     * lesson twice.
     *
     * @return Collection<int, object>
     */
    private function nonBilledLessonLines(object $invoice): Collection
    {
        if (($invoice->kind ?? 'AUTO') !== 'AUTO') {
            return collect();
        }

        $academy = DB::table('academies')
            ->where('id', $invoice->academy_id)
            ->first(['timezone', 'default_currency']);

        $tz = ($academy->timezone ?? null) ?: 'UTC';
        $defaultCurrency = (string) ($academy->default_currency ?? $invoice->currency);

        $query = DB::table('sessions as sess')
            ->join('students as s', 's.id', '=', 'sess.student_id')
            ->leftJoin('teachers as tch', 'tch.id', '=', 'sess.teacher_id')
            ->where('sess.academy_id', $invoice->academy_id)
            ->whereNotIn('sess.status', ['SCHEDULED', 'RESCHEDULED'])
            ->where(function ($q): void {
                // Free / cancelled lessons for anyone, plus every outcome-bearing lesson of a trial learner.
                $q->whereIn('sess.status', ['FREE', 'CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'])
                    ->orWhereIn('s.status', ['TRIAL', 'TRIAL_BOOKED']);
            })
            ->whereRaw('extract(year from (sess.scheduled_at_utc at time zone ?)) = ?', [$tz, (int) $invoice->period_year])
            ->whereRaw('extract(month from (sess.scheduled_at_utc at time zone ?)) = ?', [$tz, (int) $invoice->period_month])
            ->whereRaw(
                'coalesce((select sub.currency from subscriptions sub '
                ."where sub.student_id = sess.student_id and sub.status = 'ACTIVE' and sub.deleted_at is null "
                .'order by sub.start_date desc limit 1), ?) = ?',
                [$defaultCurrency, (string) $invoice->currency],
            )
            ->whereNotExists(function ($q): void {
                $q->select(DB::raw('1'))
                    ->from('invoice_line_items as li')
                    ->whereColumn('li.session_id', 'sess.id');
            });

        if ($invoice->student_id !== null) {
            $query->where('sess.student_id', $invoice->student_id);
        } else {
            $query->where('s.guardian_id', $invoice->guardian_id);
        }

        $rows = $query
            ->select([
                'sess.id',
                'sess.student_id',
                's.full_name as student_name',
                's.status as student_status',
                'sess.status as session_status',
                'sess.duration_minutes',
                'tch.full_name as teacher_name',
            ])
            ->selectRaw("to_char(sess.scheduled_at_utc at time zone ?, 'YYYY-MM-DD') as session_date", [$tz])
            ->get();

        return $rows->map(fn ($r): object => (object) [
            'id' => (string) $r->id,
            'session_id' => (string) $r->id,
            'student_id' => $r->student_id,
            'student_name' => $r->student_name,
            'description' => $this->nonBilledLessonLabel($r),
            'amount_minor' => 0,
            'currency' => (string) $invoice->currency,
            'session_date' => $r->session_date,
            'session_status' => $r->session_status,
            'duration_minutes' => $r->duration_minutes,
            'teacher_name' => $r->teacher_name,
        ]);
    }

    /**
     * English fallback label for a derived (non-billed) lesson row. The clients localize off
     * `session_status`; this keeps the raw `description` sensible for any plain reader.
     */
    private function nonBilledLessonLabel(object $row): string
    {
        if (in_array($row->student_status, ['TRIAL', 'TRIAL_BOOKED'], true)) {
            return 'Trial lesson';
        }

        return $row->session_status === 'FREE' ? 'Free lesson' : 'Cancelled lesson';
    }

    // -------------------------------------------------------------------------
    // POST /api/invoices/close
    // -------------------------------------------------------------------------

    /**
     * Close all OPEN invoices for the caller's academy in the given period.
     * Audit is delegated to Invoicing::closePeriodInvoices().
     */
    public function close(Request $request): JsonResponse
    {
        Gate::authorize('invoice.close');

        $validated = $request->validate([
            'year' => ['required', 'integer'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
        ]);

        $ctx = app(AuthContext::class);
        $academyId = (string) $ctx->academyId;
        $userId = (string) $ctx->userId;
        $role = $ctx->role;

        $closed = app(Invoicing::class)->closePeriodInvoices(
            $academyId,
            (int) $validated['year'],
            (int) $validated['month'],
            $userId,
            $role,
        );

        return response()->json(['closed' => $closed]);
    }

    // -------------------------------------------------------------------------
    // POST /api/invoices/{id}/mark-paid
    // -------------------------------------------------------------------------

    /**
     * Transition a CLOSED or PARTIALLY_PAID invoice to PAID (or PARTIALLY_PAID when
     * amount_paid_minor < total_minor). Accepts optional partial payment amount.
     */
    public function markPaid(Request $request, string $id): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');

        $validated = $request->validate([
            'payment_method' => ['required', 'string', 'in:CASH,BANK_TRANSFER,OTHER'],
            'payment_reason' => ['nullable', 'string', 'max:1000'],
            'payment_reference' => ['nullable', 'string', 'max:255'],
            'payment_proof' => ['nullable', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'amount_paid_minor' => ['nullable', 'integer', 'min:0'],
        ]);

        $invoice = DB::table('invoices')->where('id', $id)->first();

        if ($invoice === null) {
            abort(404, 'Invoice not found.');
        }

        if (! in_array($invoice->status, ['OPEN', 'CLOSED', 'PARTIALLY_PAID'], true)) {
            abort(422, 'Invoice must be OPEN, CLOSED, or PARTIALLY_PAID to mark as paid.');
        }

        $ctx = app(AuthContext::class);
        $academyId = (string) $invoice->academy_id;
        $userId = $ctx->userId;
        $role = $ctx->role;

        $amountProvided = isset($validated['amount_paid_minor']);
        $amountPaid = $amountProvided ? (int) $validated['amount_paid_minor'] : null;
        $totalMinor = (int) $invoice->total_minor;
        $oldProofPath = $invoice->payment_proof_path ?? null;
        $proofPath = $oldProofPath;

        if ($request->hasFile('payment_proof')) {
            $proof = $request->file('payment_proof');
            $extension = strtolower((string) ($proof?->extension() ?: 'jpg'));
            $proofPath = $proof?->storeAs(
                "invoice-payment-proofs/{$academyId}/{$id}",
                Str::uuid().'.'.$extension,
                'local',
            );

            if (! is_string($proofPath) || $proofPath === '') {
                abort(500, 'Payment proof could not be stored.');
            }
        }

        $evidence = [
            'payment_reference' => isset($validated['payment_reference']) && trim((string) $validated['payment_reference']) !== ''
                ? trim((string) $validated['payment_reference'])
                : null,
            'payment_proof_path' => $proofPath,
        ];

        if ($amountProvided && $amountPaid !== null && $amountPaid < $totalMinor) {
            // Partial payment
            $newStatus = 'PARTIALLY_PAID';
            $updates = $evidence + [
                'status' => $newStatus,
                'amount_paid_minor' => $amountPaid,
                'payment_method' => $validated['payment_method'],
                'payment_reason' => $validated['payment_reason'] ?? null,
                'updated_at' => now(),
            ];
        } else {
            // Full payment
            $newStatus = 'PAID';
            $updates = $evidence + [
                'status' => $newStatus,
                'paid_at' => now(),
                'amount_paid_minor' => $totalMinor,
                'payment_method' => $validated['payment_method'],
                'payment_reason' => $validated['payment_reason'] ?? null,
                'updated_at' => now(),
            ];
        }

        DB::table('invoices')->where('id', $id)->update($updates);

        if (is_string($oldProofPath) && $oldProofPath !== '' && $oldProofPath !== $proofPath) {
            Storage::disk('local')->delete($oldProofPath);
        }

        Audit::log(
            'invoice.marked_paid',
            'invoice',
            $id,
            $academyId,
            $userId,
            $role,
            after: [
                'status' => $newStatus,
                'payment_method' => $validated['payment_method'],
                'amount_paid_minor' => $updates['amount_paid_minor'],
                'payment_reference' => $evidence['payment_reference'],
                'has_payment_proof' => $proofPath !== null,
            ],
        );

        return response()->json([
            'ok' => true,
            'status' => $newStatus,
            'amount_paid_minor' => $updates['amount_paid_minor'],
            'payment_reference' => $evidence['payment_reference'],
            'payment_proof_url' => $proofPath !== null ? "/api/invoices/{$id}/payment-proof" : null,
        ]);
    }

    /** Stream privately stored offline-payment evidence to an authorized invoice reader. */
    public function paymentProof(string $id): StreamedResponse
    {
        Gate::authorize('invoice.read');

        $invoice = DB::table('invoices')->where('id', $id)->first(['id', 'payment_proof_path']);
        $path = $invoice?->payment_proof_path;

        if (! is_string($path) || $path === '' || ! Storage::disk('local')->exists($path)) {
            abort(404, 'Payment proof not found.');
        }

        $extension = pathinfo($path, PATHINFO_EXTENSION) ?: 'jpg';

        return Storage::disk('local')->download($path, "invoice-{$id}-payment-proof.{$extension}");
    }

    // -------------------------------------------------------------------------
    // POST /api/invoices/{id}/send-link
    // -------------------------------------------------------------------------

    /**
     * Build the WhatsApp payment-link message and record it as sent. Does NOT dispatch
     * automated delivery (Sprint 10 owns that); the caller copies the returned message
     * and sends it manually from their WhatsApp client.
     */
    public function sendLink(string $id): JsonResponse
    {
        Gate::authorize('invoice.send_link');

        $invoice = DB::table('invoices as inv')
            ->leftJoin('guardians as g', 'g.id', '=', 'inv.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'inv.student_id')
            ->leftJoin('academies as a', 'a.id', '=', 'inv.academy_id')
            ->where('inv.id', $id)
            ->select([
                'inv.id',
                'inv.academy_id',
                'inv.guardian_id',
                'inv.student_id',
                'inv.period_year',
                'inv.period_month',
                'inv.public_token',
                'inv.status',
                'inv.currency',
                'inv.total_minor',
                'inv.amount_paid_minor',
                'a.name as academy_name',
                DB::raw('coalesce(g.full_name, s.full_name) as payer_name'),
                DB::raw('coalesce(g.whatsapp_phone, s.whatsapp_phone) as payer_phone'),
            ])
            ->first();

        if ($invoice === null) {
            abort(404, 'Invoice not found.');
        }

        $phone = (string) ($invoice->payer_phone ?? '');

        $frontendUrl = config('app.frontend_url') ?: config('app.url');
        $url = rtrim((string) $frontendUrl, '/').'/i/'.$invoice->public_token;

        $message = $this->buildInvoiceWhatsAppMessage($invoice, $url);

        // Route through the single WhatsApp seam: it sends via the academy's Wasender token when
        // configured, otherwise returns the wa.me deep link the operator opens manually (today's
        // behaviour — the response shape below is unchanged). Sprint "Automation" lights up the
        // Wasender path with zero change here.
        $send = app(WhatsAppSender::class)->sendOrLink((string) $invoice->academy_id, $phone, $message, [
            'automation_type' => 'MANUAL',
            'recipient_kind' => $invoice->guardian_id !== null ? 'GUARDIAN' : 'STUDENT',
            'recipient_id' => (string) ($invoice->guardian_id ?? $invoice->student_id),
            'ref_type' => 'invoice',
            'ref_id' => $id,
        ]);

        $now = now();

        DB::table('invoices')->where('id', $id)->update([
            'sent_at' => $now,
            'sent_channel' => 'WHATSAPP',
            'updated_at' => $now,
        ]);

        $ctx = app(AuthContext::class);
        $academyId = (string) $invoice->academy_id;
        $userId = $ctx->userId;
        $role = $ctx->role;

        Audit::log(
            'invoice.link_sent',
            'invoice',
            $id,
            $academyId,
            $userId,
            $role,
            after: [
                'sent_at' => $now->toIso8601String(),
                'sent_channel' => 'WHATSAPP',
                'payer_phone' => $phone,
            ],
        );

        return response()->json([
            'phone' => $phone,
            'message' => $message,
            'url' => $url,
            'transport' => $send['transport'],
            'sent' => $send['sent'],
        ]);
    }

    /**
     * Compose the modern, bilingual WhatsApp invoice message: an academy header, the payer + period,
     * the total and (for an unpaid bill) the outstanding balance, then a clear call-to-action with
     * the public pay/view link. The link is the {@see $url} to /i/{token} — the public invoice page
     * carries the payment methods, so "details + payment" both live behind one tap.
     */
    private function buildInvoiceWhatsAppMessage(object $invoice, string $url): string
    {
        $academy  = trim((string) ($invoice->academy_name ?? '')) ?: 'Academy';
        $payer    = trim((string) ($invoice->payer_name ?? ''));
        $currency = (string) ($invoice->currency ?? '');
        $period   = sprintf('%04d-%02d', (int) $invoice->period_year, (int) $invoice->period_month);

        $totalMinor   = (int) $invoice->total_minor;
        $balanceMinor = max(0, $totalMinor - (int) $invoice->amount_paid_minor);
        $isPaid       = (string) $invoice->status === 'PAID' || $balanceMinor === 0;

        $total   = $this->formatMoney($totalMinor, $currency);
        $balance = $this->formatMoney($balanceMinor, $currency);

        // Arabic block.
        $ar = ["🧾 *فاتورة {$academy}*"];
        if ($payer !== '') {
            $ar[] = "👤 {$payer}";
        }
        $ar[] = "📅 الفترة: {$period}";
        $ar[] = "💰 الإجمالي: {$total}";
        $ar[] = $isPaid ? '✅ مدفوعة بالكامل — شكراً لكم' : "⏳ المبلغ المستحق: {$balance}";
        $ar[] = '';
        $ar[] = $isPaid ? "📄 لمراجعة الفاتورة: {$url}" : "💳 لعرض التفاصيل والدفع عبر الرابط: {$url}";

        // English block.
        $en = ["🧾 *{$academy} Invoice*"];
        if ($payer !== '') {
            $en[] = "👤 {$payer}";
        }
        $en[] = "📅 Period: {$period}";
        $en[] = "💰 Total: {$total}";
        $en[] = $isPaid ? '✅ Paid in full — thank you' : "⏳ Balance due: {$balance}";
        $en[] = '';
        $en[] = $isPaid ? "📄 View your invoice: {$url}" : "💳 View details & pay here: {$url}";

        return implode("\n", $ar)."\n\n———\n\n".implode("\n", $en);
    }

    /** Minor units → "1,234.50 EGP" (2-decimal currencies). */
    private function formatMoney(int $minor, string $currency): string
    {
        $amount = number_format($minor / 100, 2);

        return trim($amount.' '.$currency);
    }

    // -------------------------------------------------------------------------
    // GET /api/i/{token}  — PUBLIC, no auth middleware
    // -------------------------------------------------------------------------

    /**
     * Public invoice view via token. Calls the Postgres function
     * app.public_invoice_by_token() which returns a JSON blob containing only the
     * fields safe to expose without authentication. Cache-Control: no-store prevents
     * proxies and browsers from caching the sensitive financial data.
     */
    public function publicShow(string $token): JsonResponse
    {
        $rows = DB::select('select app.public_invoice_by_token(?) as data', [$token]);
        $raw = $rows[0]->data ?? null;

        if ($raw === null) {
            abort(404, 'Invoice not found.');
        }

        $dto = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        if (empty($dto)) {
            abort(404, 'Invoice not found.');
        }

        // no-store keeps the invoice out of shared/browser caches; noindex keeps the public
        // link out of search engines so a token can never be discovered via a crawler (§6.2,
        // AC-9.8). The page renders only this invoice's curated payload (the SECURITY DEFINER
        // function is the allow-list), never a tenant row or a list.
        return response()
            ->json($dto)
            ->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }
}
