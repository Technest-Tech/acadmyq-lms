<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\AuthContext;
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
 * Unknown / missing handle ⇒ 404 (the public site simply doesn't exist for that host).
 */
final class ResolveAcademyContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $handle = trim((string) $request->header('X-Academy', ''));
        if ($handle === '') {
            abort(404, 'Unknown course site.');
        }

        $academyId = DB::selectOne('select app.lms_academy_by_subdomain(?) as id', [$handle])->id ?? null;
        if ($academyId === null) {
            abort(404, 'Unknown course site.');
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
