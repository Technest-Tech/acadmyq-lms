<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Invoicing;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

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
                'inv.period_year',
                'inv.period_month',
                'inv.status',
                'inv.currency',
                'inv.subtotal_minor',
                'inv.total_minor',
                'inv.amount_paid_minor',
                DB::raw("coalesce(g.full_name, s.full_name) as payer_name"),
                DB::raw("case when inv.guardian_id is not null then 'guardian' else 'student' end as payer_type"),
                'inv.sent_at',
                'inv.closed_at',
                'inv.paid_at',
                'inv.public_token',
            ]);

        $result = DataTable::paginate($query, $request, [
            'searchable' => [],
            'filters' => [
                'status' => fn ($q, $v) => $q->where('inv.status', $v),
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
                'period_year' => 'inv.period_year',
                'period_month' => 'inv.period_month',
                'total_minor' => 'inv.total_minor',
                'status' => 'inv.status',
                'created_at' => 'inv.created_at',
            ],
            'defaultSort' => '-created_at',
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
                DB::raw("coalesce(g.full_name, s.full_name) as payer_name"),
                DB::raw("case when inv.guardian_id is not null then 'guardian' else 'student' end as payer_type"),
                DB::raw("coalesce(g.whatsapp_phone, s.whatsapp_phone) as payer_phone"),
            ])
            ->first();

        if ($invoice === null) {
            abort(404, 'Invoice not found.');
        }

        $lineItems = DB::table('invoice_line_items as li')
            ->leftJoin('students as s', 's.id', '=', 'li.student_id')
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
            ])
            ->get();

        return response()->json([
            'invoice' => $invoice,
            'lineItems' => $lineItems,
        ]);
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
            'payment_reason' => ['nullable', 'string'],
            'amount_paid_minor' => ['nullable', 'integer', 'min:0'],
        ]);

        $invoice = DB::table('invoices')->where('id', $id)->first();

        if ($invoice === null) {
            abort(404, 'Invoice not found.');
        }

        if (! in_array($invoice->status, ['CLOSED', 'PARTIALLY_PAID'], true)) {
            abort(422, 'Invoice must be CLOSED or PARTIALLY_PAID to mark as paid.');
        }

        $ctx = app(AuthContext::class);
        $academyId = (string) $invoice->academy_id;
        $userId = $ctx->userId;
        $role = $ctx->role;

        $amountProvided = isset($validated['amount_paid_minor']);
        $amountPaid = $amountProvided ? (int) $validated['amount_paid_minor'] : null;
        $totalMinor = (int) $invoice->total_minor;

        if ($amountProvided && $amountPaid !== null && $amountPaid < $totalMinor) {
            // Partial payment
            $newStatus = 'PARTIALLY_PAID';
            $updates = [
                'status' => $newStatus,
                'amount_paid_minor' => $amountPaid,
                'payment_method' => $validated['payment_method'],
                'payment_reason' => $validated['payment_reason'] ?? null,
                'updated_at' => now(),
            ];
        } else {
            // Full payment
            $newStatus = 'PAID';
            $updates = [
                'status' => $newStatus,
                'paid_at' => now(),
                'amount_paid_minor' => $totalMinor,
                'payment_method' => $validated['payment_method'],
                'payment_reason' => $validated['payment_reason'] ?? null,
                'updated_at' => now(),
            ];
        }

        DB::table('invoices')->where('id', $id)->update($updates);

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
            ],
        );

        return response()->json(['ok' => true, 'status' => $newStatus]);
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
            ->where('inv.id', $id)
            ->select([
                'inv.id',
                'inv.academy_id',
                'inv.guardian_id',
                'inv.student_id',
                'inv.period_year',
                'inv.period_month',
                'inv.public_token',
                DB::raw("coalesce(g.whatsapp_phone, s.whatsapp_phone) as payer_phone"),
            ])
            ->first();

        if ($invoice === null) {
            abort(404, 'Invoice not found.');
        }

        $phone = (string) ($invoice->payer_phone ?? '');

        $frontendUrl = config('app.frontend_url') ?: config('app.url');
        $url = rtrim((string) $frontendUrl, '/') . '/i/' . $invoice->public_token;

        $period = sprintf('%04d-%02d', (int) $invoice->period_year, (int) $invoice->period_month);

        $message = implode("\n\n", [
            "مرحباً، يمكنكم الاطلاع على فاتورتكم لشهر {$period} عبر الرابط التالي: {$url}",
            "Hello, please view your invoice for {$period} at: {$url}",
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
        ]);
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

        return response()
            ->json($dto)
            ->header('Cache-Control', 'no-store');
    }
}
