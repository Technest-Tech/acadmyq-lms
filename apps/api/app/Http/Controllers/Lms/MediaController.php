<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Jobs\TranscodeMediaJob;
use App\Support\Audit;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Uploaded lesson media — the VOD authoring side (docs/lms/04, LMS module, entitled:lms + course.manage).
 *
 *   1. POST /courses/media/upload-url  → reserve a media_asset (PENDING), enforce the storage cap,
 *      hand back where to PUT the file (presigned S3, or a signed proxy route on a local disk).
 *   2. client PUTs the file straight to that url (never through PHP on S3).
 *   3. POST /courses/media/{id}/uploaded → confirm the object landed, reconcile its real size against
 *      the cap, and flip it to READY. Phase-3 v0 serves the source object directly (no transcode);
 *      the HLS worker (phase 3b) will insert a PROCESSING step here without touching this contract.
 *   4. GET /courses/media/{id} → poll status for the upload/transcode progress UI.
 *
 * RLS scopes every media_assets row to the academy, so a cross-tenant id simply 404s.
 */
final class MediaController extends Controller
{
    use InteractsWithLms;

    /** kind → the leading MIME segment the browser must declare (loose; the cap + gate are the teeth). */
    private const KIND_MIME = ['VIDEO' => 'video/', 'AUDIO' => 'audio/', 'IMAGE' => 'image/'];

    /** POST /api/courses/media/upload-url — reserve an asset + return the upload target. */
    public function createUpload(Request $request): JsonResponse
    {
        Gate::authorize('course.manage');
        $academyId = $this->currentAcademyId();

        $data = $request->validate([
            'filename' => ['required', 'string', 'max:255'],
            'content_type' => ['required', 'string', 'max:255'],
            'kind' => ['required', Rule::in(array_keys(self::KIND_MIME))],
            'size_bytes' => ['required', 'integer', 'min:1', 'max:'.(int) config('lms.media.max_upload_bytes')],
        ]);

        $prefix = self::KIND_MIME[$data['kind']];
        if (! str_starts_with(strtolower($data['content_type']), $prefix)) {
            throw ValidationException::withMessages([
                'content_type' => ["A {$data['kind']} upload needs a {$prefix}* file."],
            ]);
        }

        // Reserve space up front (fail before handing out an upload url).
        LmsMedia::assertWithinCap($academyId, (int) $data['size_bytes']);

        $assetId = (string) Str::uuid();
        $key = LmsMedia::sourceKey($academyId, $assetId, $this->extensionOf($data['filename']));

        DB::table('media_assets')->insert([
            'id' => $assetId,
            'academy_id' => $academyId,
            'kind' => $data['kind'],
            'original_filename' => $data['filename'],
            'storage_key' => $key,
            'size_bytes' => (int) $data['size_bytes'],
            'status' => 'PENDING',
            'created_by' => $this->ctx()->userId,
        ]);

        $target = LmsMedia::uploadTarget($key, $data['content_type']);

        Audit::log('lms_media.reserve', 'media_asset', $assetId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['kind' => $data['kind'], 'filename' => $data['filename'], 'size_bytes' => (int) $data['size_bytes']]);

        return response()->json(['mediaAssetId' => $assetId, 'upload' => $target], 201);
    }

    /** POST /api/courses/media/{id}/uploaded — confirm the object landed and mark it READY. */
    public function markUploaded(string $id): JsonResponse
    {
        Gate::authorize('course.manage');
        $academyId = $this->currentAcademyId();
        $asset = $this->findAsset($id);

        $disk = Storage::disk(LmsMedia::disk());
        if (! $disk->exists((string) $asset->storage_key)) {
            DB::table('media_assets')->where('id', $id)->update([
                'status' => 'FAILED',
                'error' => 'Upload not found in storage.',
                'updated_at' => now(),
            ]);
            throw ValidationException::withMessages(['upload' => ['We could not find the uploaded file — please try again.']]);
        }

        $size = (int) $disk->size((string) $asset->storage_key);
        // Re-check the cap against the ACTUAL size (excluding this asset's reserved size).
        LmsMedia::assertWithinCap($academyId, $size, excludeAssetId: $id);

        // Phase 3b: a VIDEO upload transcodes to HLS on the queue when it's enabled; everything else
        // (uploaded audio, or transcode off = the v0 / storage-less dev box) serves the source object
        // directly. The upload/progress UI already tolerates the extra PROCESSING step either way.
        if ((string) $asset->kind === 'VIDEO' && config('lms.media.transcode')) {
            DB::table('media_assets')->where('id', $id)->update([
                'status' => 'PROCESSING',
                'size_bytes' => $size,
                'error' => null,
                'updated_at' => now(),
            ]);

            TranscodeMediaJob::dispatch($id, $academyId);

            Audit::log('lms_media.processing', 'media_asset', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['size_bytes' => $size]);

            return response()->json(['status' => 'PROCESSING', 'size_bytes' => $size]);
        }

        DB::table('media_assets')->where('id', $id)->update([
            'status' => 'READY',            // no transcode — the source object is the playback object
            'size_bytes' => $size,
            'playback_path' => $asset->storage_key,
            'error' => null,
            'updated_at' => now(),
        ]);

        Audit::log('lms_media.ready', 'media_asset', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['size_bytes' => $size]);

        return response()->json(['status' => 'READY', 'size_bytes' => $size]);
    }

    /** GET /api/courses/media/{id} — poll one asset's status (upload/transcode progress). */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('course.read');
        $this->currentAcademyId();

        return response()->json($this->presentAsset($this->findAsset($id)));
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** RLS-scoped asset lookup, or 404 (a cross-tenant id never leaks). */
    private function findAsset(string $id): object
    {
        $asset = DB::table('media_assets')->where('id', $id)->first();
        if ($asset === null) {
            abort(404, 'Media not found.');
        }

        return $asset;
    }

    /** @return array<string,mixed> */
    private function presentAsset(object $a): array
    {
        return [
            'id' => (string) $a->id,
            'kind' => (string) $a->kind,
            'status' => (string) $a->status,
            'size_bytes' => $a->size_bytes !== null ? (int) $a->size_bytes : null,
            'duration_seconds' => $a->duration_seconds !== null ? (int) $a->duration_seconds : null,
            'original_filename' => $a->original_filename,
            'error' => $a->error,
        ];
    }

    /** Lower-cased, alnum-only file extension (≤10 chars), or null. */
    private function extensionOf(string $filename): ?string
    {
        $ext = strtolower((string) pathinfo($filename, PATHINFO_EXTENSION));
        $ext = preg_replace('/[^a-z0-9]/', '', $ext) ?? '';

        return $ext === '' ? null : substr($ext, 0, 10);
    }
}
