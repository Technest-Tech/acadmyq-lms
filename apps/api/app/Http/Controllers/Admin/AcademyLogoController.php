<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The client's logo, uploaded from the Super Admin client page (docs/superadmin-modules).
 *
 * There is ONE logo per client — `academies.brand_logo_url` — and every surface that paints the
 * client's identity already reads that column: their branded sign-in page (Auth\AuthController),
 * their subdomain's front door (Public\TenantSiteController), the learner site (Learner\SiteController
 * + Support\LmsSiteProfile) and the panel chrome itself. So an upload does not need a new field or a
 * new consumer — it only has to put a working URL in that column, and every surface follows.
 *
 * The file lands on the PRIVATE disk (like payment screenshots) and is served back by the public
 * `/api/brand/{academy}/logo/{file}` route, NOT the `public` disk: that keeps the feature working on
 * a deployment where `storage:link` was never run, and the same code path serves dev and prod.
 *
 * The stored name is a fresh UUID on every upload, so the URL changes when the logo does — no cache
 * busting to reason about, and the response can be immutable. The previous file is deleted in the
 * same call, so a client folder holds exactly one logo.
 */
final class AcademyLogoController extends Controller
{
    /** Where one client's logo lives on the private disk. */
    private const DIR = 'academy-logos';

    /** Extensions we accept and serve. No SVG: it is script-capable and this URL is public. */
    private const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

    /** POST /api/admin/academies/{id}/logo — replace the logo, return the URL now on the column. */
    public function upload(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy.configure');

        $existing = DB::table('academies')->where('id', $id)->first(['id', 'brand_logo_url']);
        if ($existing === null) {
            abort(404, 'Academy not found.');
        }

        $request->validate([
            'logo' => ['required', 'file', 'image', 'mimes:'.implode(',', self::EXTENSIONS), 'max:2048'], // ≤ 2 MB
        ]);

        $file = $request->file('logo');
        $ext = strtolower((string) ($file->extension() ?: $file->getClientOriginalExtension()));
        if (! in_array($ext, self::EXTENSIONS, true)) {
            $ext = 'png';
        }

        $dir = self::DIR.'/'.$id;
        $name = ((string) Str::uuid()).'.'.$ext;

        // Replace, never accumulate: whatever was in this client's folder is the OLD logo.
        $stale = Storage::disk('local')->files($dir);
        $file->storeAs($dir, $name, 'local');

        $url = url('/api/brand/'.$id.'/logo/'.$name);
        $this->setLogoUrl($id, $url, $existing->brand_logo_url);

        Storage::disk('local')->delete($stale);

        return response()->json(['ok' => true, 'brand_logo_url' => $url]);
    }

    /** DELETE /api/admin/academies/{id}/logo — back to no logo (the name renders instead). */
    public function remove(string $id): JsonResponse
    {
        Gate::authorize('academy.configure');

        $existing = DB::table('academies')->where('id', $id)->first(['id', 'brand_logo_url']);
        if ($existing === null) {
            abort(404, 'Academy not found.');
        }

        $this->setLogoUrl($id, null, $existing->brand_logo_url);
        Storage::disk('local')->deleteDirectory(self::DIR.'/'.$id);

        return response()->json(['ok' => true, 'brand_logo_url' => null]);
    }

    /**
     * Write the column in the CLIENT's context — `academies` is RLS-protected, so a cross-tenant
     * Super Admin write has to announce which tenant it is for (same rule as AcademyController).
     */
    private function setLogoUrl(string $id, ?string $url, ?string $before): void
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(
            userId: $ctx->userId,
            academyId: $id,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        );

        Tenancy::withContext($target, function () use ($id, $url, $before, $ctx) {
            DB::table('academies')->where('id', $id)->update([
                'brand_logo_url' => $url,
                'updated_at' => now(),
            ]);

            Audit::log(
                'academy.configure', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['brand_logo_url' => $url],
                before: ['brand_logo_url' => $before],
            );
        });
    }
}
