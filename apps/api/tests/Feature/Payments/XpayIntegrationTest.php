<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

const SK = 'sk_test_abcdefghij1234';
const WHSEC = 'whsec_topsecret9876';

/**
 * Set the RLS GUCs directly. Pest's top-level helper functions run in global scope and so cannot
 * reach InteractsWithTenancy's protected methods; the existing PublicAcademyPaymentTest solves it
 * the same way.
 */
function xpayContext(?string $academyId, ?string $role = 'ACADEMY_OWNER'): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId ?? '']);
    DB::statement("select set_config('app.current_role', ?, true)", [$academyId === null ? '' : $role]);
    DB::statement("select set_config('app.current_user_id', '', true)");
}

/** Provision XPay for an academy the way the Super Admin endpoint does, without going through it. */
function provisionXpay(object $test, string $academyId, bool $active = true): void
{
    xpayContext($academyId);
    DB::table('academy_xpay_credentials')->insert([
        'academy_id' => $academyId,
        'mode' => 'test',
        'publishable_key' => 'pk_test_pub123',
        'secret_key_enc' => Crypt::encryptString(SK),
        'webhook_secret_enc' => Crypt::encryptString(WHSEC),
        'secret_last4' => '1234',
        'webhook_last4' => '9876',
    ]);
    DB::table('academy_payment_settings')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'method' => 'XPAY',
        'is_active' => $active,
        'config' => json_encode(['publishable_key' => 'pk_test_pub123', 'mode' => 'test']),
    ]);
    xpayContext(null);
}

/** An XPay Checkout Session object as the API and the webhook both render it. */
function xpaySession(string $id, string $invoiceId, string $academyId, int $amount, array $overrides = []): array
{
    return array_merge([
        'id' => $id,
        'object' => 'checkout.session',
        'status' => 'complete',
        'paymentStatus' => 'paid',
        'currency' => 'EGP',
        'amountTotal' => $amount,
        'url' => 'https://checkout.xpay.app/c/'.$id,
        'metadata' => [
            'invoice_id' => $invoiceId,
            'academy_id' => $academyId,
            'public_token' => 'tok',
        ],
    ], $overrides);
}

/** Sign a webhook body the way XPay does: HMAC-SHA256 over "{t}.{rawBody}". */
function xpaySignature(string $body, string $secret = WHSEC, ?int $timestamp = null): string
{
    $t = $timestamp ?? time();

    return 't='.$t.',v1='.hash_hmac('sha256', $t.'.'.$body, $secret);
}

/** POST a webhook with a correctly-formed signature header. */
function postWebhook(object $test, string $academyId, array $event, ?string $signature = null)
{
    $body = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    return $test->call(
        'POST',
        "/api/webhooks/xpay/{$academyId}",
        [],
        [],
        [],
        [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_XPAY_SIGNATURE' => $signature ?? xpaySignature($body),
        ],
        $body,
    );
}

// ── Super Admin provisioning ────────────────────────────────────────────────

it('stores the keys encrypted and never hands them back', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true,
        'mode' => 'test',
        'test' => [
            'publishable_key' => 'pk_test_pub123',
            'secret_key' => SK,
            'webhook_secret' => WHSEC,
        ],
    ])->assertOk();

    // At rest: ciphertext, never the key itself.
    $this->asAcademy($academyId);
    $row = DB::table('academy_xpay_credentials')->where('academy_id', $academyId)->where('mode', 'test')->first();
    expect($row->secret_key_enc)->not->toContain(SK);
    expect(Crypt::decryptString($row->secret_key_enc))->toBe(SK);
    expect($row->secret_last4)->toBe('1234');
    $this->clearTenantContext();

    // Over the wire: tails only.
    $res = $this->getJson("/api/admin/clients/{$academyId}/payments/xpay")->assertOk();
    expect($res->json('xpay.mode'))->toBe('test');
    expect($res->json('xpay.is_active'))->toBeTrue();
    expect($res->json('xpay.modes.test.secret_last4'))->toBe('1234');
    expect($res->json('xpay.modes.test.has_webhook_secret'))->toBeTrue();
    expect($res->json('xpay.modes.live.configured'))->toBeFalse();
    expect($res->json('xpay.webhook_url'))->toContain("/api/webhooks/xpay/{$academyId}");
    expect(json_encode($res->json()))->not->toContain(SK);
    expect(json_encode($res->json()))->not->toContain(WHSEC);
});

