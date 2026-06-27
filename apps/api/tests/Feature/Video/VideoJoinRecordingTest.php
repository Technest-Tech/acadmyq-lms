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
 * R1 — the join-by-link response carries `roomId` + `canRecord` so the browser call client can show
 * the in-call record control to hosts ONLY (the start/stop endpoints gate on room.manage). A guest,
 * and a teacher who lacks room.manage, must get canRecord=false.
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
    $this->owner = $this->makeUser($this->pro, 'ACADEMY_OWNER');   // room.manage
    $this->teacher = $this->makeUser($this->pro, 'TEACHER');       // room.join, NOT room.manage
});

/** Seed a room under its academy's RLS context; return id + join token. */
function makeRecRoom(string $academyId): array
{
    $id = (string) Str::uuid();
    $token = Str::random(24);
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Rec link room',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => $token,
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return ['id' => $id, 'token' => $token];
}

it('exposes roomId and canRecord=true for a host with room.manage', function () {
    $room = makeRecRoom($this->pro);
    Sanctum::actingAs($this->owner);

    $res = $this->postJson("/api/video/join/{$room['token']}")->assertOk();

    expect($res->json('role'))->toBe('host');
    expect($res->json('roomId'))->toBe($room['id']);
    expect($res->json('canRecord'))->toBeTrue();
});

it('returns canRecord=false for a host without room.manage (teacher)', function () {
    $room = makeRecRoom($this->pro);
    Sanctum::actingAs($this->teacher);

    $res = $this->postJson("/api/video/join/{$room['token']}")->assertOk();

    expect($res->json('role'))->toBe('host');
    expect($res->json('roomId'))->toBe($room['id']);
    expect($res->json('canRecord'))->toBeFalse();
});

it('returns canRecord=false for an anonymous guest', function () {
    $room = makeRecRoom($this->pro);

    $res = $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Yusuf'])->assertOk();

    expect($res->json('role'))->toBe('guest');
    expect($res->json('canRecord'))->toBeFalse();
});
