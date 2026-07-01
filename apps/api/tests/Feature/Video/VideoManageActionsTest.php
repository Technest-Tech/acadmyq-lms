<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * No-login host actions (08-ROOM-ACCESS §13.5). An unregistered teacher controls the class from the
 * HOST LINK alone — possession of the room's host_token is the authority, no account, no session.
 * Covers moderation (mute / remove / end) and recording (start / stop), plus that a guest/monitor
 * token is rejected the same way (manage_forbidden, no enumeration).
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    config([
        'services.livekit.host' => 'wss://media.test',
        'services.livekit.api_url' => 'https://media.test',
        'services.livekit.api_key' => 'devkey',
        'services.livekit.api_secret' => str_repeat('s', 40),
        'services.livekit.recording_retention_days' => 90,
    ]);
    Http::fake([
        'media.test/twirp/livekit.RoomService/ListParticipants' => Http::response([
            'participants' => [
                ['identity' => 'guest-x', 'tracks' => [['sid' => 'TR_aud', 'type' => 'AUDIO']]],
            ],
        ]),
        'media.test/twirp/livekit.Egress/StartRoomCompositeEgress' => Http::response(['egress_id' => 'EG_123']),
        'media.test/*' => Http::response([]),
    ]);

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
});

/**
 * @param  array<string,mixed>  $config
 * @return array{id: string, join_token: string, host_token: string, monitor_token: string, livekit_name: string}
 */
function seedManageRoom(string $academyId, array $config = []): array
{
    $id = (string) Str::uuid();
    $row = [
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Manage',
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

    return [
        'id' => $id,
        'join_token' => $row['join_token'],
        'host_token' => $row['host_token'],
        'monitor_token' => $row['monitor_token'],
        'livekit_name' => $row['livekit_name'],
    ];
}

// ── moderation via the host link (no login) ──────────────────────────────────────────
it('mutes a participant via the host link with no login', function () {
    $room = seedManageRoom($this->pro);

    $this->postJson("/api/video/manage/{$room['host_token']}/participants/guest-x/mute")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'MutePublishedTrack')
        && $r['identity'] === 'guest-x' && $r['track_sid'] === 'TR_aud' && $r['muted'] === true);
});

it('removes a participant via the host link with no login', function () {
    $room = seedManageRoom($this->pro);

    $this->postJson("/api/video/manage/{$room['host_token']}/participants/guest-x/remove")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'RemoveParticipant') && $r['identity'] === 'guest-x');
});

it('ends the call for all via the host link with no login', function () {
    $room = seedManageRoom($this->pro);

    $this->postJson("/api/video/manage/{$room['host_token']}/end")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'DeleteRoom'));
});

it('audits a host-link moderation action as a link actor (no user)', function () {
    $room = seedManageRoom($this->pro);

    $this->postJson("/api/video/manage/{$room['host_token']}/participants/guest-x/remove")->assertOk();

    $this->asAcademy($this->pro);
    $row = DB::table('audit_log')->where('action', 'video.participant_removed')->where('entity_id', $room['id'])->first();
    expect($row)->not->toBeNull();
    expect($row->actor_user_id)->toBeNull();
    expect($row->actor_role)->toBe('HOST_LINK');
});

// ── recording via the host link (no login) ───────────────────────────────────────────
it('starts a recording via the host link with no login', function () {
    $room = seedManageRoom($this->pro, ['recording_enabled' => true]);

    $recId = $this->postJson("/api/video/manage/{$room['host_token']}/recording")
        ->assertCreated()->json('recordingId');

    // Record with the "speaker" layout so a screen share is pinned full-frame with the cameras as
    // thumbnails (not LiveKit's default "grid", which tiles share + camera 50/50).
    Http::assertSent(fn ($r) => str_contains($r->url(), 'StartRoomCompositeEgress') && $r['layout'] === 'speaker');

    $this->asAcademy($this->pro);
    $rec = DB::table('room_recordings')->where('id', $recId)->first();
    expect($rec)->not->toBeNull();
    expect($rec->room_id)->toBe($room['id']);
    expect($rec->status)->toBe('STARTING');
    expect($rec->egress_id)->toBe('EG_123');
});

it('honours the per-room recording gate on the host-link start', function () {
    $room = seedManageRoom($this->pro, ['recording_enabled' => false]);

    $this->postJson("/api/video/manage/{$room['host_token']}/recording")->assertForbidden();
});

it('stops the active recording via the host link with no login', function () {
    $room = seedManageRoom($this->pro, ['recording_enabled' => true]);
    $recId = $this->postJson("/api/video/manage/{$room['host_token']}/recording")->json('recordingId');

    $this->deleteJson("/api/video/manage/{$room['host_token']}/recording")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'StopEgress') && $r['egress_id'] === 'EG_123');
    expect($recId)->toBeString();
});

// ── only the host token is a manage credential ───────────────────────────────────────
it('rejects a guest or monitor token for host actions (manage_forbidden)', function () {
    $room = seedManageRoom($this->pro, ['recording_enabled' => true]);

    foreach ([$room['join_token'], $room['monitor_token'], Str::random(40)] as $bad) {
        $this->postJson("/api/video/manage/{$bad}/participants/guest-x/mute")
            ->assertStatus(403)->assertJsonPath('code', 'manage_forbidden');
        $this->postJson("/api/video/manage/{$bad}/recording")
            ->assertStatus(403)->assertJsonPath('code', 'manage_forbidden');
    }
});
