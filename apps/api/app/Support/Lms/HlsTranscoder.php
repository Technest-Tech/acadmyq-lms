<?php

declare(strict_types=1);

namespace App\Support\Lms;

/**
 * Turns an uploaded source video into a local HLS ladder (docs/lms/04 — VOD, phase 3b). The one seam
 * between TranscodeMediaJob's storage/DB wiring and the actual ffmpeg shell-out: the real
 * {@see FfmpegHlsTranscoder} is bound in AppServiceProvider, and tests bind a fake that writes a
 * manifest + a segment so the job's download → transcode → upload → READY path is exercised without
 * ffmpeg (which is integration-only and can't run in CI).
 */
interface HlsTranscoder
{
    /**
     * Transcode $sourcePath into an HLS ladder written under $outDir (both absolute local paths, the
     * dir already created & empty). Return the master-playlist filename (relative to $outDir) and the
     * probed duration. Throws on failure — the job turns that into a FAILED media_asset.
     */
    public function transcode(string $sourcePath, string $outDir): TranscodeResult;
}
