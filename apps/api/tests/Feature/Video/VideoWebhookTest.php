<?php

declare(strict_types=1);

use App\Jobs\PurgeExpiredRecordingsJob;
use App\Services\Livekit\Jwt;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Phase 1 — LiveKit webhook ingestion (docs/video-platform/05-ROADMAP). AC-V1.6 (signed accepted,
 * tampered/absent rejected, idempotent) and AC-V1.7 (egress_ended finalises the recording linked to
 * its room). The webhook carries no tenant context — the controller resolves the academy from the
 * `__<academyId>` suffix in the room name and writes inside Tenancy::withContext.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    config([
        'services.livekit.host' => 'wss://media.test',
        'services.livekit.api_url' => 'https://media.test',
        'services.livekit.api_key' => 'devkey',
        'services.livekit.api_secret' => str_repeat('s', 40),
    ]);
    Http::fake();

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->owner = $this->makeUser($this->pro, 'ACADEMY_OWNER');

    // Create a room through the API so it gets a real `__<academyId>` livekit_name.
    Sanctum::actingAs($this->owner);
    $this->roomId = $this->postJson('/api/video/rooms', ['name' => 'Rec room'])->json('roomId');
    $this->asAcademy($this->pro);
    $this->livekitName = (string) DB::table('video_rooms')->where('id', $this->roomId)->value('livekit_name');
    $this->clearTenantContext();
});

/** Build a correctly-signed LiveKit webhook: [rawBody, authToken]. */
function signLivekit(array $payload): array
{
    $body = (string) json_encode($payload);
    $secret = (string) config('services.livekit.api_secret');
    $token = Jwt::encode([
        'iss' => (string) config('services.livekit.api_key'),
        'exp' => time() + 60,
        'sha256' => base64_encode(hash('sha256', $body, true)),
    ], $secret);

    return [$body, $token];
}

function postLivekitWebhook(string $body, ?string $token): TestResponse
{
    $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
    if ($token !== null) {
        $server['HTTP_AUTHORIZATION'] = $token;
    }

    return test()->call('POST', '/api/internal/livekit/webhook', [], [], [], $server, $body);
}

// ── AC-V1.6: a correctly-signed webhook is accepted ───────────────────────────────
it('accepts a correctly signed webhook', function () {
    [$body, $token] = signLivekit(['event' => 'room_finished', 'room' => ['name' => $this->livekitName]]);
    postLivekitWebhook($body, $token)->assertOk()->assertJsonPath('ok', true);
});

// ── AC-V1.6: a tampered body or a missing token is rejected with 401 ──────────────
it('rejects a tampered body and a missing token', function () {
    [$body, $token] = signLivekit(['event' => 'room_finished', 'room' => ['name' => $this->livekitName]]);

    postLivekitWebhook($body.'tampered', $token)->assertStatus(401);
    postLivekitWebhook($body, null)->assertStatus(401);
    postLivekitWebhook($body, 'not-a-jwt')->assertStatus(401);
});

// ── AC-V1.7: egress_ended finalises the recording, idempotently ───────────────────
it('finalises a recording on egress_ended and is idempotent on duplicate delivery', function () {
    // A STARTING recording awaiting its egress webhook.
    $this->asAcademy($this->pro);
    DB::table('room_recordings')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->pro,
        'room_id' => $this->roomId,
        'egress_id' => 'EG_test123',
        'status' => 'STARTING',
        'started_at' => now(),
    ]);
    $this->clearTenantContext();

    [$body, $token] = signLivekit([
        'event' => 'egress_ended',
        'egressInfo' => [
            'egress_id' => 'EG_test123',
            'room_name' => $this->livekitName,
            'status' => 'EGRESS_COMPLETE',
            'file' => ['location' => 's3://recordings/x.mp4', 'size' => 1048576, 'duration' => 60_000_000_000],
        ],
    ]);

    // Deliver twice — the second is a harmless re-write (idempotent by egress_id).
    postLivekitWebhook($body, $token)->assertOk();
    postLivekitWebhook($body, $token)->assertOk();

    $this->asAcademy($this->pro);
    $rec = DB::table('room_recordings')->where('egress_id', 'EG_test123')->get();
    expect($rec)->toHaveCount(1);
    expect($rec[0]->status)->toBe('COMPLETED');
    expect($rec[0]->duration_s)->toBe(60);
    expect($rec[0]->storage_key)->toBe('s3://recordings/x.mp4');
});

// ── participant join/leave history ────────────────────────────────────────────────
it('records participant join then leave history', function () {
    [$jb, $jt] = signLivekit([
        'event' => 'participant_joined',
        'room' => ['name' => $this->livekitName],
        'participant' => ['identity' => 'student-1', 'name' => 'Yusuf'],
    ]);
    postLivekitWebhook($jb, $jt)->assertOk();

    $this->asAcademy($this->pro);
    $row = DB::table('room_participants')->where('room_id', $this->roomId)->where('identity', 'student-1')->first();
    expect($row)->not->toBeNull();
    expect($row->left_at)->toBeNull();
    $this->clearTenantContext();

    [$lb, $lt] = signLivekit([
        'event' => 'participant_left',
        'room' => ['name' => $this->livekitName],
        'participant' => ['identity' => 'student-1'],
    ]);
    postLivekitWebhook($lb, $lt)->assertOk();

    $this->asAcademy($this->pro);
    expect(DB::table('room_participants')->where('room_id', $this->roomId)->where('identity', 'student-1')->value('left_at'))->not->toBeNull();
});

// ── recording retention purge job removes only expired COMPLETED recordings ───────
it('purges only expired completed recordings', function () {
    $this->asAcademy($this->pro);
    $expired = (string) Str::uuid();
    $fresh = (string) Str::uuid();
    DB::table('room_recordings')->insert([
        ['id' => $expired, 'academy_id' => $this->pro, 'room_id' => $this->roomId, 'status' => 'COMPLETED', 'expires_at' => now()->subDay()],
        ['id' => $fresh, 'academy_id' => $this->pro, 'room_id' => $this->roomId, 'status' => 'COMPLETED', 'expires_at' => now()->addDay()],
    ]);
    $this->clearTenantContext();

    (new PurgeExpiredRecordingsJob($this->pro))->handle();

    $this->asAcademy($this->pro);
    expect(DB::table('room_recordings')->where('id', $expired)->exists())->toBeFalse();
    expect(DB::table('room_recordings')->where('id', $fresh)->exists())->toBeTrue();
});
