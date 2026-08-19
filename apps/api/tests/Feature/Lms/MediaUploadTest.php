<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\LmsMedia;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * LMS phase 3 (v0) — uploaded-video VOD (docs/lms/04). Presigned/​signed reserve → upload → confirm
 * READY, the plan storage cap, and enrollment-gated signed playback. The media disk is faked as a
 * `local` (non-presigning) disk, so delivery goes through the signed proxy routes — the same path a
 * storage-less dev box takes, and the branch that is testable without object storage.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // A local media disk → LmsMedia mints signed proxy URLs (no S3 presign in tests).
    Storage::fake('lms_media');
    config([
        'lms.media.disk' => 'lms_media',
        'filesystems.disks.lms_media.driver' => 'local',
    ]);

    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    // subdomain (SUPER_ADMIN-set) is provisioned at creation so the learner-site tests can resolve it.
    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'vodsite']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
});

/** Reserve → put bytes → confirm READY; returns the media_asset id (acts as the current Sanctum user). */
function makeReadyAsset(string $academyId, string $kind = 'VIDEO', int $size = 2048, string $filename = 'lesson.mp4'): string
{
    $t = test();
    $assetId = $t->postJson('/api/courses/media/upload-url', [
        'filename' => $filename,
        'content_type' => $kind === 'VIDEO' ? 'video/mp4' : 'audio/mpeg',
        'kind' => $kind,
        'size_bytes' => $size,
    ])->assertCreated()->json('mediaAssetId');

    $ext = pathinfo($filename, PATHINFO_EXTENSION);
    Storage::disk('lms_media')->put("lms/{$academyId}/{$assetId}/source.{$ext}", str_repeat('x', $size));

    $t->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()->assertJsonPath('status', 'READY');

    return $assetId;
}

// ── reserve → confirm READY ──────────────────────────────────────────────────
it('reserves an upload target, then confirms the object READY', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'intro.mp4', 'content_type' => 'video/mp4', 'kind' => 'VIDEO', 'size_bytes' => 4096,
    ])->assertCreated();

    $assetId = $res->json('mediaAssetId');
    expect($res->json('upload.method'))->toBe('PUT');
    expect($res->json('upload.url'))->toBeString()->not->toBe('');
    $this->getJson("/api/courses/media/{$assetId}")->assertOk()->assertJsonPath('status', 'PENDING');

    // The client uploads the file, then confirms — the actual size is reconciled from storage.
    Storage::disk('lms_media')->put("lms/{$this->academy}/{$assetId}/source.mp4", str_repeat('x', 4096));
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()
        ->assertJsonPath('status', 'READY')->assertJsonPath('size_bytes', 4096);

    $this->getJson("/api/courses/media/{$assetId}")->assertOk()->assertJsonPath('status', 'READY');

    // playback_path is set to the source object (v0 serves it directly).
    $this->asAcademy($this->academy);
    expect(DB::table('media_assets')->where('id', $assetId)->value('playback_path'))
        ->toBe("lms/{$this->academy}/{$assetId}/source.mp4");
});

// ── the confirm fails (and marks FAILED) when nothing was uploaded ────────────
it('fails the confirm when the object never arrived', function () {
    Sanctum::actingAs($this->owner);
    $assetId = $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'a.mp4', 'content_type' => 'video/mp4', 'kind' => 'VIDEO', 'size_bytes' => 100,
    ])->json('mediaAssetId');

    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertStatus(422);
    $this->getJson("/api/courses/media/{$assetId}")->assertOk()->assertJsonPath('status', 'FAILED');
});

// ── content-type must match the declared kind ────────────────────────────────
it('rejects a content-type that does not match the kind', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'x.mp3', 'content_type' => 'audio/mpeg', 'kind' => 'VIDEO', 'size_bytes' => 100,
    ])->assertStatus(422);
});

// ── AC: storage cap (402 upgrade prompt at the limit) ────────────────────────
it("returns 402 when the upload would exceed the client's storage cap", function () {
    // A client capped at 1 GB from its profile → a 2 GB upload is refused before any url is handed out.
    $capped = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS']);
    $this->enterAcademyAsSuperAdmin($capped);
    app(ModuleBilling::class)->setLimitOverrides($capped, 'LMS', ['maxStorageGb' => 1]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->makeUser($capped, 'ACADEMY_OWNER'));

    $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'big.mp4', 'content_type' => 'video/mp4', 'kind' => 'VIDEO',
        'size_bytes' => 2 * 1073741824,
    ])->assertStatus(402)->assertJsonPath('code', 'storage_limit_reached');
});

