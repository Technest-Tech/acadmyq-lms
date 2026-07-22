<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => env('APP_URL').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        // LiveKit Egress recordings (docs/video-platform). Used ONLY to mint short-lived presigned
        // GET URLs for replay — the same LIVEKIT_S3_* bucket egress uploads to. The endpoint must be
        // BROWSER-reachable: locally MinIO is `minio:9000` on the docker network (where egress writes)
        // but `localhost:9000` from the browser, so LIVEKIT_S3_PUBLIC_ENDPOINT overrides it; in prod
        // both are the same public S3 endpoint, so it falls back to LIVEKIT_S3_ENDPOINT.
        'video_recordings' => [
            'driver' => 's3',
            'key' => env('LIVEKIT_S3_KEY'),
            'secret' => env('LIVEKIT_S3_SECRET'),
            'region' => env('LIVEKIT_S3_REGION', 'us-east-1'),
            'bucket' => env('LIVEKIT_S3_BUCKET', 'recordings'),
            'endpoint' => env('LIVEKIT_S3_PUBLIC_ENDPOINT', env('LIVEKIT_S3_ENDPOINT')),
            'use_path_style_endpoint' => true,
            'throw' => false,
            'report' => false,
        ],

        // LMS uploaded lesson media (docs/lms/04). Reuses the same S3/CDN layer as the video
        // platform — its own bucket, keyed `lms/<academy>/<asset>/…`. When LMS_S3_* is unset it
        // falls back to the LIVEKIT_S3_* store (one MinIO locally). With NO S3 configured at all the
        // default disk is `local` (see LMS_MEDIA_DISK / config/lms.php) and the API serves signed
        // proxy URLs instead of presigning — so LMS video works in dev without object storage.
        'lms_media' => [
            'driver' => 's3',
            'key' => env('LMS_S3_KEY', env('LIVEKIT_S3_KEY')),
            'secret' => env('LMS_S3_SECRET', env('LIVEKIT_S3_SECRET')),
            'region' => env('LMS_S3_REGION', env('LIVEKIT_S3_REGION', 'us-east-1')),
            'bucket' => env('LMS_S3_BUCKET', 'lms-media'),
            'endpoint' => env('LMS_S3_PUBLIC_ENDPOINT', env('LMS_S3_ENDPOINT', env('LIVEKIT_S3_PUBLIC_ENDPOINT', env('LIVEKIT_S3_ENDPOINT')))),
            'use_path_style_endpoint' => true,
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
