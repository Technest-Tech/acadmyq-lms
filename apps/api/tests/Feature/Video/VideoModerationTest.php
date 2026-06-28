<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Host moderation (V-CTL-1). mute / remove / end are room.manage-only, server-mediated SFU admin
 * actions; RLS scopes the room to the caller's academy so cross-tenant moderation 404s.
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
    Http::fake([
        'media.test/twirp/livekit.RoomService/ListParticipants' => Http::response([
            'participants' => [
                ['identity' => 'guest-x', 'tracks' => [
                    ['sid' => 'TR_aud', 'type' => 'AUDIO'],
                    ['sid' => 'TR_cam', 'type' => 'VIDEO', 'source' => 'CAMERA'],
                ]],
            ],
        ]),
        'media.test/*' => Http::response([]),
    ]);

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->owner = $this->makeUser($this->pro, 'ACADEMY_OWNER');   // room.manage
    $this->teacher = $this->makeUser($this->pro, 'TEACHER');       // NOT room.manage
    $this->other = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->otherOwner = $this->makeUser($this->other, 'ACADEMY_OWNER');
});

function makeModRoom(string $academyId): array
{
    $id = (string) Str::uuid();
    $livekit = 'r-'.substr($id, 0, 8).'__'.$academyId;
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Mod room',
        'livekit_name' => $livekit,
        'join_token' => Str::random(24),
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return ['id' => $id, 'livekit_name' => $livekit];
}

it('a host mutes a participant (looks up the mic track, then MutePublishedTrack)', function () {
    $room = makeModRoom($this->pro);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/video/rooms/{$room['id']}/participants/guest-x/mute")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'MutePublishedTrack')
        && $r['identity'] === 'guest-x' && $r['track_sid'] === 'TR_aud' && $r['muted'] === true);
});

it('a host stops a participant video (looks up the camera track, never the screen-share)', function () {
    $room = makeModRoom($this->pro);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/video/rooms/{$room['id']}/participants/guest-x/mute-video")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'MutePublishedTrack')
        && $r['identity'] === 'guest-x' && $r['track_sid'] === 'TR_cam' && $r['muted'] === true);
});

it('a host removes a participant', function () {
    $room = makeModRoom($this->pro);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/video/rooms/{$room['id']}/participants/guest-x/remove")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'RemoveParticipant')
        && $r['room'] === $room['livekit_name'] && $r['identity'] === 'guest-x');
});

it('a host ends the call for everyone (DeleteRoom)', function () {
    $room = makeModRoom($this->pro);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/video/rooms/{$room['id']}/end")
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'DeleteRoom') && $r['room'] === $room['livekit_name']);
});

it('forbids a teacher (no room.manage) from moderating', function () {
    $room = makeModRoom($this->pro);
    Sanctum::actingAs($this->teacher);

    $this->postJson("/api/video/rooms/{$room['id']}/participants/guest-x/mute")->assertForbidden();
    $this->postJson("/api/video/rooms/{$room['id']}/participants/guest-x/remove")->assertForbidden();
    $this->postJson("/api/video/rooms/{$room['id']}/end")->assertForbidden();
});

it('404s moderation of another academy\'s room (RLS isolation)', function () {
    $room = makeModRoom($this->other);
    Sanctum::actingAs($this->owner); // owner of $this->pro, not $this->other

    $this->postJson("/api/video/rooms/{$room['id']}/end")->assertNotFound();
});
