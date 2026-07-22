<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

/**
 * Signed media delivery for a `local` (non-presigning) disk — dev / CI, and the test fake. Both
 * routes are PUBLIC but gated by Laravel's `signed` middleware: the URL is minted only after the
 * server has authorised the caller (course.manage to upload, an enrollment check to play), so the
 * signature IS the authorisation and no session/bearer is needed on the raw transfer. On an S3 disk
 * these are never minted (the client talks to object storage directly) — see App\Support\LmsMedia.
 */
final class MediaDeliveryController extends Controller
{
    /** PUT /lms/media/raw?...signed... — store the raw request body at the reserved key. */
    public function raw(Request $request): JsonResponse
    {
        $key = $this->signedKey($request);
        Storage::disk(LmsMedia::disk())->put($key, $request->getContent());

        return response()->json(['ok' => true]);
    }

    /** GET /lms/media/stream?...signed... — stream the object (range-capable for <video> seeking). */
    public function stream(Request $request): Response
    {
        $key = $this->signedKey($request);
        $disk = Storage::disk(LmsMedia::disk());
        abort_unless($disk->exists($key), 404);

        // A local-disk file yields a real path → BinaryFileResponse, which honours Range requests
        // (seeking). Any other adapter falls back to a plain streamed download.
        try {
            return response()->file($disk->path($key));
        } catch (\Throwable) {
            return $disk->response($key);
        }
    }

    /** The signature is already verified by middleware; only accept a well-formed lms/* object key. */
    private function signedKey(Request $request): string
    {
        $key = (string) $request->query('k', '');
        abort_unless($key !== '' && str_starts_with($key, 'lms/') && ! str_contains($key, '..'), 404);

        return $key;
    }
}
