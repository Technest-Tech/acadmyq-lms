<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * Settings → Payment methods: the academy picks how payers send it money — wallet numbers and
 * InstaPay in Egypt, a PayPal email or a bank account abroad, or its own free text — and each live
 * method shows on the bill page (`/i/`) and the family page (`/f/`).
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->clearTenantContext();
    $this->academy = $this->createAcademy();
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-pm-'.uniqid().'@test.local']);
    $this->clearTenantContext();
});

/** Read a stored config under the academy's RLS context (helpers run in global scope, so GUCs directly). */
function storedPaymentConfig(string $academyId, string $method): ?array
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    $raw = DB::table('academy_payment_settings')->where('method', $method)->value('config');
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return $raw === null ? null : json_decode((string) $raw, true);
}

it('lists every method, the new ones switched off', function () {
    Sanctum::actingAs($this->owner);

    $methods = collect($this->getJson('/api/payment-settings')->assertOk()->json('payment_settings'));

    expect($methods->pluck('method')->all())->toBe(['WALLET', 'INSTAPAY', 'BANK_TRANSFER', 'PAYPAL', 'OTHER', 'XPAY'])
        ->and($methods->every(fn (array $m): bool => $m['is_active'] === false))->toBeTrue();
});

it('saves wallet numbers cleaned, deduplicated and capped at three', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/payment-settings/WALLET', [
        'is_active' => true,
        'config' => [
            'numbers' => ['010 1234 5678', '01112345678abc', '010 1234 5678', '', '01212345678', '01512345678'],
            'holder' => '  Noor Academy  ',
            'note' => 'Send the screenshot on WhatsApp',
            'junk' => 'dropped',
        ],
    ])->assertOk();

    expect(storedPaymentConfig($this->academy, 'WALLET'))->toEqual([
        'numbers' => ['010 1234 5678', '01112345678', '01212345678'],
        'holder' => 'Noor Academy',
        'note' => 'Send the screenshot on WhatsApp',
    ]);
});

it('refuses to switch a method on with nowhere to send the money', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/payment-settings/WALLET', ['is_active' => true, 'config' => ['numbers' => []]])->assertStatus(422);
    $this->putJson('/api/payment-settings/INSTAPAY', ['is_active' => true, 'config' => ['holder' => 'x']])->assertStatus(422);
    $this->putJson('/api/payment-settings/PAYPAL', ['is_active' => true, 'config' => ['note' => 'x']])->assertStatus(422);
    $this->putJson('/api/payment-settings/OTHER', ['is_active' => true, 'config' => ['title' => 'Wise']])->assertStatus(422);

    // Off, a half-filled method saves fine — the academy can come back to it.
    $this->putJson('/api/payment-settings/WALLET', ['is_active' => false, 'config' => ['holder' => 'Noor']])->assertOk();
});

it('only ever stores http(s) links', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/payment-settings/INSTAPAY', [
        'is_active' => true,
        'config' => ['link' => 'javascript:alert(1)'],
    ])->assertStatus(422);

    $this->putJson('/api/payment-settings/INSTAPAY', [
        'is_active' => true,
        'config' => ['link' => 'ipn.eg/S/noor/instapay/abc', 'address' => 'noor@instapay'],
    ])->assertOk();
    expect(storedPaymentConfig($this->academy, 'INSTAPAY')['link'])->toBe('https://ipn.eg/S/noor/instapay/abc');

    $this->putJson('/api/payment-settings/PAYPAL', [
        'is_active' => true,
        'config' => ['email' => 'pay@noor.test', 'paypal_me' => 'noorAcademy'],
    ])->assertOk();
    expect(storedPaymentConfig($this->academy, 'PAYPAL')['paypal_me'])->toBe('https://paypal.me/noorAcademy');

    $this->putJson('/api/payment-settings/PAYPAL', [
        'is_active' => true,
        'config' => ['email' => 'not-an-email'],
    ])->assertStatus(422);
});

it('never hands the PayPal API secret back, and keeps it when the form saves without it', function () {
    $this->asAcademy($this->academy);
    DB::table('academy_payment_settings')->insert([
        'academy_id' => $this->academy,
        'method' => 'PAYPAL',
        'is_active' => true,
        'config' => json_encode(['client_id' => 'AcId', 'client_secret' => 'TopSecretValue', 'email' => '', 'mode' => 'live']),
    ]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/payment-settings')->assertOk();
    $paypal = collect($res->json('payment_settings'))->firstWhere('method', 'PAYPAL');
    expect(json_encode($res->json()))->not->toContain('TopSecretValue')
        ->and($paypal['has_client_secret'])->toBeTrue();

    // The settings form sends only the payer-facing fields.
    $this->putJson('/api/payment-settings/PAYPAL', [
        'is_active' => true,
        'config' => ['email' => 'pay@noor.test', 'note' => 'Friends & family'],
    ])->assertOk();

    $stored = storedPaymentConfig($this->academy, 'PAYPAL');
    expect($stored['client_id'])->toBe('AcId')
        ->and($stored['client_secret'])->toBe('TopSecretValue')
        ->and($stored['email'])->toBe('pay@noor.test');
});

it('keeps the settings to payment_settings.manage', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-pm-'.uniqid().'@test.local']);
    Sanctum::actingAs($teacher);

    $this->putJson('/api/payment-settings/WALLET', [
        'is_active' => true,
        'config' => ['numbers' => ['01000000000']],
    ])->assertForbidden();
});

it('shows live manual methods on the public bill page, and hides switched-off ones', function () {
    Sanctum::actingAs($this->owner);
    $this->putJson('/api/payment-settings/WALLET', ['is_active' => true, 'config' => ['numbers' => ['01012345678']]])->assertOk();
    $this->putJson('/api/payment-settings/OTHER', ['is_active' => false, 'config' => ['title' => 'Wise', 'details' => 'IBAN …']])->assertOk();

    [, $token] = $this->createInvoice($this->academy, null, ['total_minor' => 50000, 'subtotal_minor' => 50000]);
    $this->clearTenantContext();

    $methods = collect($this->getJson("/api/i/{$token}")->assertOk()->json('payment_methods'));

    expect($methods->pluck('method')->all())->toBe(['WALLET'])
        ->and($methods->first()['config']['numbers'])->toBe(['01012345678']);
});
