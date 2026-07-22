<?php

declare(strict_types=1);

namespace App\Support\Lms;

/**
 * What a transcode produced: the master-playlist filename (relative to the output dir the worker was
 * handed) and the source's duration. The job scans the output dir for the actual files to upload —
 * the transcoder only names its entry point and reports the duration it probed.
 */
final class TranscodeResult
{
    public function __construct(
        public readonly string $manifestName,
        public readonly int $durationSeconds,
    ) {}
}
