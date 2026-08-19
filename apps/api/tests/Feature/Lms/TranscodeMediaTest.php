<?php

declare(strict_types=1);

use App\Jobs\TranscodeMediaJob;
use App\Support\Lms\HlsTranscoder;
use App\Support\Lms\TranscodeResult;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * LMS phase 3b — HLS transcode (docs/lms/04 §VOD). The ffmpeg shell-out is integration-only, so this
 * exercises the WIRING with a faked queue + a fake {@see HlsTranscoder} on a `local` media disk (the
 * signed-proxy branch): a confirmed VIDEO enqueues the job and goes PROCESSING; the job downloads →
 * transcodes → uploads the ladder → READY + hls_manifest_key, dropping the source; and the manifest
 * delivery route rewrites each child URI to its own signed URL for hls.js.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    Storage::fake('lms_media');
    config([
        'lms.media.disk' => 'lms_media',
        'filesystems.disks.lms_media.driver' => 'local',
        'lms.media.transcode' => true,   // phase-3b path on; one test flips it off to prove the v0 branch
    ]);

    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'vodsite']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
});

/** Reserve a VIDEO asset and land its source bytes (does NOT confirm). Returns the media_asset id. */
function reserveVideo(string $academyId, int $size = 4096, string $filename = 'lesson.mp4'): string
{
    $t = test();
    $assetId = $t->postJson('/api/courses/media/upload-url', [
        'filename' => $filename, 'content_type' => 'video/mp4', 'kind' => 'VIDEO', 'size_bytes' => $size,
    ])->assertCreated()->json('mediaAssetId');

    $ext = pathinfo($filename, PATHINFO_EXTENSION);
    Storage::disk('lms_media')->put("lms/{$academyId}/{$assetId}/source.{$ext}", str_repeat('x', $size));

    return $assetId;
}

/** A fake transcoder that writes a two-level HLS playlist (master → variant → segment) to $outDir. */
function fakeHlsTranscoder(int $duration = 42): HlsTranscoder
{
    return new class($duration) implements HlsTranscoder
    {
        public function __construct(private int $duration) {}

        public function transcode(string $sourcePath, string $outDir): TranscodeResult
        {
            file_put_contents("{$outDir}/master.m3u8",
                "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nv0.m3u8\n");
            file_put_contents("{$outDir}/v0.m3u8",
                "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6.000,\nv0_000.ts\n#EXT-X-ENDLIST\n");
            file_put_contents("{$outDir}/v0_000.ts", 'FAKE-TS-BYTES');

            return new TranscodeResult('master.m3u8', $this->duration);
        }
    };
}

// ── dispatch wiring ───────────────────────────────────────────────────────────
it('enqueues a transcode job and marks a confirmed VIDEO upload PROCESSING', function () {
    Sanctum::actingAs($this->owner);
    Queue::fake();

    $assetId = reserveVideo($this->academy);
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()->assertJsonPath('status', 'PROCESSING');
    $this->getJson("/api/courses/media/{$assetId}")->assertOk()->assertJsonPath('status', 'PROCESSING');

    Queue::assertPushed(TranscodeMediaJob::class);
});

// ── audio never transcodes, even with transcode on ────────────────────────────
it('does not transcode uploaded audio', function () {
    Sanctum::actingAs($this->owner);
    Queue::fake();

    $assetId = $this->postJson('/api/courses/media/upload-url', [
        'filename' => 'a.mp3', 'content_type' => 'audio/mpeg', 'kind' => 'AUDIO', 'size_bytes' => 2048,
    ])->json('mediaAssetId');
    Storage::disk('lms_media')->put("lms/{$this->academy}/{$assetId}/source.mp3", str_repeat('x', 2048));

    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()->assertJsonPath('status', 'READY');
    Queue::assertNotPushed(TranscodeMediaJob::class);
});

// ── transcode off = the v0 progressive-READY path (unchanged) ─────────────────
it('keeps the v0 progressive path when transcode is disabled', function () {
    config(['lms.media.transcode' => false]);
    Sanctum::actingAs($this->owner);
    Queue::fake();

    $assetId = reserveVideo($this->academy, 4096);
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()->assertJsonPath('status', 'READY');
    Queue::assertNotPushed(TranscodeMediaJob::class);

    $this->asAcademy($this->academy);
    expect(DB::table('media_assets')->where('id', $assetId)->value('playback_path'))
        ->toBe("lms/{$this->academy}/{$assetId}/source.mp4");
});

// ── the job builds the ladder, flips READY, and drops the source ──────────────
it('transcodes to an HLS ladder, sets READY + hls_manifest_key, and deletes the source', function () {
    Sanctum::actingAs($this->owner);
    Queue::fake(); // hold the job so it runs deterministically with the fake transcoder

    $assetId = reserveVideo($this->academy, 5000);
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertJsonPath('status', 'PROCESSING');

    (new TranscodeMediaJob($assetId, $this->academy))->handle(fakeHlsTranscoder(90));

    $this->asAcademy($this->academy);
    $row = DB::table('media_assets')->where('id', $assetId)->first();
    expect($row->status)->toBe('READY');
    expect($row->hls_manifest_key)->toBe("lms/{$this->academy}/{$assetId}/hls/master.m3u8");
    expect($row->playback_path)->toBe("lms/{$this->academy}/{$assetId}/hls/master.m3u8");
    expect((int) $row->duration_seconds)->toBe(90);

    $prefix = "lms/{$this->academy}/{$assetId}/hls";
    expect(Storage::disk('lms_media')->exists("{$prefix}/master.m3u8"))->toBeTrue();
    expect(Storage::disk('lms_media')->exists("{$prefix}/v0_000.ts"))->toBeTrue();
    // source dropped; size reset to the rendition total (the true stored footprint feeding the cap).
    expect(Storage::disk('lms_media')->exists("lms/{$this->academy}/{$assetId}/source.mp4"))->toBeFalse();
    $renditionBytes = collect(['master.m3u8', 'v0.m3u8', 'v0_000.ts'])
        ->sum(fn (string $f) => Storage::disk('lms_media')->size("{$prefix}/{$f}"));
    expect((int) $row->size_bytes)->toBe($renditionBytes);
});

