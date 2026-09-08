<?php

declare(strict_types=1);

namespace App\Services\Lms;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The order state machine (docs/lms/10 §2) — the ONE place a `course_orders.status` is written.
 *
 * Two surfaces drive it: the learner site (place an order, attach a receipt, cancel) and the
 * client's sales dashboard (approve, reject, refund, cancel). Both go through here so the rules that
 * matter — an order grants access in the same transaction it becomes PAID, a rejection always
 * carries a reason, a refund pulls access unless the client says otherwise — cannot drift between
 * them.
 *
 * An order is over an ITEM, and there are two kinds (docs/lms/11): a COURSE, whose access is an
 * `enrollments` row, and a digital PRODUCT — a book or PDF — whose access is a
 * `product_entitlements` row. Everything between placing and deciding is identical, which is the
 * whole reason products reuse this class instead of growing a second sales desk: one queue, one
 * receipt inbox, one order-number sequence. Only {@see grantAccess} and {@see revokeAccess} branch.
 *
 * Everything runs under the caller's tenant context: RLS is the backstop on every write, and the
 * learner routes reach this class inside ResolveAcademyContext's transaction, so the row locks below
 * are real locks and not a best-effort read.
 */
final class CourseOrders
{
    /** Open = the learner still has something to do, or we do. */
    public const OPEN_STATUSES = ['AWAITING_PAYMENT', 'UNDER_REVIEW'];

    /** What an order can be over. The DB enforces the same set plus "exactly one id is set". */
    public const ITEM_TYPES = ['COURSE', 'PRODUCT'];

    /** Staff-side notification types (the shared `notifications` table, category LMS_SALES). */
    private const STAFF_ORDER_PLACED = 'LMS_ORDER_PLACED';

    private const STAFF_RECEIPT_UPLOADED = 'LMS_RECEIPT_UPLOADED';

    // ── Placing an order ────────────────────────────────────────────────────────────────────────

    /**
     * Create (or return) the learner's open order for a course or a digital product.
     *
     * Idempotent by design: a double-click, a back-button, or two tabs all land on the SAME order
     * rather than minting duplicates — the partial unique indexes `course_orders_one_open_course_idx`
     * / `…_product_idx` are the database's half of that promise, this lookup is the friendly half.
     *
     * @param  object  $item  the courses / digital_products row (id, title, slug, price_minor)
     * @param  object  $learner  the learners row / model (id, full_name, email, phone)
     * @param  'COURSE'|'PRODUCT'  $itemType  which table $item came from
     * @return object the course_orders row
     */
    public function place(
        string $academyId,
        object $item,
        object $learner,
        string $currency,
        ?string $paymentMethodId = null,
        string $itemType = 'COURSE',
    ): object {
        $learnerId = (string) ($learner->id ?? $learner->getKey());
        $itemColumn = $this->itemColumn($itemType);

        $existing = DB::table('course_orders')
            ->where('learner_id', $learnerId)
            ->where($itemColumn, $item->id)
            ->whereIn('status', self::OPEN_STATUSES)
            ->first();

        if ($existing !== null) {
            if ($paymentMethodId !== null && $existing->status === 'AWAITING_PAYMENT') {
                $this->setMethod($existing, $paymentMethodId);
                $existing = $this->find((string) $existing->id);
            }

            return $existing;
        }

        $id = (string) Str::uuid();
        $number = (string) DB::selectOne(
            'select app.next_course_order_number(?) as n',
            [$academyId],
        )->n;

        // No explicit choice ⇒ the client's first live account. The checkout screen preselects the
        // same one, and an order with no method attached would strand the buyer at upload time.
        $method = $paymentMethodId === null
            ? $this->defaultMethod()
            : DB::table('lms_payment_methods')
                ->where('id', $paymentMethodId)->where('is_active', true)->first(['id', 'type']);

        DB::table('course_orders')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'order_number' => $number,
            'learner_id' => $learnerId,
            'item_type' => $itemType,
            // Exactly one of these is non-null; the DB's course_orders_item_chk says the same thing.
            'course_id' => $itemType === 'COURSE' ? $item->id : null,
            'product_id' => $itemType === 'PRODUCT' ? $item->id : null,
            'price_minor' => (int) $item->price_minor,
            'currency' => $currency,
            'status' => 'AWAITING_PAYMENT',
            'channel' => 'MANUAL',
            'payment_method_id' => $method?->id,
            'payment_method_type' => $method?->type,
            'buyer_name' => $learner->full_name ?? null,
            'buyer_email' => $learner->email ?? null,
            'buyer_phone' => $learner->phone ?? null,
            'terms_accepted_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $order = $this->find($id);

        $this->notifyStaff($academyId, self::STAFF_ORDER_PLACED, $order, $this->item($order));

        return $order;
    }