// ── gate: entitled:lms + course.manage ───────────────────────────────────────
it('gates media endpoints by entitlement and capability', function () {
    // A teacher lacks course.manage → 403.
    Sanctum::actingAs($this->makeUser($this->academy, 'TEACHER'));
    $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'x.mp4', 'content_type' => 'video/mp4', 'kind' => 'VIDEO', 'size_bytes' => 100,
    ])->assertStatus(403);

    // An academy without the LMS module → 402.
    $basic = DB::table('plans')->where('code', 'BASIC')->value('id');
    $other = $this->createAcademy();
    Sanctum::actingAs($this->makeUser($other, 'ACADEMY_OWNER'));
    $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'x.mp4', 'content_type' => 'video/mp4', 'kind' => 'VIDEO', 'size_bytes' => 100,
    ])->assertStatus(402);
});

// ── VIDEO_UPLOAD lessons accept a READY asset only, from this academy ─────────
it('attaches a READY upload to a VIDEO_UPLOAD lesson and rejects a bad asset', function () {
    Sanctum::actingAs($this->owner);
    $courseId = $this->postJson('/api/courses', ['title' => 'VOD course'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'S1'])->json('sectionId');

    // READY asset → the lesson is created.
    $ready = makeReadyAsset($this->academy, 'VIDEO');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'VIDEO_UPLOAD', 'title' => 'Lecture', 'media_asset_id' => $ready,
    ])->assertCreated();

    // A not-yet-READY asset → 422.
    $pending = $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'p.mp4', 'content_type' => 'video/mp4', 'kind' => 'VIDEO', 'size_bytes' => 100,
    ])->json('mediaAssetId');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'VIDEO_UPLOAD', 'title' => 'Bad', 'media_asset_id' => $pending,
    ])->assertStatus(422);

    // An audio asset in a VIDEO lesson → 422 (wrong kind).
    $audio = makeReadyAsset($this->academy, 'AUDIO', filename: 'a.mp3');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'VIDEO_UPLOAD', 'title' => 'WrongKind', 'media_asset_id' => $audio,
    ])->assertStatus(422);

    // Another academy's asset is invisible under RLS → 422 (not a leak).
    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $academyB = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS']);
    Sanctum::actingAs($this->makeUser($academyB, 'ACADEMY_OWNER'));
    $courseB = $this->postJson('/api/courses', ['title' => 'B'])->json('courseId');
    $sectionB = $this->postJson("/api/courses/{$courseB}/sections", ['title' => 'S'])->json('sectionId');
    $this->postJson("/api/courses/{$courseB}/lessons", [
        'section_id' => $sectionB, 'type' => 'VIDEO_UPLOAD', 'title' => 'Steal', 'media_asset_id' => $ready,
    ])->assertStatus(422);
});

// ── learner playback is enrollment-gated + returns a signed url ───────────────
it('serves a signed playback url to an enrolled learner and refuses otherwise', function () {
    Sanctum::actingAs($this->owner);
    $courseId = $this->postJson('/api/courses', ['title' => 'Streamed course'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'S1'])->json('sectionId');
    $asset = makeReadyAsset($this->academy, 'VIDEO');
    $lessonId = $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'VIDEO_UPLOAD', 'title' => 'Lecture', 'media_asset_id' => $asset,
    ])->assertCreated()->json('lessonId');
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    $code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$courseId], 'count' => 1, 'max_redemptions' => 1,
    ])->assertCreated()->json('codes.0.code');
    app()['auth']->forgetGuards();

    $headers = ['X-Academy' => 'vodsite'];
    $token = $this->withHeaders($headers)->postJson('/api/learn/auth/register', [
        'full_name' => 'Vee', 'email' => 'vee@example.com', 'password' => 'password123',
    ])->json('token');
    $auth = $headers + ['Authorization' => "Bearer {$token}"];

    // Not enrolled → the player refuses the media too.
    $this->withHeaders($auth)->getJson("/api/learn/lessons/{$lessonId}/playback")->assertStatus(403);

    // Redeem → enrolled → a signed url comes back.
    $this->withHeaders($auth)->postJson('/api/learn/redeem', ['code' => $code])->assertOk();
    $play = $this->withHeaders($auth)->getJson("/api/learn/lessons/{$lessonId}/playback")->assertOk();
    expect($play->json('kind'))->toBe('VIDEO');
    expect($play->json('url'))->toBeString()->toContain('/lms/media/stream');

    // The signed stream url actually serves the bytes.
    $streamPath = str_replace(config('app.url'), '', $play->json('url'));
    $this->get($streamPath)->assertOk();
});

