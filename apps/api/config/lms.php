<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | LMS media (docs/lms/04 — VOD)
    |--------------------------------------------------------------------------
    |
    | Uploaded lesson media (video/audio) lives on its own disk. When that disk
    | is an S3-compatible store the upload is a presigned PUT straight to object
    | storage and playback is a short-lived presigned GET — big files never
    | stream through PHP. On a plain `local` disk (dev / CI, and the test fake)
    | there is no presign, so the API mints Laravel *signed* URLs to a proxied
    | PUT / stream route instead — same shape to the client, works everywhere.
    |
    */

    'media' => [
        // Default to the S3 disk only when object storage is actually configured; otherwise the
        // `local` disk + signed-proxy delivery, so a plain dev box needs zero storage setup.
        'disk' => env('LMS_MEDIA_DISK', env('LMS_S3_KEY', env('LIVEKIT_S3_KEY')) ? 'lms_media' : 'local'),

        // How long a presigned/​signed PUT stays valid — a large upload must finish inside it.
        'upload_ttl_minutes' => (int) env('LMS_UPLOAD_TTL_MINUTES', 60),

        // How long a playback URL stays valid. ONE url backs the whole <video> session (range
        // requests reuse it), so it must outlast a lesson; it also bounds the leak window.
        'playback_ttl_minutes' => (int) env('LMS_PLAYBACK_TTL_MINUTES', 240),

        // Hard per-file ceiling regardless of the plan's storage cap (bytes). 5 GiB.
        'max_upload_bytes' => (int) env('LMS_MAX_UPLOAD_BYTES', 5368709120),

        // Phase 3b — HLS transcode. When ON, a confirmed VIDEO upload goes PROCESSING and a queued
        // TranscodeMediaJob shells to ffmpeg to build an HLS ladder; when OFF (the default, and the
        // storage-less dev box) the source object is served directly as a progressive MP4 (v0). Audio
        // is never transcoded either way. Enable in prod once ffmpeg + a queue worker are in place.
        'transcode' => (bool) env('LMS_TRANSCODE', false),

        // Binaries the transcode worker shells to (on PATH by default; override for a pinned build).
        'ffmpeg_bin' => (string) env('LMS_FFMPEG_BIN', 'ffmpeg'),
        'ffprobe_bin' => (string) env('LMS_FFPROBE_BIN', 'ffprobe'),

        // HLS segment length (seconds) and how long ffmpeg may run before it's killed (seconds).
        'hls_segment_seconds' => (int) env('LMS_HLS_SEGMENT_SECONDS', 6),
        'transcode_timeout_seconds' => (int) env('LMS_TRANSCODE_TIMEOUT', 7200),
    ],

];
