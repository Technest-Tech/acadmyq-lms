<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * LMS phase 5 — orders, checkout and manual payments (docs/lms/10).
 *
 * What these tests are actually protecting:
 *  - **PAID is the only state that enrolls**, and it enrolls in the same transaction. There is never
 *    a paid order without access, or access without a paid order.
 *  - **One open order per learner+course.** A double-click cannot mint two pending purchases.
 *  - **Price is snapshotted.** Raising the price mid-review does not change what the buyer owes.
 *  - **The channel switches are real.** `checkout_enabled` off blocks checkout; `code_enabled` off
 *    stops honouring a code that was minted while it was on.
 *  - **A receipt is private.** It is streamed through a capability gate, never a public URL.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // `entitled:lms` 402s without a plan that grants the module — the trap every LMS suite hits.
    DB::table('plans')->where('code', 'LMS_BASIC')->value('id');

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: [
        'client_type' => 'LMS',
        'subdomain' => 'shop',
        'default_currency' => 'EGP',
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);

    // A priced, published course.
    $courseId = $this->postJson('/api/courses', [
        'title' => 'Chemistry 101',
        'price_minor' => 75000,
    ])->assertCreated()->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'Unit 1'])->json('sectionId');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Lesson', 'body' => 'Body',
    ])->assertCreated();
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    $this->courseId = $courseId;
    $this->slug = $this->getJson("/api/courses/{$courseId}")->json('course.slug');

    // One live receiving account — without it the course does not sell online at all.
    $this->putJson('/api/courses/payment-methods', [
        'methods' => [[
            'type' => 'INSTAPAY',
            'account_number' => 'noor@instapay',
            'account_name' => 'Noor Academy',
            'is_active' => true,
        ]],
    ])->assertOk();

    app()['auth']->forgetGuards();

    // A registered learner on the public site.
    $this->learnerToken = $this->withHeaders(['X-Academy' => 'shop'])
        ->postJson('/api/learn/auth/register', [
            'full_name' => 'Mariam Ali',
            'email' => 'mariam@example.com',
            'password' => 'password123',
            'phone' => '+201000000001',
        ])->assertCreated()->json('token');
});

/** Learner request headers: the subdomain handle + the bearer token. */
function shopHeaders(?string $token = null, string $sub = 'shop'): array
{
    $h = ['X-Academy' => $sub];
    if ($token !== null) {
        $h['Authorization'] = "Bearer {$token}";
    }

    return $h;
}

/** Place an order as the signed-in learner and return its number. */
function placeOrder(mixed $test, string $slug): string
{
    return $test->withHeaders(shopHeaders($test->learnerToken))
        ->postJson("/api/learn/courses/{$slug}/orders", ['accept_terms' => true])
        ->assertCreated()
        ->json('order.order_number');
}

// ── the sales page tells the truth about how a course can be bought ──────────

it('advertises a course as sellable only when checkout is on AND a method is live', function () {
    $public = $this->withHeaders(shopHeaders())
        ->getJson("/api/learn/courses/{$this->slug}")->assertOk();

    $public->assertJsonPath('course.sells_online', true)
        ->assertJsonPath('course.code_enabled', true);

    // Switch every receiving account off: the Buy button must disappear even though the course's
    // own flag is untouched — a checkout with nowhere to pay is worse than no button.
    Sanctum::actingAs($this->owner);
    $this->putJson('/api/courses/payment-methods', [
        'methods' => [['type' => 'INSTAPAY', 'account_number' => 'noor@instapay', 'is_active' => false]],
    ])->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(shopHeaders())
        ->getJson("/api/learn/courses/{$this->slug}")
        ->assertJsonPath('course.sells_online', false);
});

it('refuses to switch on a payment method with no account number', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/courses/payment-methods', [
        'methods' => [['type' => 'VODAFONE_CASH', 'account_number' => '', 'is_active' => true]],
    ])->assertStatus(422);
});

// ── placing an order ─────────────────────────────────────────────────────────

it('places an order with a human-quotable number, a price snapshot and recorded consent', function () {
    $body = $this->withHeaders(shopHeaders($this->learnerToken))
        ->postJson("/api/learn/courses/{$this->slug}/orders", ['accept_terms' => true])
        ->assertCreated()->json('order');

    expect($body['order_number'])->toStartWith('ORD-')
        ->and($body['status'])->toBe('AWAITING_PAYMENT')
        ->and($body['price_minor'])->toBe(75000)
        ->and($body['currency'])->toBe('EGP');

    $this->asAcademy($this->academy);
    $row = DB::table('course_orders')->first();
    expect($row->terms_accepted_at)->not->toBeNull()
        ->and($row->buyer_email)->toBe('mariam@example.com');
});

it('will not place an order without consent to the terms', function () {
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->postJson("/api/learn/courses/{$this->slug}/orders", [])
        ->assertStatus(422);
});

