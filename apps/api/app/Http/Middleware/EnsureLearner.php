<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\Learner;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authenticate a learner on the LMS public site. Runs AFTER ResolveAcademyContext (so tenant context
 * is set and the `learner` Sanctum guard resolves the bearer token under RLS). It hardens the guard
 * in three ways the bare guard doesn't:
 *   - the token's owner MUST be a Learner (a staff user's bearer token can't reach learner routes);
 *   - that learner MUST belong to the current subdomain's academy (a token minted for academy A is
 *     rejected on academy B — defence in depth on top of RLS);
 *   - the learner MUST be ACTIVE (a BLOCKED learner is barred, 403).
 *
 * The resolved learner is stashed on the request for the controllers (InteractsWithLearner).
 */
final class EnsureLearner
{
    public function handle(Request $request, Closure $next): Response
    {
        $learner = Auth::guard('learner')->user();

        if (! $learner instanceof Learner) {
            abort(401, 'Sign in to continue.');
        }

        $academyId = (string) $request->attributes->get('lms_academy_id', '');
        if ($academyId === '' || (string) $learner->academy_id !== $academyId) {
            abort(401, 'Sign in to continue.');
        }

        if ((string) $learner->status !== 'ACTIVE') {
            abort(403, 'This account is blocked.');
        }

        $request->attributes->set('learner', $learner);

        return $next($request);
    }
}