it('holds test and live keys side by side and switches between them', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    // Onboarding: test keys first, channel live in test mode.
    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true,
        'mode' => 'test',
        'test' => ['secret_key' => SK, 'webhook_secret' => WHSEC, 'publishable_key' => 'pk_test_pub123'],
    ])->assertOk();

    // Later: add live keys WITHOUT touching the test set, and flip over.
    $res = $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true,
        'mode' => 'live',
        'live' => [
            'secret_key' => 'sk_live_zyxwvutsr5678',
            'webhook_secret' => 'whsec_livesecret4321',
            'publishable_key' => 'pk_live_pub999',
        ],
    ])->assertOk();

    expect($res->json('xpay.mode'))->toBe('live');
    expect($res->json('xpay.modes.test.secret_last4'))->toBe('1234');
    expect($res->json('xpay.modes.live.secret_last4'))->toBe('5678');

    // Both sets survive; the active one drives the public config.
    $this->asAcademy($academyId);
    expect(DB::table('academy_xpay_credentials')->where('academy_id', $academyId)->count())->toBe(2);
    $config = json_decode(DB::table('academy_payment_settings')->where('method', 'XPAY')->value('config'), true);
    expect($config['mode'])->toBe('live');
    expect($config['publishable_key'])->toBe('pk_live_pub999');
    $this->clearTenantContext();

    // And switching back to test needs no keys re-typed.
    $back = $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true, 'mode' => 'test',
    ])->assertOk();
    expect($back->json('xpay.mode'))->toBe('test');
    expect($back->json('xpay.modes.live.secret_last4'))->toBe('5678');
});

it('refuses a key pasted into the wrong environment', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    // A live key in the test box — the classic way to build a checkout that never charges anyone.
    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => false, 'mode' => 'test',
        'test' => ['secret_key' => 'sk_live_abc'],
    ])->assertStatus(422)->assertJsonValidationErrors('test.secret_key');

    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => false, 'mode' => 'test',
        'test' => ['secret_key' => SK, 'publishable_key' => 'pk_live_abc'],
    ])->assertStatus(422)->assertJsonValidationErrors('test.publishable_key');

    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => false, 'mode' => 'test',
        'test' => ['secret_key' => 'nonsense'],
    ])->assertStatus(422)->assertJsonValidationErrors('test.secret_key');

    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => false, 'mode' => 'test',
        'test' => ['secret_key' => SK, 'webhook_secret' => 'notawhsec'],
    ])->assertStatus(422)->assertJsonValidationErrors('test.webhook_secret');
});

it('will not put an environment in force with no keys behind it', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    // Nothing stored at all.
    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true, 'mode' => 'test',
    ])->assertStatus(422)->assertJsonValidationErrors('test.secret_key');

    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true, 'mode' => 'test',
        'test' => ['secret_key' => SK],
    ])->assertOk();

    // Test keys exist, live keys do not — switching to live is refused rather than silently
    // resolving to nothing at payment time.
    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true, 'mode' => 'live',
    ])->assertStatus(422)->assertJsonValidationErrors('live.secret_key');
});

it('keeps the stored secret when the field is left blank', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true, 'mode' => 'test',
        'test' => ['secret_key' => SK, 'webhook_secret' => WHSEC],
    ])->assertOk();

    // Toggle off without re-pasting credentials the admin can no longer read.
    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => false, 'mode' => 'test',
    ])->assertOk();

    $this->asAcademy($academyId);
    $row = DB::table('academy_xpay_credentials')->where('academy_id', $academyId)->where('mode', 'test')->first();
    expect(Crypt::decryptString($row->secret_key_enc))->toBe(SK);
    expect(DB::table('academy_payment_settings')->where('method', 'XPAY')->value('is_active'))->toBeFalse();
});

