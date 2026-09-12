<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Entitlement;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Is this client's public course site actually open for business? Runs after ResolveAcademyContext
 * on the whole `/api/learn/*` prefix (docs/lms/02).
 *
 * Resolving the handle proves only that the host belongs to SOMEONE. Two facts it says nothing
 * about were, until this existed, never checked on the public surface at all:
 *
 *  - **The academy is SUSPENDED.** Suspension already locks the client's staff out at login and on
 *    every authenticated request (TenantContextMiddleware), but the storefront kept trading:
 *    strangers could still register accounts, redeem codes and start checkouts against a client the
 *    platform had switched off, generating orders and money nobody intended to accept.
 *  - **The client has no live LMS module.** The course site is the LMS module's product. A client
 *    who never bought it, or whose subscription ended, still served a (usually empty) public site on
 *    their address — the module's paywall existed only on the staff side of the same data.
 *
 * Both answer 404, the same as an unknown handle, and for the same reason: from the visitor's side
 * there is no site at this address. It is also the only answer that leaks nothing — a distinct
 * "suspended" status would tell any passer-by which of the platform's clients are in trouble, which
 * is the client's business and not the visitor's.
 *
 * Deliberately NOT applied to `GET /api/site`. That endpoint decides which product answers on a
 * host and paints a management client's branded sign-in; a suspended school's staff must still
 * reach their own door, where the login endpoint tells them, in as many words, that the academy is
 * suspended.
 */
final class EnsureCourseSiteOpen
{
    public function handle(Request $request, Closure $next): Response
    {
        $academyId = (string) $request->attributes->get('lms_academy_id', '');
        if ($academyId === '') {
            abort(404, 'Unknown course site.');
        }

        // Readable under the context ResolveAcademyContext just set: academies_select is
        // `id = app.current_academy_id()`, so this can only ever describe the host's own academy.
        $status = (string) (DB::table('academies')->where('id', $academyId)->value('status') ?? '');
        if ($status === 'SUSPENDED') {
            abort(404, 'Unknown course site.');
        }

        if (! in_array('lms', Entitlement::resolve($academyId)['capabilities'], true)) {
            abort(404, 'Unknown course site.');
        }

        return $next($request);
    }
}
