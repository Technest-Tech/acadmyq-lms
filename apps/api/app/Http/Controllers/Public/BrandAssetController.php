<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The public read side of a client's uploaded logo (Admin\AcademyLogoController writes it).
 *
 * PUBLIC and unauthenticated by necessity: this URL is painted on the client's sign-in page, their
 * learner site and their subdomain's front door — all seen before anyone logs in. It exposes only
 * the image the client already publishes as their own brand, and only by its exact random filename,
 * which is minted per upload and never listed.
 *
 * Served from the private disk rather than `storage:link` so the feature does not depend on a
 * symlink and a webserver rule being right on every deployment. The filename changes on every
 * upload, so the response is immutable — a replaced logo is a NEW url and caches never lie.
 */
final class BrandAssetController extends Controller
{
    private const TYPES = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
    ];

    /** GET /api/brand/{academy}/logo/{file} — stream one client's current logo. */
    public function logo(string $academy, string $file): StreamedResponse
    {
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        if (! isset(self::TYPES[$ext])) {
            abort(404);
        }

        $path = 'academy-logos/'.$academy.'/'.$file;
        if (! Storage::disk('local')->exists($path)) {
            abort(404);
        }

        return Storage::disk('local')->response($path, $file, [
            'Content-Type' => self::TYPES[$ext],
            // The bytes are user-uploaded and this endpoint is unauthenticated, so never let a
            // browser sniff its way to a different type than the one we allowlisted above: a file
            // that passed validation as an image but also parses as markup must not be able to
            // execute on our origin.
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'Content-Disposition' => 'inline; filename="'.$file.'"',
        ]);
    }
}
