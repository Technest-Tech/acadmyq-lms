<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Services\Lms\CourseOrders;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The client's sales desk (docs/lms/10 §4) — the queue of course orders, the receipts waiting on a
 * decision, and the money the catalogue has actually made.
 *
 * Two capabilities: `course_order.read` opens the screen (someone has to watch the queue), and
 * `course_order.manage` is required for every decision that moves money or access. RLS scopes every
 * row to the client's own academy; `CourseOrders` owns the state machine so the dashboard and the
 * learner site can never disagree about what an order means.
 */
final class OrderController extends Controller
{
    use InteractsWithLms;

    private const STATUSES = [
        'AWAITING_PAYMENT', 'UNDER_REVIEW', 'PAID', 'REJECTED', 'CANCELLED', 'REFUNDED',
    ];

    public function __construct(private readonly CourseOrders $orders) {}

    /** GET /api/courses/orders — the server-driven order queue (search / filter / sort / page). */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('course_order.read');

        // LEFT joins to BOTH catalogues: an order is over exactly one of them (the DB's
        // course_orders_item_chk guarantees it), so an inner join to `courses` would silently hide
        // every book order from the queue that is supposed to be the client's one inbox.
        $query = DB::table('course_orders as o')
            ->leftJoin('courses as c', 'c.id', '=', 'o.course_id')
            ->leftJoin('digital_products as p', 'p.id', '=', 'o.product_id')
            ->leftJoin('learners as l', 'l.id', '=', 'o.learner_id')
            ->select([
                'o.id', 'o.order_number', 'o.status', 'o.channel', 'o.price_minor', 'o.currency',
                'o.payment_method_type', 'o.buyer_name', 'o.buyer_email', 'o.buyer_phone',
                'o.rejection_reason', 'o.submitted_at', 'o.confirmed_at', 'o.created_at',
                'o.item_type', 'o.course_id', 'o.product_id',
                DB::raw('coalesce(c.title, p.title) as item_title'),
                DB::raw('coalesce(c.slug, p.slug) as item_slug'),
                'l.id as learner_id', 'l.status as learner_status',
                DB::raw('(select count(*) from course_order_receipts r where r.order_id = o.id) as receipt_count'),
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'o.id',
            'searchable' => ['o.order_number', 'o.buyer_name', 'o.buyer_email', 'o.buyer_phone',
                'c.title', 'p.title'],
            'sortable' => [
                'created_at' => 'o.created_at',
                'status' => 'o.status',
                'price_minor' => 'o.price_minor',
                'order_number' => 'o.order_number',
                // The select's alias: Postgres lets ORDER BY name an output column, which keeps the
                // sortable map plain strings instead of leaking an Expression into DataTable.
                'course' => 'item_title',
            ],
            'filters' => [
                'status' => fn ($q, $v) => $q->where('o.status', strtoupper((string) $v)),
                'course_id' => fn ($q, $v) => $q->where('o.course_id', (string) $v),
                'product_id' => fn ($q, $v) => $q->where('o.product_id', (string) $v),
                // "Show me book sales" — the one new facet the queue needs now that it holds two
                // kinds of thing.
                'item_type' => fn ($q, $v) => $q->where('o.item_type', strtoupper((string) $v)),
                'method' => fn ($q, $v) => $q->where('o.payment_method_type', strtoupper((string) $v)),
                'from' => fn ($q, $v) => $q->whereDate('o.created_at', '>=', (string) $v),
                'to' => fn ($q, $v) => $q->whereDate('o.created_at', '<=', (string) $v),
                // The one filter the screen actually opens on: everything a human still owes a decision.
                'needs_action' => fn ($q, $v) => filter_var($v, FILTER_VALIDATE_BOOLEAN)
                    ? $q->whereIn('o.status', CourseOrders::OPEN_STATUSES)
                    : $q,
            ],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): array => $this->rowDto($r));

