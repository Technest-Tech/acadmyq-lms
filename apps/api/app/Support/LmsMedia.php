<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;

/**
 * LMS uploaded-media plumbing (docs/lms/04). One place decides HOW media moves, so the dashboard
 * (upload) and the learner site (playback) agree:
 *
 *  - S3-backed disk  → a presigned PUT (upload) / GET (playback) straight to object storage.
 *  - `local` disk    → a Laravel *signed* URL to a proxied PUT / stream route (dev / CI / the test
 *                      fake, where there is no presign). Same client contract either way.
 *
 * Phase-3 v0 ships the source object as the playback object (progressive MP4/​audio behind the
 * enrollment check). The `media_assets` shape already carries `hls_manifest_key`, so a later HLS
 * transcode worker upgrades playback with no data change.
 *
 * Every media_assets read runs under the caller's tenant context (RLS scopes it to the academy).
 */
final class LmsMedia
{
    /** The configured media disk (s3-backed in prod, `local` in a storage-less dev box). */
    public static function disk(): string
    {
        return (string) config('lms.media.disk', 'local');
    }

    /** True when the disk can presign — i.e. the client uploads/plays straight from object storage. */
    public static function presignEnabled(): bool
    {
        return config('filesystems.disks.'.self::disk().'.driver') === 's3';
    }

    /** Bytes an academy is allowed to store, or null when the plan sets no `maxStorageGb` cap. */
    public static function capBytes(string $academyId): ?int
    {
        $gb = Entitlement::limitFor($academyId, 'maxStorageGb');

        return $gb === null ? null : $gb * 1073741824;
    }

    /** Bytes the academy currently holds across all media_assets (RLS-scoped), optionally excluding one. */
    public static function usedBytes(?string $excludeAssetId = null): int
    {
        return (int) DB::table('media_assets')
            ->when($excludeAssetId !== null, fn ($q) => $q->where('id', '!=', $excludeAssetId))
            ->sum('size_bytes');
    }

    /**
     * Abort 402 (upgrade_required shape) when adding $addBytes would exceed the plan's storage cap.
     * A null cap means uncapped. `$excludeAssetId` lets the post-upload reconcile re-check against the
     * asset's ACTUAL size instead of double-counting its reserved (declared) size.
     */
    public static function assertWithinCap(string $academyId, int $addBytes, ?string $excludeAssetId = null): void
    {
        $cap = self::capBytes($academyId);
        if ($cap === null) {
            return;
        }
        $used = self::usedBytes($excludeAssetId);
        if ($used + $addBytes > $cap) {
            abort(response()->json([
                'code' => 'storage_limit_reached',
                'message' => "This plan's media storage is full — upgrade the plan to upload more.",
                'used_bytes' => $used,
                'limit_bytes' => $cap,
            ], 402));
        }
    }

    /** Object key for a fresh asset's source upload. Academy-scoped so RLS + the key agree. */
    public static function sourceKey(string $academyId, string $assetId, ?string $ext): string
    {
        return "lms/{$academyId}/{$assetId}/source".($ext !== null && $ext !== '' ? ".{$ext}" : '');
    }

    /**
     * Where the client should PUT the file, and how. S3 → a presigned PUT (+ required headers);
     * local → a signed proxy route (no headers). The client sends the raw file body either way.
     *
     * @return array{url: string, method: string, headers: array<string,string>}
     */
    public static function uploadTarget(string $key, string $contentType): array
    {
        $ttl = Carbon::now()->addMinutes((int) config('lms.media.upload_ttl_minutes', 60));

        if (self::presignEnabled()) {
            $signed = Storage::disk(self::disk())->temporaryUploadUrl($key, $ttl);

            return ['url' => $signed['url'], 'method' => 'PUT', 'headers' => $signed['headers'] ?? []];
        }

        return [
            'url' => URL::temporarySignedRoute('lms.media.raw', $ttl, ['k' => $key]),
            'method' => 'PUT',
            'headers' => [],
        ];
    }

    /** A short-lived URL an enrolled learner's <video>/<audio> can play. Caller has already gated it. */
    public static function playbackUrl(object $asset): string
    {
        $key = (string) ($asset->playback_path ?? '') ?: (string) $asset->storage_key;
        $ttl = Carbon::now()->addMinutes((int) config('lms.media.playback_ttl_minutes', 240));

        if (self::presignEnabled()) {
            return Storage::disk(self::disk())->temporaryUrl($key, $ttl);
        }

        return URL::temporarySignedRoute('lms.media.stream', $ttl, ['k' => $key]);
    }
}
