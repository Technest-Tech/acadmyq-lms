<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Services\Lms\CourseOrders;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Checkout on the learner site (docs/lms/10 §3) — the «اشترِ الكورس» path that replaced «اطلب كود»
 * as the main way to buy.
 *
 * The flow the endpoints below serve, in order: open the checkout (course + price + the client's
 * receiving accounts) → place the order → transfer the money outside the app → upload the receipt →
 * watch the order's status page until the client approves it, at which point the enrollment already
 * exists and the course simply opens.
 *
 * Codes are NOT replaced. A course whose `code_enabled` is on still shows "I have a code" and
 * `RedemptionController` still grants access without any of this.
 *
 * Everything is `learner.auth`-gated: you buy as somebody. The academy comes from the subdomain
 * (ResolveAcademyContext) and RLS scopes every row to it.
 */
final class CheckoutController extends Controller
{
    use InteractsWithLearner;

    /** A receipt is a phone screenshot or a bank PDF — 8 MB is generous for both. */
    private const MAX_RECEIPT_KB = 8192;

    public function __construct(private readonly CourseOrders $orders) {}

    /**
     * GET /api/learn/checkout/{slug} — everything the checkout screen renders: the course being
     * bought, the price, the client's active receiving accounts, and the learner's open order if
     * they already started one.
     */
    public function show(string $slug): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $course = $this->sellableCourse($slug);
        $learner = $this->learner();

        if ($this->isEnrolled((string) $course->id)) {
            return response()->json([
                'already_enrolled' => true,
                'course' => $this->courseDto($course),
            ]);
        }

        $open = DB::table('course_orders')
            ->where('learner_id', $learner->getKey())
            ->where('course_id', $course->id)
            ->whereIn('status', CourseOrders::OPEN_STATUSES)
            ->first();