it('keeps the academy away from its own XPay keys', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);

    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    // The owner may SEE that the channel is live, and that keys exist behind it...
    $res = $this->getJson('/api/payment-settings')->assertOk();
    $xpay = collect($res->json('payment_settings'))->firstWhere('method', 'XPAY');
    expect($xpay['is_active'])->toBeTrue();
    expect($xpay['configured'])->toBeTrue();
    expect(json_encode($res->json()))->not->toContain(SK);
    expect(json_encode($res->json()))->not->toContain(WHSEC);

    // ...but never the keys themselves, and never the Super Admin surface that holds them.
    $this->getJson("/api/admin/clients/{$academyId}/payments/xpay")->assertForbidden();
    $this->putJson("/api/admin/clients/{$academyId}/payments/xpay", [
        'is_active' => true,
        'mode' => 'test',
    ])->assertForbidden();
});

it('lets the academy switch its own card button off and on', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);

    Sanctum::actingAs($this->makeUser($academyId, 'ACADEMY_OWNER'));

    $this->putJson('/api/payment-settings/XPAY', ['is_active' => false])->assertOk();

    xpayContext($academyId);
    $row = DB::table('academy_payment_settings')->where('method', 'XPAY')->first();
    xpayContext(null);

    expect((bool) $row->is_active)->toBeFalse();
    // The Super Admin's half of the row is not the academy's to move.
    expect(json_decode((string) $row->config, true))
        ->toEqualCanonicalizing(['publishable_key' => 'pk_test_pub123', 'mode' => 'test']);

    $this->putJson('/api/payment-settings/XPAY', ['is_active' => true])->assertOk();

    xpayContext($academyId);
    expect((bool) DB::table('academy_payment_settings')->where('method', 'XPAY')->value('is_active'))->toBeTrue();
    xpayContext(null);
});

it('ignores any config an academy tries to smuggle into the XPay toggle', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);

    Sanctum::actingAs($this->makeUser($academyId, 'ACADEMY_OWNER'));

    $this->putJson('/api/payment-settings/XPAY', [
        'is_active' => true,
        'config' => ['publishable_key' => 'pk_live_theirs', 'mode' => 'live'],
    ])->assertOk();

    xpayContext($academyId);
    $config = json_decode((string) DB::table('academy_payment_settings')->where('method', 'XPAY')->value('config'), true);
    xpayContext(null);

    expect($config)->toEqualCanonicalizing(['publishable_key' => 'pk_test_pub123', 'mode' => 'test']);
});

it('refuses to switch card payment on when no keys are provisioned', function () {
    $academyId = $this->createAcademy();

    Sanctum::actingAs($this->makeUser($academyId, 'ACADEMY_OWNER'));

    $res = $this->getJson('/api/payment-settings')->assertOk();
    expect(collect($res->json('payment_settings'))->firstWhere('method', 'XPAY')['configured'])->toBeFalse();

    // A button that 422s the moment a parent presses it is worse than no button at all.
    $this->putJson('/api/payment-settings/XPAY', ['is_active' => true])->assertStatus(422);
});

it('keeps secrets out of the public invoice payload', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    $res = $this->getJson("/api/i/{$token}")->assertOk();
    $methods = collect($res->json('payment_methods'))->firstWhere('method', 'XPAY');

    expect($methods)->not->toBeNull();
    expect($methods['config']['publishable_key'])->toBe('pk_test_pub123');
    expect(json_encode($res->json()))->not->toContain(SK);
    expect(json_encode($res->json()))->not->toContain(WHSEC);
});

// ── Opening a checkout ──────────────────────────────────────────────────────