        return response()->json($result);
    }

    /**
     * GET /api/courses/orders/summary — the headline numbers plus per-course sales.
     *
     * "Revenue" counts PAID only. A refunded order is money that came back, so it is excluded from
     * the total and reported on its own line rather than quietly netted out of it.
     */
    public function summary(): JsonResponse
    {
        Gate::authorize('course_order.read');

        $totals = DB::table('course_orders')
            ->selectRaw('count(*) as orders')
            ->selectRaw("count(*) filter (where status = 'PAID') as paid")
            ->selectRaw("count(*) filter (where status = 'UNDER_REVIEW') as under_review")
            ->selectRaw("count(*) filter (where status = 'AWAITING_PAYMENT') as awaiting_payment")
            ->selectRaw("count(*) filter (where status = 'REJECTED') as rejected")
            ->selectRaw("count(*) filter (where status = 'CANCELLED') as cancelled")
            ->selectRaw("count(*) filter (where status = 'REFUNDED') as refunded")
            ->selectRaw("coalesce(sum(price_minor) filter (where status = 'PAID'), 0) as revenue_minor")
            ->selectRaw("coalesce(sum(price_minor) filter (where status = 'REFUNDED'), 0) as refunded_minor")
            ->selectRaw("count(*) filter (where created_at >= date_trunc('month', now())) as orders_this_month")
            ->selectRaw("coalesce(sum(price_minor) filter (where status = 'PAID' and confirmed_at >= date_trunc('month', now())), 0) as revenue_this_month_minor")
            // Books vs courses, because "should I make more books?" is the question the client
            // actually asks of this screen once they sell both.
            ->selectRaw("count(*) filter (where item_type = 'PRODUCT') as product_orders")
            ->selectRaw("coalesce(sum(price_minor) filter (where status = 'PAID' and item_type = 'PRODUCT'), 0) as product_revenue_minor")
            ->first();

        // "What sold" across BOTH catalogues, one leaderboard. Grouping on the item_type/id pair
        // rather than on the course keeps a book and a course that happen to share a title apart,
        // and the coalesced title is what the row prints either way.
        $byCourse = DB::table('course_orders as o')
            ->leftJoin('courses as c', 'c.id', '=', 'o.course_id')
            ->leftJoin('digital_products as p', 'p.id', '=', 'o.product_id')
            ->groupBy('o.item_type', DB::raw('coalesce(o.course_id, o.product_id)'),
                DB::raw('coalesce(c.title, p.title)'), DB::raw('coalesce(c.slug, p.slug)'))
            ->orderByDesc(DB::raw("coalesce(sum(o.price_minor) filter (where o.status = 'PAID'), 0)"))
            ->limit(50)
            ->get([
                'o.item_type',
                DB::raw('coalesce(o.course_id, o.product_id) as item_id'),
                DB::raw('coalesce(c.title, p.title) as title'),
                DB::raw('coalesce(c.slug, p.slug) as slug'),
                DB::raw('count(*) as orders'),
                DB::raw("count(*) filter (where o.status = 'PAID') as paid"),
                DB::raw("coalesce(sum(o.price_minor) filter (where o.status = 'PAID'), 0) as revenue_minor"),
            ])
            ->map(fn (object $r): array => [
                'item_type' => (string) $r->item_type,
                'item_id' => (string) $r->item_id,
                // Kept so an older sales screen still reads the id it expects for a course row.
                'course_id' => (string) $r->item_id,
                'title' => (string) ($r->title ?? ''),
                'slug' => (string) ($r->slug ?? ''),
                'orders' => (int) $r->orders,
                'paid' => (int) $r->paid,
                'revenue_minor' => (int) $r->revenue_minor,
            ]);

        // Receipts, not orders: a rejected order that has been re-uploaded is one PENDING receipt.
        $pendingReceipts = (int) DB::table('course_order_receipts')
            ->where('review_status', 'PENDING')->count();

        return response()->json([
            'currency' => $this->academyCurrency(),
            'stats' => [
                'orders' => (int) $totals->orders,
                'paid' => (int) $totals->paid,
                'under_review' => (int) $totals->under_review,
                'awaiting_payment' => (int) $totals->awaiting_payment,
                'rejected' => (int) $totals->rejected,
                'cancelled' => (int) $totals->cancelled,
                'refunded' => (int) $totals->refunded,
                'pending_receipts' => $pendingReceipts,
                'revenue_minor' => (int) $totals->revenue_minor,
                'refunded_minor' => (int) $totals->refunded_minor,
                'orders_this_month' => (int) $totals->orders_this_month,
                'revenue_this_month_minor' => (int) $totals->revenue_this_month_minor,
                'product_orders' => (int) $totals->product_orders,
                'product_revenue_minor' => (int) $totals->product_revenue_minor,
            ],
            'by_course' => $byCourse,
        ]);
    }

    /** GET /api/courses/orders/{id} — one order, its receipts, and the buyer behind it. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('course_order.read');

        $order = DB::table('course_orders as o')
            ->leftJoin('courses as c', 'c.id', '=', 'o.course_id')
            ->leftJoin('digital_products as p', 'p.id', '=', 'o.product_id')
            ->leftJoin('learners as l', 'l.id', '=', 'o.learner_id')
            ->where('o.id', $id)
            ->first([
                'o.*',
                DB::raw('coalesce(c.title, p.title) as item_title'),
                DB::raw('coalesce(c.slug, p.slug) as item_slug'),
                'l.full_name as learner_name', 'l.email as learner_email', 'l.phone as learner_phone',
                'l.status as learner_status', 'l.created_at as learner_since',
            ]);

        if ($order === null) {
            abort(404, 'Order not found.');
        }

        $receipts = DB::table('course_order_receipts')
            ->where('order_id', $id)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (object $r): array => [
                'id' => (string) $r->id,
                'method_type' => (string) $r->method_type,
                'sender_name' => $r->sender_name,
                'sender_reference' => $r->sender_reference,
                'amount_minor' => $r->amount_minor === null ? null : (int) $r->amount_minor,
                'paid_at' => $this->iso($r->paid_at),
                'note' => $r->note,
                'review_status' => (string) $r->review_status,
                'rejection_reason' => $r->rejection_reason,
                'reviewed_at' => $this->iso($r->reviewed_at),
                'created_at' => $this->iso($r->created_at),
                // A key, never a URL: the file is streamed through the gated endpoint below.
                'is_pdf' => str_ends_with(strtolower((string) $r->file_path), '.pdf'),
            ]);

        // "Does the buyer actually have it?" — the same question either way, asked of whichever
        // table holds the answer for this kind of order.
        $access = (string) ($order->item_type ?? 'COURSE') === 'PRODUCT'
            ? DB::table('product_entitlements')
                ->where('learner_id', $order->learner_id)
                ->where('product_id', $order->product_id)
                ->first(['status', DB::raw('granted_at as enrolled_at'), 'source_order_id',
                    DB::raw('null::uuid as source_code_id')])
            : DB::table('enrollments')
                ->where('learner_id', $order->learner_id)
                ->where('course_id', $order->course_id)
                ->first(['status', 'enrolled_at', 'source_order_id', 'source_code_id']);

        return response()->json([
            'order' => $this->rowDto($order) + [
                'terms_accepted_at' => $this->iso($order->terms_accepted_at),
                'refunded_at' => $this->iso($order->refunded_at),
                'refund_reason' => $order->refund_reason,
                'staff_note' => $order->staff_note,
                'learner' => [
                    'id' => (string) $order->learner_id,
                    'full_name' => $order->learner_name,
                    'email' => $order->learner_email,
                    'phone' => $order->learner_phone,
                    'status' => $order->learner_status,
                    'since' => $this->iso($order->learner_since),
                ],
                'enrollment' => $access === null ? null : [
                    'status' => (string) $access->status,
                    'enrolled_at' => $this->iso($access->enrolled_at),
                    'from_order' => $access->source_order_id !== null,
                    'from_code' => $access->source_code_id !== null,
                ],
            ],
            'receipts' => $receipts,
        ]);
    }

    /** GET /api/courses/orders/{id}/receipts/{receiptId}/file — stream the private receipt. */
    public function receiptFile(string $id, string $receiptId): StreamedResponse
    {
        Gate::authorize('course_order.read');

        $path = DB::table('course_order_receipts')
            ->where('id', $receiptId)
            ->where('order_id', $id)
            ->value('file_path');

        if ($path === null || ! Storage::disk('local')->exists($path)) {
            abort(404, 'Receipt not found.');
        }

        return Storage::disk('local')->response($path, null, [
            'Cache-Control' => 'no-store',
            'X-Robots-Tag' => 'noindex, nofollow',
        ]);
    }

    /** POST /api/courses/orders/{id}/approve — mark PAID and unlock the course. */
    public function approve(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course_order.manage');
        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:1000']]);

        $order = $this->orders->approve(
            $this->currentAcademyId(),
            $id,
            $this->ctx()->userId,
            $this->ctx()->role,
            $data['note'] ?? null,
        );

        return response()->json(['ok' => true, 'order' => $this->rowDto($order)]);
    }

    /** POST /api/courses/orders/{id}/reject — refuse the receipt. The reason reaches the learner. */
    public function reject(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course_order.manage');
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);

        $order = $this->orders->reject(
            $this->currentAcademyId(),
            $id,
            trim($data['reason']),
            $this->ctx()->userId,
            $this->ctx()->role,
        );

        return response()->json(['ok' => true, 'order' => $this->rowDto($order)]);
    }

    /** POST /api/courses/orders/{id}/refund — money back; access goes too unless kept explicitly. */
    public function refund(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course_order.manage');
        $data = $request->validate([
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'keep_access' => ['sometimes', 'boolean'],
        ]);

        $order = $this->orders->refund(
            $this->currentAcademyId(),
            $id,
            $data['reason'] ?? null,
            (bool) ($data['keep_access'] ?? false),
            $this->ctx()->userId,
            $this->ctx()->role,
        );

        return response()->json(['ok' => true, 'order' => $this->rowDto($order)]);
    }

    /** POST /api/courses/orders/{id}/cancel — close out a stale unpaid order. */
    public function cancel(string $id): JsonResponse
    {
        Gate::authorize('course_order.manage');

        $order = $this->orders->cancel(
            $this->currentAcademyId(),
            $id,
            $this->ctx()->userId,
            $this->ctx()->role,
        );

        return response()->json(['ok' => true, 'order' => $this->rowDto($order)]);
    }

    /** POST /api/courses/orders/{id}/status — set the status directly (used by the row menu). */
    public function setStatus(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course_order.manage');
        $data = $request->validate([
            'status' => ['required', Rule::in(self::STATUSES)],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        return match ($data['status']) {
            'PAID' => $this->approve($request, $id),
            'REJECTED' => $this->reject($request, $id),
            'REFUNDED' => $this->refund($request, $id),
            'CANCELLED' => $this->cancel($id),
            default => abort(422, 'That status cannot be set directly.'),
        };
    }

    /** @return array<string,mixed> */
    private function rowDto(object $r): array
    {
        return [
            'id' => (string) $r->id,
            'order_number' => (string) $r->order_number,
            'status' => (string) $r->status,
            'channel' => (string) $r->channel,
            'price_minor' => (int) $r->price_minor,
            'currency' => (string) $r->currency,
            'payment_method_type' => $r->payment_method_type,
            'buyer_name' => $r->buyer_name,
            'buyer_email' => $r->buyer_email,
            'buyer_phone' => $r->buyer_phone,
            'rejection_reason' => $r->rejection_reason,
            'submitted_at' => $this->iso($r->submitted_at),
            'confirmed_at' => $this->iso($r->confirmed_at),
            'created_at' => $this->iso($r->created_at),
            // What was bought (docs/lms/11). `item_*` is the honest name; the `course_*` keys stay,
            // filled from whichever catalogue the order points at, so a screen that has not been
            // taught about books prints a title rather than a blank cell.
            'item_type' => (string) ($r->item_type ?? 'COURSE'),
            'item_id' => (string) ($r->product_id ?? $r->course_id ?? ''),
            'item_title' => $r->item_title ?? null,
            'item_slug' => $r->item_slug ?? null,
            'course_id' => (string) ($r->course_id ?? ''),
            'product_id' => isset($r->product_id) ? (string) $r->product_id : null,
            'course_title' => $r->item_title ?? null,
            'course_slug' => $r->item_slug ?? null,
            'learner_id' => isset($r->learner_id) ? (string) $r->learner_id : null,
            'learner_status' => $r->learner_status ?? null,
            'receipt_count' => isset($r->receipt_count) ? (int) $r->receipt_count : null,
        ];
    }
}
