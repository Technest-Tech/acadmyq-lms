<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Public "connect your WhatsApp" link (docs/whatsapp-api). A Super Admin mints an expiring link; the
 * client opens it (no login) to start a gateway session + scan the QR. The token → academy resolution
 * is a SECURITY DEFINER reader; expired/unknown tokens 404. The gateway HTTP is faked.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');
    $this->academy = $this->createAcademy(modules: ['MANAGEMENT', 'WHATSAPP']);
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

/** Store a connect token (hash + expiry) for an academy and return the plaintext. */
function makeConnectToken(string $academyId, ?Carbon $expiresAt = null): string
{
    $token = Str::random(40);
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('academy_automation_settings')->updateOrInsert(
        ['academy_id' => $academyId],
        [
            'id' => (string) Str::uuid(),
            'connect_token_hash' => hash('sha256', $token),
            'connect_token_expires_at' => $expiresAt ?? now()->addHours(48),
            'updated_at' => now(),
        ],
    );
    test()->clearTenantContext();

    return $token;
}

it('lets a Super Admin mint a connect link', function () {
    Sanctum::actingAs($this->admin);
    $res = $this->postJson("/api/admin/academies/{$this->academy}/connect-link")
        ->assertCreated();

    expect($res->json('path'))->toStartWith('/wa-connect/');
    expect($res->json('expires_at'))->not->toBeNull();

    // A hash was stored (never the plaintext).
    $this->enterAcademyAsSuperAdmin($this->academy);
    $hash = DB::table('academy_automation_settings')->where('academy_id', $this->academy)->value('connect_token_hash');
    expect($hash)->not->toBeNull();
    $token = str_replace('/wa-connect/', '', $res->json('path'));
    expect($hash)->toBe(hash('sha256', $token));
});

it('starts a gateway session + returns a QR from a valid link', function () {
    Http::fake([
        '*/sessions' => Http::response(['sessionId' => 'sess-123', 'token' => 'gw-tok'], 200),
        '*/sessions/*/qr' => Http::response(['state' => 'qr', 'qr' => 'data:image/png;base64,AAAA'], 200),
    ]);
    $token = makeConnectToken($this->academy);

    $this->postJson("/api/wa/connect/{$token}/start")
        ->assertOk()
        ->assertJsonPath('state', 'qr')
        ->assertJsonPath('qr', 'data:image/png;base64,AAAA');

    // The gateway-minted token + session id were persisted (encrypted) for the academy.
    $this->enterAcademyAsSuperAdmin($this->academy);
    $row = DB::table('academy_automation_settings')->where('academy_id', $this->academy)->first();
    expect($row->wa_session_id)->toBe('sess-123');
    expect(Crypt::decryptString($row->wasender_token))->toBe('gw-tok');
});

it('404s an unknown token', function () {
    $this->postJson('/api/wa/connect/nope-nope-nope/start')->assertNotFound();
});

it('404s an expired token', function () {
    $token = makeConnectToken($this->academy, now()->subHour());

    $this->postJson("/api/wa/connect/{$token}/start")->assertNotFound();
});
