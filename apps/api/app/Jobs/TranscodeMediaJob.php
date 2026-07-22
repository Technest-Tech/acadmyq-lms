<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Support\AuthContext;
use App\Support\Lms\HlsTranscoder;
use App\Support\LmsMedia;
use App\Support\Tenancy;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * HLS transcode worker (docs/lms/04 — VOD, phase 3b). One confirmed VIDEO upload, dispatched by
 * MediaController::markUploaded once the source object has landed and status is PROCESSING:
 *
 *   download source → {@see HlsTranscoder} (ffmpeg → HLS ladder) → upload manifest+segments to the
 *   lms_media disk under lms/{academy}/{asset}/hls/ → READY + hls_manifest_key (or FAILED + error).
 *
 * Runs under the academy's tenant context (SUPER_ADMIN role, like PurgeExpiredRecordingsJob) so the
 * RLS-scoped media_assets row is readable/writable. Idempotent: it no-ops unless the row is still
 * PROCESSING, so a duplicate/retried run is harmless. Storage accounting: the source object is
 * deleted on success and size_bytes is reset to the rendition total — the true stored footprint that
 * feeds the plan's maxStorageGb cap (the source was only needed to transcode).
 */
final class TranscodeMediaJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /** A failed transcode marks the asset FAILED itself; don't re-run the (expensive) ffmpeg pass. */
    public int $tries = 1;

    /** Generous worker timeout — must outlast ffmpeg's own (config lms.media.transcode_timeout_seconds). */
    public int $timeout = 7800;

    public function __construct(
        private readonly string $assetId,
        private readonly string $academyId,
    ) {}

    public function handle(HlsTranscoder $transcoder): void
    {
        $ctx = new AuthContext(self::SYSTEM_USER_ID, $this->academyId, 'SUPER_ADMIN', []);
        Tenancy::withContext($ctx, fn () => $this->process($transcoder));
    }

    private function process(HlsTranscoder $transcoder): void
    {
        // Idempotency: only a row still awaiting transcode is fair game.
        $asset = DB::table('media_assets')
            ->where('id', $this->assetId)
            ->where('status', 'PROCESSING')
            ->first(['id', 'storage_key']);
        if ($asset === null) {
            return;
        }

        $work = $this->makeWorkDir();
        $disk = Storage::disk(LmsMedia::disk());

        try {
            $source = $work.'/source';
            $this->download($disk, (string) $asset->storage_key, $source);

            $outDir = $work.'/out';
            @mkdir($outDir, 0775, true);
            $result = $transcoder->transcode($source, $outDir);

            $prefix = "lms/{$this->academyId}/{$this->assetId}/hls";
            $bytes = $this->upload($disk, $outDir, $prefix);

            DB::table('media_assets')->where('id', $this->assetId)->update([
                'status' => 'READY',
                'hls_manifest_key' => "{$prefix}/{$result->manifestName}",
                'playback_path' => "{$prefix}/{$result->manifestName}",
                'duration_seconds' => $result->durationSeconds,
                'size_bytes' => $bytes,          // renditions only — the source is dropped below
                'error' => null,
                'updated_at' => now(),
            ]);

            // The source object was only needed to transcode; drop it so the cap counts renditions once.
            try {
                $disk->delete((string) $asset->storage_key);
            } catch (Throwable $e) {
                Log::warning('lms transcode: source cleanup failed', ['asset' => $this->assetId, 'error' => $e->getMessage()]);
            }
        } catch (Throwable $e) {
            DB::table('media_assets')->where('id', $this->assetId)->update([
                'status' => 'FAILED',
                'error' => mb_substr($e->getMessage(), 0, 500),
                'updated_at' => now(),
            ]);
            Log::error('lms transcode failed', ['asset' => $this->assetId, 'error' => $e->getMessage()]);
        } finally {
            $this->cleanup($work);
        }
    }

    /** Stream the source object from the media disk to a local temp file (memory-safe for big files). */
    private function download(\Illuminate\Contracts\Filesystem\Filesystem $disk, string $key, string $dest): void
    {
        $in = $disk->readStream($key);
        if ($in === null) {
            throw new \RuntimeException('Source object is unreadable.');
        }
        $out = fopen($dest, 'wb');
        try {
            stream_copy_to_stream($in, $out);
        } finally {
            fclose($out);
            fclose($in);
        }
    }

    /** Upload every file the transcoder wrote under $localDir to $prefix; return the total bytes stored. */
    private function upload(\Illuminate\Contracts\Filesystem\Filesystem $disk, string $localDir, string $prefix): int
    {
        $bytes = 0;
        foreach (scandir($localDir) ?: [] as $name) {
            $path = $localDir.'/'.$name;
            if ($name === '.' || $name === '..' || ! is_file($path)) {
                continue;
            }
            $stream = fopen($path, 'rb');
            try {
                $disk->put("{$prefix}/{$name}", $stream);
            } finally {
                fclose($stream);
            }
            $bytes += (int) filesize($path);
        }

        return $bytes;
    }

    private function makeWorkDir(): string
    {
        $dir = sys_get_temp_dir().'/lms-transcode-'.$this->assetId.'-'.uniqid();
        @mkdir($dir, 0775, true);

        return $dir;
    }

    private function cleanup(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $path = $dir.'/'.$name;
            is_dir($path) ? $this->cleanup($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