// ── course cover images (docs/lms/04 §media) ─────────────────────────────────
it('uploads a cover image and serves it as a signed url on the public course site', function () {
    Sanctum::actingAs($this->owner);

    // A cover goes through the SAME reserve → put → confirm pipeline as lesson media.
    $assetId = $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'cover.jpg', 'content_type' => 'image/jpeg', 'kind' => 'IMAGE', 'size_bytes' => 1024,
    ])->assertCreated()->json('mediaAssetId');
    Storage::disk('lms_media')->put("lms/{$this->academy}/{$assetId}/source.jpg", str_repeat('x', 1024));
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()
        ->assertJsonPath('status', 'READY');   // an image never transcodes

    $courseId = $this->postJson('/api/courses', [
        'title' => 'Design', 'cover_media_asset_id' => $assetId,
    ])->assertCreated()->json('courseId');

    // Staff read it back as a loadable url, never the raw storage key.
    $cover = $this->getJson("/api/courses/{$courseId}")->assertOk()->json('course.cover_image_path');
    expect($cover)->toBeString()->toContain('/lms/media/stream');
    expect($cover)->not->toContain('lms/'.$this->academy.'/'.$assetId);

    // A course needs a lesson before it can be published (and thus appear in the catalogue).
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'Unit 1'])
        ->json('sectionId');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Intro', 'body' => 'hi',
    ])->assertCreated();

    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();
    app()['auth']->forgetGuards();

    // And the PUBLIC catalogue — no learner auth at all — serves a url that really returns bytes.
    $card = collect($this->withHeaders(['X-Academy' => 'vodsite'])
        ->getJson('/api/learn/courses')->assertOk()->json('courses'))->firstWhere('title', 'Design');
    expect($card['cover_image_path'])->toBeString()->toContain('/lms/media/stream');
    $this->get(str_replace(config('app.url'), '', $card['cover_image_path']))->assertOk();
});

it('rejects a non-image file as a cover, and a cover asset that is not READY', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'clip.mp4', 'content_type' => 'video/mp4', 'kind' => 'IMAGE', 'size_bytes' => 1024,
    ])->assertStatus(422);

    // Reserved but never uploaded → still PENDING, so it cannot become a cover.
    $pending = $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'cover.png', 'content_type' => 'image/png', 'kind' => 'IMAGE', 'size_bytes' => 512,
    ])->assertCreated()->json('mediaAssetId');

    $this->postJson('/api/courses', ['title' => 'Nope', 'cover_media_asset_id' => $pending])
        ->assertStatus(422);
});

it('keeps a plain url cover working and leaves the cover alone when not sent', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', [
        'title' => 'Pasted', 'cover_image_path' => 'https://cdn.example.com/a.jpg',
    ])->assertCreated()->json('courseId');

    // A url is stored and returned untouched — no signing, no rewriting.
    expect($this->getJson("/api/courses/{$courseId}")->json('course.cover_image_path'))
        ->toBe('https://cdn.example.com/a.jpg');

    // A patch that says nothing about the cover must not clear it.
    $this->patchJson("/api/courses/{$courseId}", ['title' => 'Renamed'])->assertOk();
    expect($this->getJson("/api/courses/{$courseId}")->json('course.cover_image_path'))
        ->toBe('https://cdn.example.com/a.jpg');
});

// ── presigned uploads must not hand the browser headers it refuses to set ────
it('strips browser-forbidden headers from a presigned upload target', function () {
    // The rest of the suite fakes a `local` disk, so this is the only cover for the S3 branch.
    config([
        'lms.media.disk' => 'lms_media',
        'filesystems.disks.lms_media.driver' => 's3',
    ]);

    $disk = Mockery::mock();
    $disk->shouldReceive('temporaryUploadUrl')->once()->andReturn([
        'url' => 'https://objects.test/lms/a/b/source.jpg?X-Amz-Signature=abc',
        // S3 presigning hands `Host` back; XHR throws "Refused to set unsafe header" on it.
        'headers' => ['Host' => 'objects.test', 'Content-Type' => 'image/jpeg'],
    ]);
    Storage::shouldReceive('disk')->with('lms_media')->andReturn($disk);

    $target = LmsMedia::uploadTarget('lms/a/b/source.jpg', 'image/jpeg');

    expect($target['headers'])->toHaveKey('Content-Type');   // the signed value survives
    expect($target['headers'])->not->toHaveKey('Host');      // the unsettable one is gone
    expect($target['url'])->toContain('X-Amz-Signature');
});
