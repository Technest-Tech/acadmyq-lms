<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * One card payment for a family's whole dues (`/f/{token}`): one XPay checkout for the total of every
 * due package bill, settled bill by bill — by the webhook or by the return page — against the bills
 * our own session row says it covered.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

const FAM_SK = 'sk_test_family000001';
const FAM_WHSEC = 'whsec_family_secret01';

beforeEach(function () {
    $this->clearTenantContext();
    config(['lms.site.root_domain' => 'acadmyq.test', 'lms.site.scheme' => 'https']);

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->guardian = $this->createGuardian($this->academy, ['full_name' => 'Hassan Family', 'pay_token' => $this->token = Str::random(48)]);
    $this->yusuf = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Yusuf']);
    $this->maryam = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Maryam']);
    $other = $this->createStudent($this->academy, null, ['full_name' => 'Someone Else']);

    $this->asAcademy($this->academy);
    $this->yusufBill = famXpayBill($this->academy, $this->yusuf, 60000);
    $this->maryamBill = famXpayBill($this->academy, $this->maryam, 40000);
    // Another family's debt is never part of this family's payment.
    $this->otherBill = famXpayBill($this->academy, $other, 99900);
    DB::table('academy_xpay_credentials')->insert([
        'academy_id' => $this->academy, 'mode' => 'test', 'publishable_key' => 'pk_test_fam',
        'secret_key_enc' => Crypt::encryptString(FAM_SK), 'webhook_secret_enc' => Crypt::encryptString(FAM_WHSEC),
        'secret_last4' => '0001', 'webhook_last4' => 'et01',
    ]);
    DB::table('academy_payment_settings')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'method' => 'XPAY', 'is_active' => true,
        'config' => json_encode(['publishable_key' => 'pk_test_fam', 'mode' => 'test']),
    ]);
    $this->clearTenantContext();
});

/** A package with its own unpaid bill, as an ON_START package opens. */
function famXpayBill(string $academyId, string $studentId, int $total, array $invoice = []): string
{
    $invoiceId = (string) Str::uuid();
    DB::table('invoices')->insert(array_merge([
        'id' => $invoiceId, 'academy_id' => $academyId, 'kind' => 'MANUAL', 'student_id' => $studentId,
        'period_year' => 2026, 'period_month' => 6, 'status' => 'OPEN', 'currency' => 'EGP',
        'subtotal_minor' => $total, 'total_minor' => $total, 'public_token' => 'tok-'.Str::random(20),
    ], $invoice));
    DB::table('lesson_packages')->insert([
        'academy_id' => $academyId, 'student_id' => $studentId, 'label' => '20 hours', 'minutes_total' => 1200,
        'price_minor' => $total, 'currency' => 'EGP', 'hourly_rate_minor' => intdiv($total, 20), 'status' => 'ACTIVE',
        'sequence_no' => 1, 'starts_on' => '2026-06-01', 'invoice_id' => $invoiceId,
    ]);

    return $invoiceId;
}

/** A family Checkout Session object, as the API and the webhook both render it. */
function famXpaySession(string $id, string $guardianId, string $academyId, int $amount, array $overrides = []): array
{
    return array_merge([
        'id' => $id, 'object' => 'checkout.session', 'status' => 'complete', 'paymentStatus' => 'paid',
        'currency' => 'EGP', 'amountTotal' => $amount, 'url' => 'https://checkout.xpay.app/c/'.$id,
        'metadata' => ['kind' => 'family', 'guardian_id' => $guardianId, 'academy_id' => $academyId],
    ], $overrides);
}

function famXpayWebhook(object $test, string $academyId, array $session, string $eventId = 'evt_fam_1')
{
    $body = json_encode([
        'id' => $eventId, 'object' => 'event', 'type' => 'checkout.session.completed', 'livemode' => false,
        'data' => ['object' => $session],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $t = time();

    return $test->call('POST', "/api/webhooks/xpay/{$academyId}", [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_XPAY_SIGNATURE' => 't='.$t.',v1='.hash_hmac('sha256', $t.'.'.$body, FAM_WHSEC),
    ], $body);
}

/** Open the family checkout the way the page does, faking XPay's answer. */
function famXpayOpen(object $test, string $sessionId, int $amount): void
{
    Http::fake(['api.xpay.app/checkout/sessions' => Http::response(
        famXpaySession($sessionId, $test->guardian, $test->academy, $amount, ['status' => 'open', 'paymentStatus' => 'unpaid']),
        201,
    )]);
    $test->postJson("/api/f/{$test->token}/xpay/session")->assertOk();
}

/** Pest's top-level helpers cannot reach InteractsWithTenancy's protected methods — set the GUCs. */
function famXpayStatus(object $test, string $invoiceId): string
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$test->academy]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    $status = (string) DB::table('invoices')->where('id', $invoiceId)->value('status');
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return $status;
}

it('offers the card on the family page', function () {
    expect($this->getJson("/api/f/{$this->token}")->assertOk()->json('xpay'))->toBeTrue();
});