it('returns the SAME open order on a second attempt instead of a duplicate', function () {
    $first = placeOrder($this, $this->slug);
    $second = $this->withHeaders(shopHeaders($this->learnerToken))
        ->postJson("/api/learn/courses/{$this->slug}/orders", ['accept_terms' => true])
        ->assertCreated()->json('order.order_number');

    expect($second)->toBe($first);

    $this->asAcademy($this->academy);
    expect(DB::table('course_orders')->count())->toBe(1);
});

it('keeps the price the buyer agreed to when the owner raises it mid-review', function () {
    $number = placeOrder($this, $this->slug);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/courses/{$this->courseId}", ['price_minor' => 120000])->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->getJson("/api/learn/orders/{$number}")
        ->assertOk()
        ->assertJsonPath('order.price_minor', 75000);
});

it('refuses checkout for a free course and for a course not sold online', function () {
    Sanctum::actingAs($this->owner);
    $freeId = $this->postJson('/api/courses', ['title' => 'Free intro', 'price_minor' => 0])->json('courseId');
    $sec = $this->postJson("/api/courses/{$freeId}/sections", ['title' => 'S'])->json('sectionId');
    $this->postJson("/api/courses/{$freeId}/lessons", [
        'section_id' => $sec, 'type' => 'TEXT', 'title' => 'L', 'body' => 'B',
    ]);
    $this->postJson("/api/courses/{$freeId}/publish", ['status' => 'PUBLISHED']);
    $freeSlug = $this->getJson("/api/courses/{$freeId}")->json('course.slug');

    // And a priced course whose owner turned checkout off.
    $this->patchJson("/api/courses/{$this->courseId}", ['checkout_enabled' => false])->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->postJson("/api/learn/courses/{$freeSlug}/orders", ['accept_terms' => true])
        ->assertStatus(422);

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->postJson("/api/learn/courses/{$this->slug}/orders", ['accept_terms' => true])
        ->assertStatus(422);
});

// ── receipts ─────────────────────────────────────────────────────────────────

it('accepts a receipt, moves the order into review, and keeps the file private', function () {
    Storage::fake('local');
    $number = placeOrder($this, $this->slug);

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", [
            'receipt' => UploadedFile::fake()->image('transfer.jpg'),
            'sender_reference' => 'TX-9931',
        ])
        ->assertCreated()
        ->assertJsonPath('order.status', 'UNDER_REVIEW');

    $this->asAcademy($this->academy);
    $receipt = DB::table('course_order_receipts')->first();
    expect($receipt->review_status)->toBe('PENDING')
        ->and($receipt->file_path)->toStartWith('lms-order-receipts/');
    // The stored value is a KEY, never a url a browser could fetch directly.
    expect($receipt->file_path)->not->toContain('http');
});

it('notifies the client of the order and of the receipt, and the learner of the receipt', function () {
    Storage::fake('local');
    $number = placeOrder($this, $this->slug);

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", [
            'receipt' => UploadedFile::fake()->image('t.jpg'),
        ])->assertCreated();

    $this->asAcademy($this->academy);
    $types = DB::table('notifications')->where('category', 'LMS_SALES')->pluck('type');
    expect($types)->toContain('LMS_ORDER_PLACED')->toContain('LMS_RECEIPT_UPLOADED');

    expect(DB::table('learner_notifications')->where('type', 'RECEIPT_RECEIVED')->count())->toBe(1);
});

// ── the client decides ───────────────────────────────────────────────────────

it('enrolls the learner the moment the order is approved', function () {
    Storage::fake('local');
    $number = placeOrder($this, $this->slug);
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", ['receipt' => UploadedFile::fake()->image('t.jpg')]);

    // Before: the player is shut.
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->getJson("/api/learn/courses/{$this->slug}/content")
        ->assertForbidden();

    Sanctum::actingAs($this->owner);
    $orderId = $this->getJson('/api/courses/orders')->assertOk()->json('rows.0.id');
    $this->postJson("/api/courses/orders/{$orderId}/approve")
        ->assertOk()
        ->assertJsonPath('order.status', 'PAID');
    app()['auth']->forgetGuards();

    // After: enrolled, and the enrollment says WHERE the access came from.
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->getJson("/api/learn/courses/{$this->slug}/content")
        ->assertOk();

    $this->asAcademy($this->academy);
    $enrollment = DB::table('enrollments')->first();
    expect($enrollment->status)->toBe('ACTIVE')
        ->and((string) $enrollment->source_order_id)->toBe($orderId)
        ->and($enrollment->source_code_id)->toBeNull();

    expect(DB::table('learner_notifications')->where('type', 'ORDER_APPROVED')->count())->toBe(1);
});

