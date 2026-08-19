<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * External WhatsApp API (docs/whatsapp-api) — sending text + images, idempotency, number-check and
 * status. Delivery is proxied to the gateway via the shared WhatsAppSender seam and logged with
 * automation_type = API. The gateway HTTP is faked.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');
    $this->academy = $this->createAcademy(modules: ['MANAGEMENT', 'WHATSAPP']);
    $this->key = makeWhatsAppApiKey($this->academy);
});

it('sends a text message through the academy token and logs it as API', function () {
    Http::fake(['*' => Http::response(['data' => ['msgId' => 'wamid.text']], 200)]);
    giveWhatsAppToken($this->academy, 'token-A');

    $this->postJson('/api/wa/v1/messages', ['to' => '201234567890', 'text' => 'Hello there'], [
        'Authorization' => "Bearer {$this->key}",
    ])->assertStatus(202)->assertJsonPath('status', 'accepted')->assertJsonPath('message_id', 'wamid.text');

    Http::assertSent(fn ($req) => $req->hasHeader('Authorization', 'Bearer token-A')
        && str_contains($req->url(), '/api/send-message')
        && ($req->data()['text'] ?? null) === 'Hello there');

    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('automation_send_log')->where('academy_id', $this->academy)
        ->where('automation_type', 'API')->where('status', 'SENT')->exists())->toBeTrue();
});

it('sends an image by URL with a caption and records the media', function () {
    Http::fake(['*' => Http::response(['data' => ['msgId' => 'wamid.img']], 200)]);
    giveWhatsAppToken($this->academy, 'token-A');

    $this->postJson('/api/wa/v1/messages', [
        'to' => '201234567890',
        'image_url' => 'https://cdn.example.com/promo.jpg',
        'caption' => 'New term!',
    ], ['Authorization' => "Bearer {$this->key}"])->assertStatus(202);

    Http::assertSent(fn ($req) => ($req->data()['imageUrl'] ?? null) === 'https://cdn.example.com/promo.jpg'
        && ($req->data()['caption'] ?? null) === 'New term!');

    $this->enterAcademyAsSuperAdmin($this->academy);
    $row = DB::table('automation_send_log')->where('academy_id', $this->academy)->where('automation_type', 'API')->first();
    expect($row->media_type)->toBe('image');
    expect($row->media_url)->toBe('https://cdn.example.com/promo.jpg');
});

it('rejects a body with both text and image', function () {
    giveWhatsAppToken($this->academy);

    $this->postJson('/api/wa/v1/messages', [
        'to' => '201234567890',
        'text' => 'hi',
        'image_url' => 'https://cdn.example.com/x.jpg',
    ], ['Authorization' => "Bearer {$this->key}"])->assertStatus(422);
});

it('rejects a non-https image url', function () {
    giveWhatsAppToken($this->academy);

    $this->postJson('/api/wa/v1/messages', [
        'to' => '201234567890',
        'image_url' => 'http://cdn.example.com/x.jpg',
    ], ['Authorization' => "Bearer {$this->key}"])->assertStatus(422);
});

it('returns 409 not_connected when the academy has no session', function () {
    // No token set for this academy → text send falls back to DEEPLINK, which the API reports as 409.
    $this->postJson('/api/wa/v1/messages', ['to' => '201234567890', 'text' => 'hi'], [
        'Authorization' => "Bearer {$this->key}",
    ])->assertStatus(409)->assertJsonPath('error', 'not_connected');
});

it('dedupes retries with the Idempotency-Key header', function () {
    Http::fake(['*' => Http::response(['data' => ['msgId' => 'wamid.once']], 200)]);
    giveWhatsAppToken($this->academy, 'token-A');

    $headers = ['Authorization' => "Bearer {$this->key}", 'Idempotency-Key' => 'order-99'];
    $body = ['to' => '201234567890', 'text' => 'Only once'];

    $this->postJson('/api/wa/v1/messages', $body, $headers)->assertStatus(202);
    $this->postJson('/api/wa/v1/messages', $body, $headers)->assertStatus(200)->assertJsonPath('status', 'duplicate');

    // Exactly one gateway send happened.
    Http::assertSentCount(1);
});

it('checks whether a number is on WhatsApp', function () {
    Http::fake(['*/api/on-whatsapp/*' => Http::response(['exists' => true], 200)]);
    giveWhatsAppToken($this->academy, 'token-A');

    $this->getJson('/api/wa/v1/contacts/201234567890', ['Authorization' => "Bearer {$this->key}"])
        ->assertOk()->assertJsonPath('exists', true);
});

it('reports the connection status', function () {
    Http::fake(['*/api/status' => Http::response(['status' => 'connected'], 200)]);
    giveWhatsAppToken($this->academy, 'token-A');

    $this->getJson('/api/wa/v1/status', ['Authorization' => "Bearer {$this->key}"])
        ->assertOk()->assertJsonPath('status', 'CONNECTED')->assertJsonPath('connected', true);
});

it('isolates tenants — academy A key never uses academy B token', function () {
    Http::fake(['*' => Http::response(['data' => ['msgId' => 'wamid.iso']], 200)]);
    giveWhatsAppToken($this->academy, 'token-A');

    // A second academy with its own token; A's key must never touch it.
    $other = $this->createAcademy(modules: ['MANAGEMENT', 'WHATSAPP']);
    giveWhatsAppToken($other, 'token-B');

    $this->postJson('/api/wa/v1/messages', ['to' => '201234567890', 'text' => 'scoped'], [
        'Authorization' => "Bearer {$this->key}",
    ])->assertStatus(202);

    Http::assertSent(fn ($req) => $req->hasHeader('Authorization', 'Bearer token-A'));
    Http::assertNotSent(fn ($req) => $req->hasHeader('Authorization', 'Bearer token-B'));

    $this->enterAcademyAsSuperAdmin($other);
    expect(DB::table('automation_send_log')->where('academy_id', $other)->exists())->toBeFalse();
});
