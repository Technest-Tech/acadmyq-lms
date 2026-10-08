<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Settings → WhatsApp: the academy pairs its own number. And the bug behind it — "WhatsApp logs out
 * every 2-3 days": every connect used to create a gateway session, which logs the previous device
 * out, so merely re-opening an old /wa-connect link unlinked a working number. Connect is now
 * idempotent: a live session is reported, never replaced. The gateway HTTP is faked.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(modules: ['MANAGEMENT', 'WHATSAPP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-wa@test.local']);
    $this->sessionId = 'sess-'.substr($this->academy, 0, 8);
});

/** Fake the gateway with the existing session in `$state` (or 404 / 500 for `missing` / `down`). */
function fakeGateway(string $state): void
{
    Http::fake(function (Request $request) use ($state) {
        $url = $request->url();
        if ($request->method() === 'POST' && str_ends_with($url, '/sessions')) {
            return Http::response(['sessionId' => 'sess-new', 'token' => 'gw-new'], 201);
        }
        if (str_contains($url, '/sessions/sess-new/qr')) {
            return Http::response(['state' => 'qr', 'qr' => 'data:image/png;base64,NEW'], 200);
        }
        if ($request->method() === 'DELETE') {
            return Http::response(['ok' => true], 200);
        }

        return match ($state) {
            'missing' => Http::response(['error' => 'not_found'], 404),
            'down' => Http::response(['error' => 'boom'], 500),
            default => str_ends_with($url, '/qr')
                ? Http::response(['state' => $state, 'qr' => 'data:image/png;base64,LIVE'], 200)
                : Http::response([
                    'state' => $state,
                    'phoneJid' => $state === 'connected' ? '201090091143:12@s.whatsapp.net' : null,
                    'lastConnectedAt' => '2026-10-01T18:26:05.000Z',
                ], 200),
        };
    });
}

function createdASession(): bool
{
    return Http::recorded(fn (Request $r) => $r->method() === 'POST' && str_ends_with($r->url(), '/sessions'))->isNotEmpty();
}

function storedSession(string $academyId): object
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $row = DB::table('academy_automation_settings')->where('academy_id', $academyId)->first();
    test()->clearTenantContext();

    return $row;
}

it('reports disconnected for a number that was never paired', function () {
    fakeGateway('connected');
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/academy/whatsapp')
        ->assertOk()
        ->assertJsonPath('state', 'disconnected')
        ->assertJsonPath('qr', null);
});

it('pairs a never-connected academy and stores the gateway token', function () {
    fakeGateway('connected');
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/academy/whatsapp/connect')
        ->assertOk()
        ->assertJsonPath('state', 'qr')
        ->assertJsonPath('qr', 'data:image/png;base64,NEW');

    $row = storedSession($this->academy);
    expect($row->wa_session_id)->toBe('sess-new');
    expect(Crypt::decryptString($row->wasender_token))->toBe('gw-new');
});

it('never replaces a connected number — the "logs out every 2-3 days" bug', function () {
    giveWhatsAppToken($this->academy);
    fakeGateway('connected');
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/academy/whatsapp/connect')
        ->assertOk()
        ->assertJsonPath('state', 'connected')
        ->assertJsonPath('phone', '201090091143');

    expect(createdASession())->toBeFalse();
    expect(storedSession($this->academy)->wa_session_id)->toBe($this->sessionId);
});

it('hands back the QR already showing instead of starting another pairing', function () {
    giveWhatsAppToken($this->academy);
    fakeGateway('qr');
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/academy/whatsapp/connect')
        ->assertOk()
        ->assertJsonPath('state', 'qr')
        ->assertJsonPath('qr', 'data:image/png;base64,LIVE');

    expect(createdASession())->toBeFalse();
});

it('starts a fresh pairing once the old session is logged out or gone', function (string $state) {
    giveWhatsAppToken($this->academy);
    fakeGateway($state);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/academy/whatsapp/connect')
        ->assertOk()
        ->assertJsonPath('qr', 'data:image/png;base64,NEW');

    expect(createdASession())->toBeTrue();
    expect(storedSession($this->academy)->wa_session_id)->toBe('sess-new');
})->with(['logged_out', 'missing']);

it('changes nothing when the gateway is unreachable', function () {
    giveWhatsAppToken($this->academy);
    fakeGateway('down');
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/academy/whatsapp/connect')->assertStatus(502);

    expect(createdASession())->toBeFalse();
    expect(storedSession($this->academy)->wa_session_id)->toBe($this->sessionId);
});

it('shows the linked phone while connected', function () {
    giveWhatsAppToken($this->academy);
    fakeGateway('connected');
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/academy/whatsapp')
        ->assertOk()
        ->assertJsonPath('state', 'connected')
        ->assertJsonPath('phone', '201090091143')
        ->assertJsonPath('last_connected_at', '2026-10-01T18:26:05.000Z');
});

it('lets the academy unlink its number', function () {
    giveWhatsAppToken($this->academy);
    fakeGateway('connected');
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/academy/whatsapp/logout')->assertOk();

    Http::assertSent(fn (Request $r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/sessions/'.$this->sessionId));
    $row = storedSession($this->academy);
    expect($row->wa_session_id)->toBeNull();
    expect($row->wasender_token)->toBeNull();
});

it('is closed to teachers', function () {
    fakeGateway('connected');
    Sanctum::actingAs($this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-wa@test.local']));

    $this->getJson('/api/academy/whatsapp')->assertForbidden();
    $this->postJson('/api/academy/whatsapp/connect')->assertForbidden();
});

it('does not exist for a client without the WhatsApp module', function () {
    $other = $this->createAcademy(modules: ['MANAGEMENT']);
    fakeGateway('connected');
    Sanctum::actingAs($this->makeUser($other, 'ACADEMY_OWNER', ['email' => 'owner-nowa@test.local']));

    $this->postJson('/api/academy/whatsapp/connect')->assertStatus(402);
    expect(createdASession())->toBeFalse();
});

it('ignores a replaced session reporting itself logged out', function () {
    config()->set('services.whatsapp_gateway.webhook_secret', 'webhook-secret-for-tests');
    giveWhatsAppToken($this->academy);
    $post = function (string $sessionId, string $state) {
        $body = json_encode(['event' => 'connection.update', 'academyId' => $this->academy, 'sessionId' => $sessionId, 'data' => ['state' => $state]]);

        return $this->call('POST', '/api/internal/wa/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_WA_SIGNATURE' => 'sha256='.hash_hmac('sha256', $body, 'webhook-secret-for-tests'),
        ], $body);
    };

    $post('sess-old', 'logged_out')->assertOk();
    expect(storedSession($this->academy)->wasender_session_status)->toBe('connected');

    $post($this->sessionId, 'logged_out')->assertOk();
    expect(storedSession($this->academy)->wasender_session_status)->toBe('LOGGED_OUT');
});
