<?php

declare(strict_types=1);

use App\Services\Livekit\Jwt;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * S3 — supervisor / monitor mode (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §5). The monitor
 * link mints a HIDDEN LiveKit participant (subscribe-only, invisible) for a logged-in user holding
 * room.monitor, on a monitor-enabled room. Entry overrides the auth-host default, is always audited,
 * writes no attendance row, and (covert mode) hides disclosure + suppresses the recording indicator.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    config([
        'services.livekit.host' => 'wss://media.test',
        'services.livekit.api_url' => 'https://media.test',
        'services.livekit.api_key' => 'devkey',
        'services.livekit.api_secret' => str_repeat('s', 40),
        'services.livekit.token_ttl' => 900,
    ]);

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER'); // holds room.monitor
    $this->proTeacher = $this->makeUser($this->pro, 'TEACHER');     // does NOT hold room.monitor
});

/**
 * @param  array<string,mixed>  $config
 * @return array{id: string, join_token: string, monitor_token: string, livekit_name: string}
 */
function seedMonitorRoom(string $academyId, array $config = []): array
{
    $id = (string) Str::uuid();
    $row = [
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Monitor',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => Str::random(24),
        'host_token' => Str::random(40),
        'monitor_token' => Str::random(40),
        'config' => json_encode($config),
    ];

    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert($row);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return ['id' => $id, 'join_token' => $row['join_token'], 'monitor_token' => $row['monitor_token'], 'livekit_name' => $row['livekit_name']];
}

// ── hidden grant + precedence ────────────────────────────────────────────────────────
it('mints a hidden subscribe-only token and overrides the auth-host default', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]);
    Sanctum::actingAs($this->proOwner); // an owner is normally a host — the monitor link wins

    $res = $this->postJson("/api/video/join/{$room['monitor_token']}")->assertOk();

    expect($res->json('role'))->toBe('monitor');
    expect($res->json('identity'))->toBe((string) $this->proOwner->getKey());
    expect($res->json('canManage'))->toBeFalse();

    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['hidden'] ?? false)->toBeTrue();
    expect($claims['video']['canSubscribe'] ?? false)->toBeTrue();
    expect($claims['video']['canPublish'] ?? true)->toBeFalse();
    expect(json_decode($claims['metadata'], true)['role'])->toBe('monitor');
});

// ── gates ──────────────────────────────────────────────────────────────────────────
it('requires login to use the monitor link', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]);

    $this->postJson("/api/video/join/{$room['monitor_token']}")
        ->assertStatus(401)->assertJsonPath('code', 'login_required');
});

it('forbids a user without room.monitor', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]);
    Sanctum::actingAs($this->proTeacher);

    $this->postJson("/api/video/join/{$room['monitor_token']}")
        ->assertStatus(403)->assertJsonPath('code', 'monitor_forbidden');
});

it('rejects monitoring a room that is not monitor-enabled', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => false]);
    Sanctum::actingAs($this->proOwner);

    $this->postJson("/api/video/join/{$room['monitor_token']}")
        ->assertStatus(403)->assertJsonPath('code', 'monitor_disabled');
});

// ── audit + ghost (no attendance) ────────────────────────────────────────────────────
it('audits the monitor entry and writes no attendance row', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]);
    Sanctum::actingAs($this->proOwner);

    $this->postJson("/api/video/join/{$room['monitor_token']}")->assertOk();

    $this->asAcademy($this->pro);
    $audited = DB::table('audit_log')
        ->where('action', 'video_room.monitor_join')
        ->where('entity_id', $room['id'])
        ->where('actor_user_id', (string) $this->proOwner->getKey())
        ->exists();
    expect($audited)->toBeTrue();
    expect(DB::table('room_participants')->where('room_id', $room['id'])->count())->toBe(0);
});

// ── monitor_token exposure (room.monitor only) ───────────────────────────────────────
it('exposes monitor_token to a manager but not a plain teacher', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]);

    Sanctum::actingAs($this->proOwner);
    $asOwner = $this->getJson("/api/video/rooms/{$room['id']}")->assertOk()->json('room');
    expect($asOwner['monitor_token'])->toBeString()->not->toBeEmpty();

    Sanctum::actingAs($this->proTeacher);
    $asTeacher = $this->getJson("/api/video/rooms/{$room['id']}")->assertOk()->json('room');
    expect($asTeacher)->not->toHaveKey('monitor_token');
});

// ── disclosure vs covert (guest-facing flags) ────────────────────────────────────────
it('discloses monitoring to a guest by default', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]); // monitor_disclose defaults true

    $res = $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->assertOk();
    expect($res->json('monitorDisclosure'))->toBeTrue();
    expect($res->json('suppressRecordingIndicator'))->toBeFalse();
});

it('hides disclosure and suppresses the recording indicator in covert mode', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true, 'monitor_disclose' => false]);

    $res = $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->assertOk();
    expect($res->json('monitorDisclosure'))->toBeFalse();
    expect($res->json('suppressRecordingIndicator'))->toBeTrue();
});

// ── rotate the monitor link (room.monitor) ───────────────────────────────────────────
it('rotates the monitor link for a manager and kills the old one', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]);
    Sanctum::actingAs($this->proOwner);

    $fresh = $this->postJson("/api/video/rooms/{$room['id']}/rotate-link", ['which' => 'monitor'])
        ->assertOk()->json('token');
    expect($fresh)->not->toBe($room['monitor_token']);

    $this->postJson("/api/video/join/{$room['monitor_token']}")->assertNotFound();
    $this->postJson("/api/video/join/{$fresh}")->assertOk()->assertJsonPath('role', 'monitor');
});

it('forbids a teacher from rotating the monitor link', function () {
    $room = seedMonitorRoom($this->pro, ['monitor_enabled' => true]);
    Sanctum::actingAs($this->proTeacher);

    $this->postJson("/api/video/rooms/{$room['id']}/rotate-link", ['which' => 'monitor'])->assertForbidden();
});
