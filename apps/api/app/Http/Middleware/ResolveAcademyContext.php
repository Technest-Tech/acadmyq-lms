<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\AuthContext;
use App\Support\CustomDomain;
use App\Support\Tenancy;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * The LMS public-site tenant bridge (docs/lms/02). Where TenantContextMiddleware derives the academy
 * from the authenticated staff user, this derives it from the SUBDOMAIN — the one fact a public
 * learner request carries before any identity. The web layer forwards the subdomain handle as the
 * `X-Academy` header (from `<academy>.<platform>`).
 *
 * Resolving the handle → academy_id is the only pre-context read, so it goes through the
 * app.lms_academy_by_subdomain BYPASSRLS function (mirroring app.auth_*). It then runs the rest of
 * the request inside one transaction with the RLS GUCs set to that academy and a sentinel `LEARNER`
 * role (a text GUC — it matches no staff-role check, granting nothing). Every learner read/write
 * downstream is therefore tenant-scoped by RLS exactly like a staff request.
 *
 * A client on their OWN domain (docs/custom-domains) arrives with no handle to forward, so the web
 * layer sends the raw host as `X-Academy-Host` instead and this resolves it through the domains
 * table. It is the same bridge either way — only the key differs — and the resolved row also carries
 * which product that host serves, which `/api/site` reads back out of the request attributes.
 *
 * Unknown / missing handle ⇒ 404 (the public site simply doesn't exist for that host).
 */
final class ResolveAcademyContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $host = trim((string) $request->header('X-Academy-Host', ''));

        if ($host !== '') {
            $domain = CustomDomain::resolve($host);
            if ($domain === null) {
                abort(404, 'Unknown course site.');
            }

            $academyId = $domain['academy_id'];
            // The domain row decides what answers at `/` on ITS host — a client buys an address for
            // a purpose, so `LmsSite::ownsRoot()`'s plan-shaped guess does not apply here.
            $request->attributes->set('lms_domain_kind', $domain['kind']);
            $request->attributes->set('lms_domain_host', CustomDomain::normalize($host));
            $request->attributes->set('lms_handle', $domain['subdomain']);
        } else {
            $handle = trim((string) $request->header('X-Academy', ''));
            if ($handle === '') {
                abort(404, 'Unknown course site.');
            }

            $academyId = DB::selectOne('select app.lms_academy_by_subdomain(?) as id', [$handle])->id ?? null;
            if ($academyId === null) {
                abort(404, 'Unknown course site.');
            }

            $request->attributes->set('lms_handle', $handle);
        }

        $ctx = new AuthContext(
            userId: '', // no staff user; a learner (if any) is resolved by EnsureLearner
            academyId: (string) $academyId,
            role: 'LEARNER',
            permissions: [],
        );

        app()->instance(AuthContext::class, $ctx);
        $request->attributes->set('lms_academy_id', (string) $academyId);

        return Tenancy::withContext($ctx, fn () => $next($request));
    }
}
