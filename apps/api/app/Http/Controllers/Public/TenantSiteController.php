<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Http\Controllers\Controller;
use App\Support\LmsSite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * What does this subdomain serve? (docs/lms/02 + docs/superadmin-modules).
 *
 * `<handle>.<root>` is one address space shared by two very different products, so something has to
 * say which one a given handle belongs to before a single page renders:
 *
 *  - a COURSE-PLATFORM client (the LMS is their whole product) → the public learner site;
 *  - every other client — the management system, with or without a course catalogue → their own
 *    branded staff sign-in, and their panel behind it.
 *
 * The web middleware calls this once per handle (cached) to pick the route, and the branded login
 * page calls it again server-side for the name + logo it paints. Deliberately ONE endpoint for both:
 * the routing decision and the branding must never disagree about a client.
 *
 * PUBLIC by design (it is the front door of a public address) and it says nothing a visitor of the
 * site could not already see: the academy's name, its logo and which product answers on that host.
 * Note what it deliberately does NOT say — the academy's `status`. It used to, and nothing consumed
 * it; publishing it let any passer-by enumerate which of the platform's clients were on TRIAL or
 * SUSPENDED, which is the client's business and not a visitor's.
 * `resolve.academy` resolves the handle → academy and sets the RLS context, so an unknown handle is
 * a 404 and every read below is scoped to that one academy.
 */
final class TenantSiteController extends Controller
{
    /** GET /api/site (X-Academy: handle) — the site kind + the branding its sign-in page needs. */
    public function show(Request $request): JsonResponse
    {
        $academyId = (string) $request->attributes->get('lms_academy_id');

        // Readable under the resolved context: academies_select is `id = app.current_academy_id()`.
        $academy = DB::table('academies')
            ->where('id', $academyId)
            ->first(['name', 'brand_display_name', 'brand_logo_url', 'subdomain']);

        $name = (string) ($academy->name ?? '');
        $display = trim((string) ($academy->brand_display_name ?? ''));
        $logo = trim((string) ($academy->brand_logo_url ?? ''));

        return response()->json([
            'kind' => $this->kind($academyId),
            'academy' => [
                'name' => $name,
                'display_name' => $display !== '' ? $display : $name,
                'logo_url' => $logo !== '' ? $logo : null,
                'subdomain' => $academy->subdomain ?? null,
            ],
        ]);
    }

    /**
     * LMS ⟺ the course platform IS the client's whole product, which is exactly the question
     * `LmsSite::ownsRoot` answers — the same predicate that decides where that client's course-site
     * LINK points, so the routing and the link can never disagree. (A school that also sells courses
     * keeps its full panel, and therefore its sign-in, at the root of its own address; its course
     * site stays one path away at /learn.)
     */
    private function kind(string $academyId): string
    {
        return LmsSite::ownsRoot($academyId) ? 'LMS' : 'MANAGEMENT';
    }
}
