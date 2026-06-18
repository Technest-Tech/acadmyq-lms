<?php

declare(strict_types=1);

use App\Services\Whatsapp\WhatsAppSender;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

it('stores the Wasender token encrypted and never returns it', function () {
    $academyId = $this->createAcademy();

    Sanctum::actingAs($this->admin);
    $res = $this->postJson("/api/admin/academies/{$academyId}/automation/token", [
        'token' => 'super-secret-wasender-token',
    ])->assertOk();

    // The response exposes only has_token + a short tail, never the token.
    expect($res->json('automation.has_token'))->toBeTrue();
    expect($res->json('automation.token_tail'))->toBe('oken');
    expect(json_encode($res->json()))->not->toContain('super-secret-wasender-token');

    // The column holds ciphertext that decrypts back to the original.
    $this->enterAcademyAsSuperAdmin($academyId);
    $stored = DB::table('academy_automation_settings')->where('academy_id', $academyId)->value('wasender_token');
    expect($stored)->not->toBe('super-secret-wasender-token');
    expect(Crypt::decryptString($stored))->toBe('super-secret-wasender-token');
});

it('persists the per-type toggles and audits the change', function () {
    $academyId = $this->createAcademy();

    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/academies/{$academyId}/automation", [
        'type1_billing_enabled' => true,
        'type2_lessons_enabled' => false,
    ])->assertOk()->assertJsonPath('automation.type1_billing_enabled', true);

    $this->enterAcademyAsSuperAdmin($academyId);
    expect((bool) DB::table('academy_automation_settings')->where('academy_id', $academyId)->value('type1_billing_enabled'))->toBeTrue();
    expect(DB::table('audit_log')->where('action', 'automation.settings_updated')->exists())->toBeTrue();
});

it('forbids an owner from the automation endpoints', function () {
    $academyId = $this->createAcademy();
    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->getJson("/api/admin/academies/{$academyId}/automation")->assertForbidden();
    $this->postJson("/api/admin/academies/{$academyId}/automation/token", ['token' => 'xxxxxxxx'])->assertForbidden();
});

it('the seam sends via Wasender with the academy OWN token and logs the transport', function () {
    Http::fake(['*' => Http::response(['data' => ['msgId' => 'wamid.123']], 200)]);

    $a = $this->createAcademy();
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$a}/automation/token", ['token' => 'token-AAA'])->assertOk();

    // Send within academy A's context (as the seam is used by controllers/jobs).
    $this->enterAcademyAsSuperAdmin($a);
    $res = app(WhatsAppSender::class)->sendOrLink($a, '+201234567890', 'Hello', ['automation_type' => 'MANUAL']);

    expect($res['transport'])->toBe('WASENDER');
    expect($res['sent'])->toBeTrue();

    // The request carried academy A's bearer token — never another academy's.
    Http::assertSent(fn ($request) => $request->hasHeader('Authorization', 'Bearer token-AAA')
        && str_contains($request->url(), '/api/send-message'));

    expect(DB::table('automation_send_log')->where('academy_id', $a)->where('transport', 'WASENDER')->where('status', 'SENT')->exists())->toBeTrue();
});

it('falls back to a deep link with the legacy shape when no token is set', function () {
    $a = $this->createAcademy();
    $this->enterAcademyAsSuperAdmin($a);

    $res = app(WhatsAppSender::class)->sendOrLink($a, '+201112223334', 'Hi there', ['automation_type' => 'MANUAL']);

    expect($res['transport'])->toBe('DEEPLINK');
    expect($res['sent'])->toBeFalse();
    expect($res['deeplink'])->toContain('https://wa.me/201112223334');
});