        return response()->json([
            'already_enrolled' => false,
            'course' => $this->courseDto($course),
            'currency' => $this->academyCurrency($academyId),
            'payment_methods' => $this->activeMethods(),
            'open_order' => $open === null ? null : $this->orderDto($open),
            'buyer' => [
                'full_name' => $learner->full_name,
                'email' => $learner->email,
                'phone' => $learner->phone,
            ],
        ]);
    }

    /**
     * POST /api/learn/courses/{slug}/orders — place the order.
     *
     * Consent is a precondition, not a checkbox we hope was ticked: no `accept_terms`, no order
     * (docs/lms/10 §3), and the acceptance timestamp is stored on the row.
     */
    public function store(Request $request, string $slug): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $learner = $this->learner();
        $course = $this->sellableCourse($slug);

        $data = $request->validate([
            'payment_method_id' => ['sometimes', 'nullable', 'uuid'],
            'accept_terms' => ['accepted'],
        ]);

        if ($this->isEnrolled((string) $course->id)) {
            return response()->json([
                'ok' => false,
                'reason' => 'already_enrolled',
                'message' => 'You already have access to this course.',
            ], 409);
        }

        if ($this->activeMethods() === []) {
            abort(422, 'This course site is not accepting online orders right now.');
        }

        $order = $this->orders->place(
            $academyId,
            $course,
            $learner,
            $this->academyCurrency($academyId),
            $data['payment_method_id'] ?? null,
        );

        return response()->json([
            'ok' => true,
            'order' => $this->orderDto($order),
        ], 201);
    }

    /** GET /api/learn/orders — the learner's own order history. */
    public function index(): JsonResponse
    {
        $this->currentAcademyId();
        $learner = $this->learner();

        $rows = DB::table('course_orders as o')
            ->join('courses as c', 'c.id', '=', 'o.course_id')
            ->where('o.learner_id', $learner->getKey())
            ->orderByDesc('o.created_at')
            ->limit(100)
            ->get([
                'o.*',
                'c.title as course_title',
                'c.slug as course_slug',
                'c.cover_image_path as course_cover',
            ]);

        return response()->json([
            'orders' => $rows->map(fn (object $o): array => $this->orderDto($o)),
        ]);
    }

    /** GET /api/learn/orders/{number} — one order + how to pay it + what has been submitted. */
    public function showOrder(string $number): JsonResponse
    {
        $this->currentAcademyId();
        $order = $this->ownOrder($number);

        $course = DB::table('courses')->where('id', $order->course_id)
            ->first(['id', 'title', 'slug', 'cover_image_path', 'price_minor']);

        $receipts = DB::table('course_order_receipts')
            ->where('order_id', $order->id)
            ->orderByDesc('created_at')
            ->get(['id', 'method_type', 'sender_name', 'sender_reference', 'amount_minor',
                'paid_at', 'note', 'review_status', 'rejection_reason', 'created_at'])
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
                'created_at' => $this->iso($r->created_at),
            ]);

        return response()->json([
            'order' => $this->orderDto($order),
            'course' => $course === null ? null : $this->courseDto($course),
            'receipts' => $receipts,
            // Only an order that still needs paying shows account numbers.
            'payment_methods' => in_array($order->status, ['AWAITING_PAYMENT', 'UNDER_REVIEW', 'REJECTED'], true)
                ? $this->activeMethods()
                : [],
        ]);
    }

    /** POST /api/learn/orders/{number}/method — switch the receiving account before paying. */
    public function chooseMethod(Request $request, string $number): JsonResponse
    {
        $this->currentAcademyId();
        $order = $this->ownOrder($number);

        $data = $request->validate(['payment_method_id' => ['required', 'uuid']]);

        if (! in_array($order->status, ['AWAITING_PAYMENT', 'REJECTED'], true)) {
            abort(422, 'This order is already being reviewed.');
        }

        $this->orders->setMethod($order, $data['payment_method_id']);

        return response()->json(['ok' => true, 'order' => $this->orderDto($this->orders->find((string) $order->id))]);
    }

    /**
     * POST /api/learn/orders/{number}/receipt — upload the transfer proof.
     *
     * The file goes to the PRIVATE disk; only its key is stored. Staff read it back through a
     * capability-gated stream, never a public URL (docs/lms/10 §2).
     */
    public function uploadReceipt(Request $request, string $number): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $order = $this->ownOrder($number);

        $data = $request->validate([
            'receipt' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,heic,pdf', 'max:'.self::MAX_RECEIPT_KB],
            'payment_method_id' => ['sometimes', 'nullable', 'uuid'],
            'sender_name' => ['sometimes', 'nullable', 'string', 'max:200'],
            'sender_reference' => ['sometimes', 'nullable', 'string', 'max:120'],
            'amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'paid_at' => ['sometimes', 'nullable', 'date'],
            'note' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        $file = $request->file('receipt');
        $ext = $file->extension() ?: 'jpg';
        $dir = 'lms-order-receipts/'.substr(preg_replace('/[^A-Za-z0-9]/', '', $academyId) ?? '', 0, 12);
        $path = $file->storeAs($dir, (string) Str::uuid().'.'.$ext, 'local');

        $this->orders->attachReceipt($academyId, $order, $path, [
            'method_id' => $data['payment_method_id'] ?? null,
            'sender_name' => $data['sender_name'] ?? null,
            'sender_reference' => $data['sender_reference'] ?? null,
            'amount_minor' => $data['amount_minor'] ?? null,
            'paid_at' => $data['paid_at'] ?? null,
            'note' => $data['note'] ?? null,
        ]);

        return response()->json([
            'ok' => true,
            'order' => $this->orderDto($this->orders->find((string) $order->id)),
        ], 201);
    }

    /** POST /api/learn/orders/{number}/cancel — the learner's own out. */
    public function cancel(string $number): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $order = $this->ownOrder($number);

        $this->orders->cancel($academyId, (string) $order->id, null, 'LEARNER', byLearner: true);

        return response()->json(['ok' => true]);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    /**
     * A published course that can actually be bought right now. Every refusal is separate on
     * purpose: "not for sale" and "free, just click enroll" are different answers, and a checkout
     * that silently 404s on a free course would look like a bug to the buyer.
     */
    private function sellableCourse(string $slug): object
    {
        $course = DB::table('courses')
            ->where('slug', $slug)
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at')
            ->first(['id', 'title', 'slug', 'subtitle', 'cover_image_path', 'price_minor',
                'checkout_enabled', 'code_enabled']);

        if ($course === null) {
            abort(404, 'Course not found.');
        }
        if ((int) $course->price_minor === 0) {
            abort(422, 'This course is free — no payment is needed.');
        }
        if (! $course->checkout_enabled) {
            abort(422, 'This course is not sold online.');
        }

        return $course;
    }

    /** The learner's OWN order, addressed by its human-quotable number. */
    private function ownOrder(string $number): object
    {
        $order = DB::table('course_orders')
            ->where('order_number', $number)
            ->where('learner_id', $this->learner()->getKey())
            ->first();

        if ($order === null) {
            abort(404, 'Order not found.');
        }

        return $order;
    }

    /**
     * The client's active receiving accounts. Account numbers only ever leave the API on this
     * signed-in path — the public catalog never carries them.
     *
     * @return list<array<string,mixed>>
     */
    private function activeMethods(): array
    {
        return DB::table('lms_payment_methods')
            ->where('is_active', true)
            ->orderBy('position')
            ->orderBy('type')
            ->get(['id', 'type', 'label', 'account_name', 'account_number', 'bank_name', 'instructions'])
            ->map(fn (object $m): array => [
                'id' => (string) $m->id,
                'type' => (string) $m->type,
                'label' => $m->label,
                'account_name' => $m->account_name,
                'account_number' => $m->account_number,
                'bank_name' => $m->bank_name,
                'instructions' => $m->instructions,
            ])
            ->all();
    }

    /** @return array<string,mixed> */
    private function courseDto(object $c): array
    {
        return [
            'id' => (string) $c->id,
            'title' => (string) $c->title,
            'slug' => (string) $c->slug,
            'subtitle' => $c->subtitle ?? null,
            'cover_image_path' => LmsMedia::coverUrl($c->cover_image_path ?? null),
            'price_minor' => (int) ($c->price_minor ?? 0),
        ];
    }

    /** @return array<string,mixed> */
    private function orderDto(object $o): array
    {
        return [
            'id' => (string) $o->id,
            'order_number' => (string) $o->order_number,
            'status' => (string) $o->status,
            'price_minor' => (int) $o->price_minor,
            'currency' => (string) $o->currency,
            'channel' => (string) $o->channel,
            'payment_method_id' => $o->payment_method_id === null ? null : (string) $o->payment_method_id,
            'payment_method_type' => $o->payment_method_type,
            'rejection_reason' => $o->rejection_reason,
            'refund_reason' => $o->refund_reason ?? null,
            'submitted_at' => $this->iso($o->submitted_at),
            'confirmed_at' => $this->iso($o->confirmed_at),
            'created_at' => $this->iso($o->created_at),
            'course_title' => $o->course_title ?? null,
            'course_slug' => $o->course_slug ?? null,
            'course_cover' => isset($o->course_cover) ? LmsMedia::coverUrl($o->course_cover) : null,
        ];
    }
}