it('opens a hosted checkout for a payable invoice', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    Http::fake(['api.xpay.app/checkout/sessions' => Http::response(
        xpaySession('cs_test_1', $invoiceId, $academyId, 50000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
        201,
    )]);

    $res = $this->postJson("/api/i/{$token}/xpay/session")->assertOk();
    expect($res->json('url'))->toContain('checkout.xpay.app');

    Http::assertSent(function ($request) {
        $body = $request->data();

        return $request->hasHeader('Authorization', 'Bearer '.SK)
            && $request->hasHeader('Idempotency-Key')
            && $body['mode'] === 'payment'
            // Minor units, straight off total_minor — no float ever touches this.
            && $body['lineItems'][0]['priceData']['unitAmount'] === 50000
            && $body['afterCompletion']['type'] === 'redirect'
            && str_contains($body['afterCompletion']['redirect']['url'], '{CHECKOUT_SESSION_ID}');
    });

    // The local order row is what later lets the webhook check the amount.
    $this->asAcademy($academyId);
    expect(DB::table('xpay_checkout_sessions')->where('id', 'cs_test_1')->value('amount_minor'))->toBe(50000);
});

it('refuses to open a checkout when XPay is not active for the academy', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId, active: false);
    [, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    Http::fake();
    $this->postJson("/api/i/{$token}/xpay/session")->assertNotFound();
    Http::assertNothingSent();
});

it('refuses to open a checkout for an already-paid invoice', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [, $token] = $this->createInvoice($academyId, null, [
        'total_minor' => 50000, 'subtotal_minor' => 50000, 'status' => 'PAID',
    ]);
    $this->clearTenantContext();

    Http::fake();
    $this->postJson("/api/i/{$token}/xpay/session")->assertStatus(409);
    Http::assertNothingSent();
});

// ── The webhook: the source of truth ────────────────────────────────────────

it('marks the invoice paid on checkout.session.completed', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    Http::fake(['api.xpay.app/checkout/sessions' => Http::response(
        xpaySession('cs_test_2', $invoiceId, $academyId, 50000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
        201,
    )]);
    $this->postJson("/api/i/{$token}/xpay/session")->assertOk();

    $event = [
        'id' => 'evt_test_1',
        'object' => 'event',
        'type' => 'checkout.session.completed',
        'livemode' => false,
        'data' => ['object' => xpaySession('cs_test_2', $invoiceId, $academyId, 50000)],
    ];

    $res = postWebhook($this, $academyId, $event)->assertOk();
    expect($res->json('marked_paid'))->toBeTrue();

    $this->asAcademy($academyId);
    $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
    expect($invoice->status)->toBe('PAID');
    expect($invoice->payment_method)->toBe('GATEWAY');
    expect($invoice->amount_paid_minor)->toBe(50000);
    expect($invoice->payment_reason)->toContain('cs_test_2');
});

it('rejects a forged, malformed, or stale signature', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    $event = [
        'id' => 'evt_test_forged',
        'type' => 'checkout.session.completed',
        'data' => ['object' => xpaySession('cs_test_x', $invoiceId, $academyId, 50000)],
    ];
    $body = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    // Signed with the wrong secret.
    postWebhook($this, $academyId, $event, xpaySignature($body, 'whsec_wrong'))->assertStatus(400);
    // No header at all.
    postWebhook($this, $academyId, $event, '')->assertStatus(400);
    // Well-formed but outside the 5-minute replay window.
    postWebhook($this, $academyId, $event, xpaySignature($body, WHSEC, time() - 400))->assertStatus(400);

    $this->asAcademy($academyId);
    expect(DB::table('invoices')->where('id', $invoiceId)->value('status'))->toBe('OPEN');
    expect(DB::table('xpay_webhook_events')->count())->toBe(0);
});

