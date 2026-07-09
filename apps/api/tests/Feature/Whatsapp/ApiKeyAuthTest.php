<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * External WhatsApp API (docs/whatsapp-api) — API-key authentication + entitlement/suspension gates.
 * The key resolves to an academy via the BYPASSRLS reader and sets the tenant context; a key can only
 * act as its own academy, only while the academy is active and its plan includes whatsapp.automation.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');
});

it('rejects a request with no API key', function () {
    $this->postJson('/api/wa/v1/messages', ['to' => '201234567890', 'text' => 'hi'])
        ->assertStatus(401)
        ->assertJsonPath('error', 'missing_api_key');
});

it('rejects a garbage API key', function () {
    $this->postJson('/api/wa/v1/messages', ['to' => '201234567890', 'text' => 'hi'], [
        'Authorization' => 'Bearer wa_not_a_real_key',
    ])->assertStatus(401)->assertJsonPath('error', 'invalid_api_key');
});

it('rejects a revoked API key', function () {
    $academy = $this->createAcademy(overrides: ['plan_id' => $this->basicPlan]);
    $key = makeWhatsAppApiKey($academy, ['revoked_at' => now()]);

    $this->postJson('/api/wa/v1/messages', ['to' => '201234567890', 'text' => 'hi'], [
        'Authorization' => "Bearer {$key}",
    ])->assertStatus(401)->assertJsonPath('error', 'invalid_api_key');
});

it('rejects a key for a suspended academy', function () {
    $academy = $this->createAcademy(overrides: ['plan_id' => $this->basicPlan, 'status' => 'SUSPENDED']);
    $key = makeWhatsAppApiKey($academy);

    $this->getJson('/api/wa/v1/status', ['Authorization' => "Bearer {$key}"])
        ->assertStatus(403)->assertJsonPath('error', 'account_suspended');
});

it('rejects a key for an academy whose plan lacks whatsapp.automation', function () {
    // No plan at all → whatsapp.automation not granted.
    $academy = $this->createAcademy();
    $key = makeWhatsAppApiKey($academy);

    $this->getJson('/api/wa/v1/status', ['Authorization' => "Bearer {$key}"])
        ->assertStatus(403)->assertJsonPath('error', 'not_entitled');
});

it('accepts a valid key and stamps last_used_at', function () {
    $academy = $this->createAcademy(overrides: ['plan_id' => $this->basicPlan]);
    $key = makeWhatsAppApiKey($academy);

    // No session connected → status endpoint still authenticates and returns a disconnected state.
    $this->getJson('/api/wa/v1/status', ['Authorization' => "Bearer {$key}"])
        ->assertOk()
        ->assertJsonPath('connected', false);

    $this->enterAcademyAsSuperAdmin($academy);
    expect(DB::table('whatsapp_api_keys')->where('academy_id', $academy)->value('last_used_at'))->not->toBeNull();
});
