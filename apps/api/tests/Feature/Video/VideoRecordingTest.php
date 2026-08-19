<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * R2 — recording playback. GET /api/video/recordings/{id}/url returns a short-lived presigned URL
 * for a COMPLETED recording (gated by recording.view), RLS-scoped to the caller's academy so a
 * recording from another tenant simply 404s (V-SEC-2: storage is signed-URL only).
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
    $this->owner = $this->makeUser($this->pro, 'ACADEMY_OWNER');
    $this->other = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
});

function seedRecording(string $academyId, string $status, ?string $key): string
{
    $roomId = (string) Str::uuid();
    $recId = (string) Str::uuid();
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert([
        'id' => $roomId,
        'academy_id' => $academyId,
        'name' => 'Rec',
        'livekit_name' => 'r-'.substr($roomId, 0, 8).'__'.$academyId,
        'join_token' => Str::random(24),
    ]);
    DB::table('room_recordings')->insert([
        'id' => $recId,
        'academy_id' => $academyId,
        'room_id' => $roomId,
        'status' => $status,
        'storage_key' => $key,
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return $recId;
}

it('returns a presigned url for a completed recording', function () {
    $id = seedRecording($this->pro, 'COMPLETED', 'recordings/x.mp4');

    // Swap only the recordings disk for a mock (no MinIO needed in the test).
    $disk = Mockery::mock(Filesystem::class);
    $disk->shouldReceive('temporaryUrl')->once()
        ->withArgs(fn ($key) => $key === 'recordings/x.mp4')
        ->andReturn('https://signed.example/x.mp4');
    Storage::set('video_recordings', $disk);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/video/recordings/{$id}/url")
        ->assertOk()
        ->assertJsonPath('url', 'https://signed.example/x.mp4');
});

it('404s a recording that is not completed', function () {
    $id = seedRecording($this->pro, 'RECORDING', 'recordings/x.mp4');

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/video/recordings/{$id}/url")->assertNotFound();
});

it('404s a recording from another academy (RLS isolation)', function () {
    $id = seedRecording($this->other, 'COMPLETED', 'recordings/x.mp4');

    Sanctum::actingAs($this->owner); // owner of $this->pro, not $this->other
    $this->getJson("/api/video/recordings/{$id}/url")->assertNotFound();
});

// ── delete (management action) ────────────────────────────────────────────────────────
it('deletes a recording: removes the stored object and the row (room.manage)', function () {
    $id = seedRecording($this->pro, 'COMPLETED', 'recordings/x.mp4');

    $disk = Mockery::mock(Filesystem::class);
    $disk->shouldReceive('delete')->once()
        ->withArgs(fn ($key) => $key === 'recordings/x.mp4')
        ->andReturnTrue();
    Storage::set('video_recordings', $disk);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/video/recordings/{$id}")->assertOk()->assertJsonPath('ok', true);

    $this->asAcademy($this->pro);
    expect(DB::table('room_recordings')->where('id', $id)->exists())->toBeFalse();
});

it('forbids a teacher (recording.view but not room.manage) from deleting', function () {
    $teacher = $this->makeUser($this->pro, 'TEACHER');
    $id = seedRecording($this->pro, 'COMPLETED', 'recordings/x.mp4');

    Sanctum::actingAs($teacher);
    $this->deleteJson("/api/video/recordings/{$id}")->assertForbidden();

    $this->asAcademy($this->pro);
    expect(DB::table('room_recordings')->where('id', $id)->exists())->toBeTrue();
});

it('404s deleting a recording from another academy (RLS isolation)', function () {
    $id = seedRecording($this->other, 'COMPLETED', 'recordings/x.mp4');

    Sanctum::actingAs($this->owner); // owner of $this->pro, not $this->other
    $this->deleteJson("/api/video/recordings/{$id}")->assertNotFound();
});