it('rejects with a reason the learner can read, and lets them try again', function () {
    Storage::fake('local');
    $number = placeOrder($this, $this->slug);
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", ['receipt' => UploadedFile::fake()->image('t.jpg')]);

    Sanctum::actingAs($this->owner);
    $orderId = $this->getJson('/api/courses/orders')->json('rows.0.id');

    // A rejection with no reason is refused: the reason IS the notification.
    $this->postJson("/api/courses/orders/{$orderId}/reject", [])->assertStatus(422);

    $this->postJson("/api/courses/orders/{$orderId}/reject", ['reason' => 'The amount does not match.'])
        ->assertOk()
        ->assertJsonPath('order.status', 'REJECTED');
    app()['auth']->forgetGuards();

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->getJson("/api/learn/orders/{$number}")
        ->assertOk()
        ->assertJsonPath('order.rejection_reason', 'The amount does not match.');

    // REJECTED is not terminal — a corrected receipt puts it straight back in the queue.
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", ['receipt' => UploadedFile::fake()->image('fixed.jpg')])
        ->assertCreated()
        ->assertJsonPath('order.status', 'UNDER_REVIEW');
});

it('pulls access on refund unless the client keeps it', function () {
    Storage::fake('local');
    $number = placeOrder($this, $this->slug);

    Sanctum::actingAs($this->owner);
    $orderId = $this->getJson('/api/courses/orders')->json('rows.0.id');
    $this->postJson("/api/courses/orders/{$orderId}/approve")->assertOk();
    $this->postJson("/api/courses/orders/{$orderId}/refund", ['reason' => 'Changed their mind'])
        ->assertOk()
        ->assertJsonPath('order.status', 'REFUNDED');
    app()['auth']->forgetGuards();

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->getJson("/api/learn/courses/{$this->slug}/content")
        ->assertForbidden();
});

// ── the sales desk ───────────────────────────────────────────────────────────

it('reports revenue from PAID orders only and counts the receipts still to review', function () {
    Storage::fake('local');
    $number = placeOrder($this, $this->slug);
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", ['receipt' => UploadedFile::fake()->image('t.jpg')]);

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/courses/orders/summary')
        ->assertOk()
        ->assertJsonPath('stats.revenue_minor', 0)
        ->assertJsonPath('stats.pending_receipts', 1)
        ->assertJsonPath('stats.under_review', 1);

    $orderId = $this->getJson('/api/courses/orders')->json('rows.0.id');
    $this->postJson("/api/courses/orders/{$orderId}/approve")->assertOk();

    $this->getJson('/api/courses/orders/summary')
        ->assertOk()
        ->assertJsonPath('stats.revenue_minor', 75000)
        ->assertJsonPath('stats.pending_receipts', 0)
        ->assertJsonPath('by_course.0.revenue_minor', 75000);
});

it('streams a receipt only to staff who may read orders', function () {
    Storage::fake('local');
    $number = placeOrder($this, $this->slug);
    $this->withHeaders(shopHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", ['receipt' => UploadedFile::fake()->image('t.jpg')]);

    Sanctum::actingAs($this->owner);
    $orderId = $this->getJson('/api/courses/orders')->json('rows.0.id');
    $receiptId = $this->getJson("/api/courses/orders/{$orderId}")->json('receipts.0.id');
    $this->get("/api/courses/orders/{$orderId}/receipts/{$receiptId}/file")->assertOk();

    // A teacher holds none of the sales capabilities.
    $teacher = $this->makeUser($this->academy, 'TEACHER');
    Sanctum::actingAs($teacher);
    $this->getJson('/api/courses/orders')->assertForbidden();
    $this->get("/api/courses/orders/{$orderId}/receipts/{$receiptId}/file")->assertForbidden();
});

it('cannot see another academy\'s orders', function () {
    placeOrder($this, $this->slug);

    $other = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'rival']);
    $rival = $this->makeUser($other, 'ACADEMY_OWNER');

    Sanctum::actingAs($rival);
    $this->getJson('/api/courses/orders')->assertOk()->assertJsonPath('total', 0);
});

// ── codes stay, and stay optional ────────────────────────────────────────────

it('stops honouring a code once the course turns codes off', function () {
    Sanctum::actingAs($this->owner);
    $code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$this->courseId], 'count' => 1, 'max_redemptions' => 1,
    ])->assertCreated()->json('codes.0.code');

    $this->patchJson("/api/courses/{$this->courseId}", ['code_enabled' => false])->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->postJson('/api/learn/redeem', ['code' => $code])
        ->assertStatus(422);
});

it('still lets a code unlock a course that is ALSO sold online', function () {
    Sanctum::actingAs($this->owner);
    $code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$this->courseId], 'count' => 1, 'max_redemptions' => 1,
    ])->assertCreated()->json('codes.0.code');
    app()['auth']->forgetGuards();

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->postJson('/api/learn/redeem', ['code' => $code])
        ->assertOk();

    $this->withHeaders(shopHeaders($this->learnerToken))
        ->getJson("/api/learn/courses/{$this->slug}/content")
        ->assertOk();
});