it('handles a replayed event exactly once', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    Http::fake(['api.xpay.app/checkout/sessions' => Http::response(
        xpaySession('cs_test_3', $invoiceId, $academyId, 50000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
        201,
    )]);
    $this->postJson("/api/i/{$token}/xpay/session")->assertOk();

    $event = [
        'id' => 'evt_test_dup',
        'type' => 'checkout.session.completed',
        'data' => ['object' => xpaySession('cs_test_3', $invoiceId, $academyId, 50000)],
    ];

    expect(postWebhook($this, $academyId, $event)->json('marked_paid'))->toBeTrue();

    $second = postWebhook($this, $academyId, $event)->assertOk();
    expect($second->json('duplicate'))->toBeTrue();
    expect($second->json('marked_paid'))->toBeNull();

    $this->asAcademy($academyId);
    expect(DB::table('xpay_webhook_events')->where('id', 'evt_test_dup')->count())->toBe(1);
    expect(DB::table('invoices')->where('id', $invoiceId)->value('amount_paid_minor'))->toBe(50000);
});

it('does not settle a payment that is short of the billed amount', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    Http::fake(['api.xpay.app/checkout/sessions' => Http::response(
        xpaySession('cs_test_4', $invoiceId, $academyId, 50000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
        201,
    )]);
    $this->postJson("/api/i/{$token}/xpay/session")->assertOk();

    $event = [
        'id' => 'evt_test_short',
        'type' => 'checkout.session.completed',
        'data' => ['object' => xpaySession('cs_test_4', $invoiceId, $academyId, 100)], // 1.00 EGP
    ];

    expect(postWebhook($this, $academyId, $event)->json('marked_paid'))->toBeFalse();

    $this->asAcademy($academyId);
    expect(DB::table('invoices')->where('id', $invoiceId)->value('status'))->toBe('OPEN');
});

it('ignores an event for a session it never opened', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    $event = [
        'id' => 'evt_test_ghost',
        'type' => 'checkout.session.completed',
        'data' => ['object' => xpaySession('cs_test_ghost', $invoiceId, $academyId, 50000)],
    ];

    expect(postWebhook($this, $academyId, $event)->json('ignored'))->toBe('unknown-session');

    $this->asAcademy($academyId);
    expect(DB::table('invoices')->where('id', $invoiceId)->value('status'))->toBe('OPEN');
});

it('will not let a test-mode webhook settle a live-mode invoice', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);

    // The client now also holds live keys, and has been switched over to them.
    xpayContext($academyId);
    DB::table('academy_xpay_credentials')->insert([
        'academy_id' => $academyId,
        'mode' => 'live',
        'secret_key_enc' => Crypt::encryptString('sk_live_zyxwvutsr5678'),
        'webhook_secret_enc' => Crypt::encryptString('whsec_livesecret4321'),
        'secret_last4' => '5678',
        'webhook_last4' => '4321',
    ]);
    DB::table('academy_payment_settings')->where('method', 'XPAY')->update([
        'config' => json_encode(['publishable_key' => 'pk_live_pub999', 'mode' => 'live']),
    ]);
    [$invoiceId] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    xpayContext(null);

    // A delivery signed with the TEST secret must not verify while live keys are in force —
    // otherwise play money could close a real bill.
    $event = [
        'id' => 'evt_test_wrongmode',
        'type' => 'checkout.session.completed',
        'livemode' => false,
        'data' => ['object' => xpaySession('cs_test_wm', $invoiceId, $academyId, 50000)],
    ];
    $body = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    postWebhook($this, $academyId, $event, xpaySignature($body, WHSEC))->assertStatus(400);

    $this->asAcademy($academyId);
    expect(DB::table('invoices')->where('id', $invoiceId)->value('status'))->toBe('OPEN');
});

it('acknowledges unrelated event types without acting', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    $this->clearTenantContext();

    $res = postWebhook($this, $academyId, [
        'id' => 'evt_test_charge',
        'type' => 'charge.succeeded',
        'data' => ['object' => ['id' => 'ch_test_1']],
    ])->assertOk();

    expect($res->json('ignored'))->toBe('charge.succeeded');
});

// ── The return-page fallback ────────────────────────────────────────────────