it('opens ONE checkout for the whole family total and remembers which bills it covers', function () {
    Http::fake(['api.xpay.app/checkout/sessions' => Http::response(
        famXpaySession('cs_test_fam1', $this->guardian, $this->academy, 100000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
        201,
    )]);

    $res = $this->postJson("/api/f/{$this->token}/xpay/session")->assertOk();
    expect($res->json('url'))->toContain('checkout.xpay.app')
        ->and($res->json('amount_minor'))->toBe(100000);

    Http::assertSent(function ($request) {
        $body = $request->data();

        return $request->hasHeader('Authorization', 'Bearer '.FAM_SK)
            && $body['lineItems'][0]['priceData']['unitAmount'] === 100000
            && $body['metadata']['kind'] === 'family'
            && $body['metadata']['guardian_id'] === $this->guardian
            && str_contains($body['afterCompletion']['redirect']['url'], "/f/{$this->token}?xpay={CHECKOUT_SESSION_ID}");
    });

    $this->asAcademy($this->academy);
    expect(DB::table('xpay_checkout_sessions')->where('id', 'cs_test_fam1')->first(['amount_minor', 'guardian_id', 'invoice_id']))
        ->toMatchObject(['amount_minor' => 100000, 'guardian_id' => $this->guardian, 'invoice_id' => null]);
    expect(DB::table('xpay_checkout_session_invoices')->where('session_id', 'cs_test_fam1')->pluck('amount_minor', 'invoice_id')->all())
        ->toEqual([$this->yusufBill => 60000, $this->maryamBill => 40000]);
});

it('marks every covered bill paid when the webhook says the payment is in — once', function () {
    famXpayOpen($this, 'cs_test_fam2', 100000);

    $res = famXpayWebhook($this, $this->academy, famXpaySession('cs_test_fam2', $this->guardian, $this->academy, 100000))->assertOk();
    expect($res->json('marked_paid'))->toBeTrue();
    expect(famXpayStatus($this, $this->yusufBill))->toBe('PAID')
        ->and(famXpayStatus($this, $this->maryamBill))->toBe('PAID')
        ->and(famXpayStatus($this, $this->otherBill))->toBe('OPEN');

    $this->asAcademy($this->academy);
    expect(DB::table('invoices')->where('id', $this->yusufBill)->first(['amount_paid_minor', 'payment_method']))
        ->toMatchObject(['amount_paid_minor' => 60000, 'payment_method' => 'GATEWAY']);
    $this->clearTenantContext();

    // A redelivery under a new event id finds nothing left to move.
    $again = famXpayWebhook($this, $this->academy, famXpaySession('cs_test_fam2', $this->guardian, $this->academy, 100000), 'evt_fam_2');
    expect($again->json('marked_paid'))->toBeFalse();
});

it('settles nothing when the card paid less than the family owed', function () {
    famXpayOpen($this, 'cs_test_fam3', 100000);

    $res = famXpayWebhook($this, $this->academy, famXpaySession('cs_test_fam3', $this->guardian, $this->academy, 60000));
    expect($res->json('marked_paid'))->toBeFalse();
    expect(famXpayStatus($this, $this->yusufBill))->toBe('OPEN')
        ->and(famXpayStatus($this, $this->maryamBill))->toBe('OPEN');
});

it('ignores a family event for a session it never opened', function () {
    $res = famXpayWebhook($this, $this->academy, famXpaySession('cs_test_forged', $this->guardian, $this->academy, 100000));
    expect($res->json('ignored'))->toBe('unknown-session');
    expect(famXpayStatus($this, $this->yusufBill))->toBe('OPEN');
});

it('settles from the return page when no webhook arrives, and reports paid', function () {
    famXpayOpen($this, 'cs_test_fam4', 100000);
    Http::fake(['api.xpay.app/checkout/sessions/cs_test_fam4' => Http::response(
        famXpaySession('cs_test_fam4', $this->guardian, $this->academy, 100000),
    )]);

    $res = $this->getJson("/api/f/{$this->token}/xpay/session/cs_test_fam4")->assertOk();
    expect($res->json('paid'))->toBeTrue()->and($res->json('marked'))->toBeTrue();
    expect(famXpayStatus($this, $this->maryamBill))->toBe('PAID');
});

it('refuses to confirm a session that belongs to another family', function () {
    Http::fake(['api.xpay.app/checkout/sessions/cs_test_theirs' => Http::response(
        famXpaySession('cs_test_theirs', (string) Str::uuid(), $this->academy, 100000),
    )]);

    $this->getJson("/api/f/{$this->token}/xpay/session/cs_test_theirs")->assertNotFound();
    expect(famXpayStatus($this, $this->yusufBill))->toBe('OPEN');
});

it('pays the rest when one bill was settled another way in the meantime', function () {
    famXpayOpen($this, 'cs_test_fam5', 100000);
    $this->asAcademy($this->academy);
    DB::table('invoices')->where('id', $this->yusufBill)->update(['status' => 'PAID', 'amount_paid_minor' => 60000]);
    $this->clearTenantContext();

    $res = famXpayWebhook($this, $this->academy, famXpaySession('cs_test_fam5', $this->guardian, $this->academy, 100000));
    expect($res->json('marked_paid'))->toBeTrue();
    expect(famXpayStatus($this, $this->maryamBill))->toBe('PAID');
    $this->asAcademy($this->academy);
    // The cash payment is left exactly as it was recorded.
    expect(DB::table('invoices')->where('id', $this->yusufBill)->value('payment_method'))->not->toBe('GATEWAY');
});

it('refuses to open a checkout when the card is switched off', function () {
    $this->asAcademy($this->academy);
    DB::table('academy_payment_settings')->where('method', 'XPAY')->update(['is_active' => false]);
    $this->clearTenantContext();

    Http::fake();
    $this->postJson("/api/f/{$this->token}/xpay/session")->assertStatus(422);
    Http::assertNothingSent();
});

it('404s an unknown family link', function () {
    Http::fake();
    $this->postJson('/api/f/'.Str::random(48).'/xpay/session')->assertNotFound();
    Http::assertNothingSent();
});