// ── a transcode failure marks the asset FAILED with an error ──────────────────
it('marks the asset FAILED when the transcoder throws', function () {
    Sanctum::actingAs($this->owner);
    Queue::fake();

    $assetId = reserveVideo($this->academy);
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertJsonPath('status', 'PROCESSING');

    $boom = new class implements HlsTranscoder
    {
        public function transcode(string $sourcePath, string $outDir): TranscodeResult
        {
            throw new RuntimeException('ffmpeg exploded');
        }
    };
    (new TranscodeMediaJob($assetId, $this->academy))->handle($boom);

    $this->asAcademy($this->academy);
    $row = DB::table('media_assets')->where('id', $assetId)->first();
    expect($row->status)->toBe('FAILED');
    expect($row->error)->toContain('ffmpeg exploded');
});

// ── the job is idempotent: it no-ops unless the row is still PROCESSING ────────
it('no-ops when the asset is not PROCESSING', function () {
    Sanctum::actingAs($this->owner);
    Queue::fake();

    $assetId = reserveVideo($this->academy);
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertJsonPath('status', 'PROCESSING');
    (new TranscodeMediaJob($assetId, $this->academy))->handle(fakeHlsTranscoder());

    // A second run sees READY, not PROCESSING → returns early WITHOUT invoking the transcoder.
    $neverCalled = new class implements HlsTranscoder
    {
        public function transcode(string $sourcePath, string $outDir): TranscodeResult
        {
            throw new RuntimeException('re-transcoded a READY asset');
        }
    };
    (new TranscodeMediaJob($assetId, $this->academy))->handle($neverCalled);

    $this->asAcademy($this->academy);
    expect(DB::table('media_assets')->where('id', $assetId)->value('status'))->toBe('READY');
});

// ── enrolled learner streams HLS: the manifest route rewrites child URIs to signed URLs ──
it('serves a signed HLS manifest whose child URIs are themselves signed', function () {
    Sanctum::actingAs($this->owner);
    Queue::fake();

    $courseId = $this->postJson('/api/courses', ['title' => 'HLS course'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'S1'])->json('sectionId');

    $assetId = reserveVideo($this->academy, 5000);
    $this->postJson("/api/courses/media/{$assetId}/uploaded")->assertJsonPath('status', 'PROCESSING');
    (new TranscodeMediaJob($assetId, $this->academy))->handle(fakeHlsTranscoder());

    $lessonId = $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'VIDEO_UPLOAD', 'title' => 'Lecture', 'media_asset_id' => $assetId,
    ])->assertCreated()->json('lessonId');
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    $code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$courseId], 'count' => 1, 'max_redemptions' => 1,
    ])->assertCreated()->json('codes.0.code');
    app()['auth']->forgetGuards();

    $auth = ['X-Academy' => 'vodsite'];
    $token = $this->withHeaders($auth)->postJson('/api/learn/auth/register', [
        'full_name' => 'Vee', 'email' => 'vee@example.com', 'password' => 'password123',
    ])->json('token');
    $auth['Authorization'] = "Bearer {$token}";
    $this->withHeaders($auth)->postJson('/api/learn/redeem', ['code' => $code])->assertOk();

    // playback → an HLS manifest url (through our API on both drivers).
    $play = $this->withHeaders($auth)->getJson("/api/learn/lessons/{$lessonId}/playback")->assertOk();
    expect($play->json('protocol'))->toBe('hls');
    expect($play->json('kind'))->toBe('VIDEO');
    expect($play->json('url'))->toContain('/lms/media/hls');

    // GET the master → its variant line is rewritten to a signed HLS url.
    $masterBody = $this->get(pathOf($play->json('url')))
        ->assertOk()->assertHeader('Content-Type', 'application/vnd.apple.mpegurl')->getContent();
    $variantUrl = firstHttpLine($masterBody);
    expect($variantUrl)->toContain('/lms/media/hls');

    // GET the variant → its segment line is rewritten to a signed stream (object) url.
    $variantBody = $this->get(pathOf($variantUrl))->assertOk()->getContent();
    $segmentUrl = firstHttpLine($variantBody);
    expect($segmentUrl)->toContain('/lms/media/stream');

    // GET the segment → the signed stream serves it (BinaryFileResponse — assertOk, as MediaUploadTest).
    $this->get(pathOf($segmentUrl))->assertOk();
});

/** Strip the app origin so a full signed URL becomes a testable request path. */
function pathOf(string $url): string
{
    return str_replace(config('app.url'), '', $url);
}

/** The first absolute-URL line in a rewritten manifest (the variant or segment URI). */
function firstHttpLine(string $manifest): string
{
    foreach (preg_split('/\r\n|\r|\n/', $manifest) ?: [] as $line) {
        if (str_starts_with(trim($line), 'http')) {
            return trim($line);
        }
    }

    return '';
}