it('settles from the return page when no webhook ever arrives', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    Http::fake([
        'api.xpay.app/checkout/sessions' => Http::response(
            xpaySession('cs_test_5', $invoiceId, $academyId, 50000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
            201,
        ),
        'api.xpay.app/checkout/sessions/cs_test_5' => Http::response(
            xpaySession('cs_test_5', $invoiceId, $academyId, 50000),
        ),
    ]);

    $this->postJson("/api/i/{$token}/xpay/session")->assertOk();

    $res = $this->getJson("/api/i/{$token}/xpay/session/cs_test_5")->assertOk();
    expect($res->json('paid'))->toBeTrue();
    expect($res->json('marked'))->toBeTrue();

    $this->asAcademy($academyId);
    expect(DB::table('invoices')->where('id', $invoiceId)->value('status'))->toBe('PAID');
});

it('refuses to confirm a session belonging to another invoice', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    [$otherInvoiceId] = $this->createInvoice($academyId, null, ['total_minor' => 9900, 'subtotal_minor' => 9900]);
    $this->clearTenantContext();

    // A payer editing ?xpay= to point at somebody else's settled session.
    Http::fake(['api.xpay.app/checkout/sessions/cs_test_other' => Http::response(
        xpaySession('cs_test_other', $otherInvoiceId, $academyId, 9900),
    )]);

    $this->getJson("/api/i/{$token}/xpay/session/cs_test_other")->assertNotFound();
});

it('reports paid when the webhook won the race', function () {
    $academyId = $this->createAcademy();
    provisionXpay($this, $academyId);
    [$invoiceId, $token] = $this->createInvoice($academyId, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    Http::fake([
        'api.xpay.app/checkout/sessions' => Http::response(
            xpaySession('cs_test_6', $invoiceId, $academyId, 50000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
            201,
        ),
        'api.xpay.app/checkout/sessions/cs_test_6' => Http::response(
            xpaySession('cs_test_6', $invoiceId, $academyId, 50000),
        ),
    ]);
    $this->postJson("/api/i/{$token}/xpay/session")->assertOk();

    postWebhook($this, $academyId, [
        'id' => 'evt_test_race',
        'type' => 'checkout.session.completed',
        'data' => ['object' => xpaySession('cs_test_6', $invoiceId, $academyId, 50000)],
    ])->assertOk();

    // The page still says paid, even though this call changed nothing.
    $res = $this->getJson("/api/i/{$token}/xpay/session/cs_test_6")->assertOk();
    expect($res->json('paid'))->toBeTrue();
    expect($res->json('marked'))->toBeFalse();
});

it('settles a non-EGP invoice against the presentment amount, not the EGP settlement', function () {
    $academyId = $this->createAcademy(overrides: ['default_currency' => 'USD']);
    provisionXpay($this, $academyId);
    [$invoiceId, $token] = $this->createInvoice($academyId, null, [
        'total_minor' => 10000, 'subtotal_minor' => 10000, 'currency' => 'USD',
    ]);
    $this->clearTenantContext();

    // XPay settles in EGP: amountTotal is the EGP figure, presentmentDetails is the USD the payer saw.
    // Comparing the invoice's 100.00 USD against 4,850.00 EGP would reject a perfectly good payment.
    $settled = xpaySession('cs_test_7', $invoiceId, $academyId, 485000, [
        'currency' => 'EGP',
        'presentmentDetails' => ['amountTotal' => 10000, 'currency' => 'USD'],
    ]);

    Http::fake([
        'api.xpay.app/checkout/sessions' => Http::response(
            array_merge($settled, ['status' => 'open', 'paymentStatus' => 'unpaid']),
            201,
        ),
        'api.xpay.app/checkout/sessions/cs_test_7' => Http::response($settled),
    ]);

    $this->postJson("/api/i/{$token}/xpay/session")->assertOk();
    expect($this->getJson("/api/i/{$token}/xpay/session/cs_test_7")->json('paid'))->toBeTrue();
});