    /** Which `course_orders` column holds this item type's id. */
    private function itemColumn(string $itemType): string
    {
        return $itemType === 'PRODUCT' ? 'product_id' : 'course_id';
    }

    /** The client's first live receiving account, or null when they have none. */
    private function defaultMethod(): ?object
    {
        return DB::table('lms_payment_methods')
            ->where('is_active', true)
            ->orderBy('position')
            ->orderBy('type')
            ->first(['id', 'type']);
    }

    /** Point an AWAITING_PAYMENT order at a (still active) receiving account. */
    public function setMethod(object $order, string $paymentMethodId): void
    {
        $method = DB::table('lms_payment_methods')
            ->where('id', $paymentMethodId)
            ->where('is_active', true)
            ->first(['id', 'type']);

        if ($method === null) {
            abort(422, 'That payment method is not available.');
        }

        DB::table('course_orders')->where('id', $order->id)->update([
            'payment_method_id' => $method->id,
            'payment_method_type' => $method->type,
            'updated_at' => now(),
        ]);
    }

    // ── The learner attaches proof ──────────────────────────────────────────────────────────────

    /**
     * Record a transfer receipt and move the order into review.
     *
     * A REJECTED order accepts a new receipt: a blurry screenshot must not cost someone the sale
     * (docs/lms/10 §2). Old receipts are kept, so the review history survives.
     *
     * @param  array<string,mixed>  $data  sender_name, sender_reference, amount_minor, paid_at, note
     */
    public function attachReceipt(string $academyId, object $order, string $filePath, array $data): string
    {
        if (! in_array($order->status, ['AWAITING_PAYMENT', 'UNDER_REVIEW', 'REJECTED'], true)) {
            abort(422, 'This order can no longer accept a payment receipt.');
        }

        $methodId = $data['method_id'] ?? $order->payment_method_id;
        $method = $methodId === null ? null : DB::table('lms_payment_methods')
            ->where('id', $methodId)->first(['id', 'type']);
        // An order placed before the client configured anything, or against a method since deleted,
        // still has to be able to receive proof — fall back rather than refuse the buyer's receipt.
        $method ??= $this->defaultMethod();
        if ($method === null) {
            abort(422, 'This site is not accepting payments right now.');
        }

        $receiptId = (string) Str::uuid();
        DB::table('course_order_receipts')->insert([
            'id' => $receiptId,
            'academy_id' => $academyId,
            'order_id' => $order->id,
            'method_id' => $method->id,
            'method_type' => $method->type,
            'file_path' => $filePath,
            'sender_name' => $data['sender_name'] ?? null,
            'sender_reference' => $data['sender_reference'] ?? null,
            'amount_minor' => $data['amount_minor'] ?? null,
            'paid_at' => $data['paid_at'] ?? null,
            'note' => $data['note'] ?? null,
            'review_status' => 'PENDING',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('course_orders')->where('id', $order->id)->update([
            'status' => 'UNDER_REVIEW',
            'payment_method_id' => $method->id,
            'payment_method_type' => $method->type,
            'submitted_at' => now(),
            'rejection_reason' => null,
            'updated_at' => now(),
        ]);

        $order = $this->find((string) $order->id);
        $item = $this->item($order);

        $this->notifyStaff($academyId, self::STAFF_RECEIPT_UPLOADED, $order, $item);
        $this->notifyLearner($academyId, $order, $item, 'RECEIPT_RECEIVED');

        return $receiptId;
    }

    // ── The client decides ──────────────────────────────────────────────────────────────────────

    /**
     * Approve the order: it becomes PAID and the learner is enrolled — in ONE transaction, so there
     * is never a moment where a paid order has no access.
     *
     * `AWAITING_PAYMENT` is approvable too: cash in hand at the office is a real way to be paid, and
     * forcing the client to fake a receipt upload to record it would be theatre.
     */
    public function approve(string $academyId, string $orderId, ?string $userId, ?string $role, ?string $note = null): object
    {
        return DB::transaction(function () use ($academyId, $orderId, $userId, $role, $note): object {
            $order = $this->lock($orderId);

            if ($order->status === 'PAID') {
                return $order;
            }
            if (! in_array($order->status, ['AWAITING_PAYMENT', 'UNDER_REVIEW', 'REJECTED'], true)) {
                abort(422, 'Only an open order can be approved.');
            }

            DB::table('course_orders')->where('id', $orderId)->update([
                'status' => 'PAID',
                'confirmed_at' => now(),
                'decided_by' => $userId,
                'rejection_reason' => null,
                'staff_note' => $note ?? $order->staff_note,
                'updated_at' => now(),
            ]);

            DB::table('course_order_receipts')
                ->where('order_id', $orderId)
                ->where('review_status', 'PENDING')
                ->update([
                    'review_status' => 'APPROVED',
                    'reviewed_by' => $userId,
                    'reviewed_at' => now(),
                    'updated_at' => now(),
                ]);

            // Access IS the product being sold, so it lands inside the same transaction.
            $this->grantAccess($academyId, $order, $orderId);

            $fresh = $this->find($orderId);
            $item = $this->item($fresh);

            $this->notifyLearner($academyId, $fresh, $item, 'ORDER_APPROVED');
            Audit::log('course_order.approve', 'course_order', $orderId, $academyId, $userId, $role,
                after: [
                    'status' => 'PAID',
                    'price_minor' => (int) $order->price_minor,
                    'item_type' => $item['type'],
                ],
                before: ['status' => $order->status]);

            return $fresh;
        });
    }

    /** Reject the receipt. The reason is mandatory and is shown to the learner verbatim. */
    public function reject(string $academyId, string $orderId, string $reason, ?string $userId, ?string $role): object
    {
        return DB::transaction(function () use ($academyId, $orderId, $reason, $userId, $role): object {
            $order = $this->lock($orderId);

            if (! in_array($order->status, ['AWAITING_PAYMENT', 'UNDER_REVIEW'], true)) {
                abort(422, 'Only an order awaiting review can be rejected.');
            }

            DB::table('course_orders')->where('id', $orderId)->update([
                'status' => 'REJECTED',
                'rejection_reason' => $reason,
                'decided_by' => $userId,
                'updated_at' => now(),
            ]);

            DB::table('course_order_receipts')
                ->where('order_id', $orderId)
                ->where('review_status', 'PENDING')
                ->update([
                    'review_status' => 'REJECTED',
                    'rejection_reason' => $reason,
                    'reviewed_by' => $userId,
                    'reviewed_at' => now(),
                    'updated_at' => now(),
                ]);

            $fresh = $this->find($orderId);

            $this->notifyLearner($academyId, $fresh, $this->item($fresh), 'ORDER_REJECTED', $reason);
            Audit::log('course_order.reject', 'course_order', $orderId, $academyId, $userId, $role,
                after: ['status' => 'REJECTED', 'reason' => $reason],
                before: ['status' => $order->status]);

            return $fresh;
        });
    }

    /**
     * Refund a PAID order. Access is pulled by default — a refund that leaves the course watchable
     * is a giveaway — but `$keepAccess` covers the goodwill case the client explicitly chooses.
     */
    public function refund(
        string $academyId,
        string $orderId,
        ?string $reason,
        bool $keepAccess,
        ?string $userId,
        ?string $role,
    ): object {
        return DB::transaction(function () use ($academyId, $orderId, $reason, $keepAccess, $userId, $role): object {
            $order = $this->lock($orderId);

            if ($order->status !== 'PAID') {
                abort(422, 'Only a paid order can be refunded.');
            }

            DB::table('course_orders')->where('id', $orderId)->update([
                'status' => 'REFUNDED',
                'refunded_at' => now(),
                'refund_reason' => $reason,
                'decided_by' => $userId,
                'updated_at' => now(),
            ]);

            if (! $keepAccess) {
                $this->revokeAccess($order);
            }

            $fresh = $this->find($orderId);

            $this->notifyLearner($academyId, $fresh, $this->item($fresh), 'ORDER_REFUNDED', $reason);
            Audit::log('course_order.refund', 'course_order', $orderId, $academyId, $userId, $role,
                after: ['status' => 'REFUNDED', 'kept_access' => $keepAccess, 'reason' => $reason],
                before: ['status' => 'PAID']);

            return $fresh;
        });
    }

    /** Cancel an open order — the learner's own out, or a staff cleanup of a stale unpaid order. */
    public function cancel(string $academyId, string $orderId, ?string $userId, ?string $role, bool $byLearner = false): object
    {
        return DB::transaction(function () use ($academyId, $orderId, $userId, $role, $byLearner): object {
            $order = $this->lock($orderId);

            if (! in_array($order->status, self::OPEN_STATUSES, true)) {
                abort(422, 'Only an open order can be cancelled.');
            }

            DB::table('course_orders')->where('id', $orderId)->update([
                'status' => 'CANCELLED',
                'decided_by' => $byLearner ? null : $userId,
                'updated_at' => now(),
            ]);

            Audit::log('course_order.cancel', 'course_order', $orderId, $academyId, $userId, $role,
                after: ['status' => 'CANCELLED', 'by' => $byLearner ? 'learner' : 'staff'],
                before: ['status' => $order->status]);

            return $this->find($orderId);
        });
    }

    // ── Reads ───────────────────────────────────────────────────────────────────────────────────

    /** The order row, or 404. RLS already scopes it to the academy. */
    public function find(string $orderId): object
    {
        $order = DB::table('course_orders')->where('id', $orderId)->first();
        if ($order === null) {
            abort(404, 'Order not found.');
        }

        return $order;
    }

    private function lock(string $orderId): object
    {
        $order = DB::table('course_orders')->where('id', $orderId)->lockForUpdate()->first();
        if ($order === null) {
            abort(404, 'Order not found.');
        }

        return $order;
    }

    /**
     * What this order is over, in the ONE shape every notification and audit line needs.
     *
     * Reading it back from the order (rather than being handed the row) is deliberate: the caller
     * should never have to remember which of the two id columns is populated, and a deleted course
     * or product still has to produce a printable order rather than a null-dereference.
     *
     * @return array{type: string, id: string, title: string, slug: string}
     */
    private function item(object $order): array
    {
        $type = (string) ($order->item_type ?? 'COURSE');
        $id = (string) ($type === 'PRODUCT' ? ($order->product_id ?? '') : ($order->course_id ?? ''));
        $table = $type === 'PRODUCT' ? 'digital_products' : 'courses';

        $row = $id === '' ? null : DB::table($table)->where('id', $id)->first(['title', 'slug']);

        return [
            'type' => $type,
            'id' => $id,
            'title' => (string) ($row->title ?? ''),
            'slug' => (string) ($row->slug ?? ''),
        ];
    }

    // ── Access (docs/lms/11) ────────────────────────────────────────────────────────────────────

    /**
     * Give the buyer what they paid for. `updateOrInsert` on both sides so re-approving a refunded
     * order — or a learner whose access was once revoked — RESTORES it rather than colliding on the
     * unique (learner, item) index.
     */
    private function grantAccess(string $academyId, object $order, string $orderId): void
    {
        if ((string) ($order->item_type ?? 'COURSE') === 'PRODUCT') {
            DB::table('product_entitlements')->updateOrInsert(
                ['learner_id' => $order->learner_id, 'product_id' => $order->product_id],
                [
                    'academy_id' => $academyId,
                    'source_order_id' => $orderId,
                    'status' => 'ACTIVE',
                    'granted_at' => now(),
                ],
            );

            return;
        }

        DB::table('enrollments')->updateOrInsert(
            ['learner_id' => $order->learner_id, 'course_id' => $order->course_id],
            [
                'academy_id' => $academyId,
                'source_order_id' => $orderId,
                'status' => 'ACTIVE',
                'enrolled_at' => now(),
            ],
        );
    }

    /** Pull it back on a refund. REVOKED, not deleted — the history of who once owned what survives. */
    private function revokeAccess(object $order): void
    {
        if ((string) ($order->item_type ?? 'COURSE') === 'PRODUCT') {
            DB::table('product_entitlements')
                ->where('learner_id', $order->learner_id)
                ->where('product_id', $order->product_id)
                ->update(['status' => 'REVOKED']);

            return;
        }

        DB::table('enrollments')
            ->where('learner_id', $order->learner_id)
            ->where('course_id', $order->course_id)
            ->update(['status' => 'REVOKED']);
    }

    // ── Notifications (docs/lms/10 §5) ──────────────────────────────────────────────────────────

    /**
     * An owner-facing alert on the existing Notifications page. Deduped per (order, type) by
     * `notifications_subject_type_idx`, so a re-uploaded receipt UPDATES the existing row and clears
     * `read_at` — the alert resurfaces instead of being swallowed by the unique index.
     */
    private function notifyStaff(string $academyId, string $type, object $order, array $item): void
    {
        DB::table('notifications')->updateOrInsert(
            ['subject_id' => $order->id, 'type' => $type],
            [
                'academy_id' => $academyId,
                'category' => 'LMS_SALES',
                'audience_role' => 'ACADEMY_OWNER',
                'data' => json_encode([
                    'order_id' => (string) $order->id,
                    'order_number' => (string) $order->order_number,
                    'item_type' => $item['type'],
                    'item_title' => $item['title'],
                    // Kept under the original keys as well: the Notifications page (and any stored
                    // row written before books existed) reads `course_title`, and a book order that
                    // rendered as a blank line would be a silent regression.
                    'course_id' => $item['id'],
                    'course_title' => $item['title'],
                    'buyer_name' => $order->buyer_name,
                    'buyer_email' => $order->buyer_email,
                    'buyer_phone' => $order->buyer_phone,
                    'price_minor' => (int) $order->price_minor,
                    'currency' => (string) $order->currency,
                    'method' => $order->payment_method_type,
                ], JSON_UNESCAPED_UNICODE),
                'read_at' => null,
                'created_at' => now(),
            ],
        );
    }

    /**
     * A learner-facing alert. The copy is stored, not keyed: the learner site has no session locale
     * at write time, and a bilingual client writes rejection reasons in whichever language they
     * speak — so the row carries the words and the site renders them as-is.
     */
    private function notifyLearner(
        string $academyId,
        object $order,
        array $item,
        string $type,
        ?string $reason = null,
    ): void {
        $isProduct = $item['type'] === 'PRODUCT';
        $title = match ($type) {
            'RECEIPT_RECEIVED' => 'We received your transfer receipt',
            // The one line where course and book genuinely differ: "unlocked" is what happens to a
            // course, "ready to download" is what happens to a book.
            'ORDER_APPROVED' => $isProduct
                ? 'Your download is ready'
                : 'Your course is now unlocked',
            'ORDER_REJECTED' => 'We could not confirm your payment',
            'ORDER_REFUNDED' => 'Your order was refunded',
            default => 'Order update',
        };

        DB::table('learner_notifications')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'learner_id' => $order->learner_id,
            'type' => $type,
            'title' => $title,
            'body' => $reason,
            'data' => json_encode([
                'order_id' => (string) $order->id,
                'order_number' => (string) $order->order_number,
                'item_type' => $item['type'],
                // Same keys either way, so the learner site's alert list needs no branch to print
                // "what this was about" — only the deep link cares which surface it points at.
                'course_title' => $item['title'],
                'course_slug' => $item['slug'],
                'reason' => $reason,
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
        ]);
    }

    /** ISO-8601 UTC (or null) — the timestamp shape both clients expect. */
    public static function iso(mixed $value): ?string
    {
        return $value === null ? null : Carbon::parse($value)->utc()->toIso8601String();
    }
}
