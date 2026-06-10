<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Forces every API request to be treated as a JSON request.
 *
 * Setting the Accept header ensures Laravel's exception handler renders
 * errors (validation, auth, 404, etc.) as JSON rather than HTML, and that
 * responses negotiate to JSON — the contract the Next.js client expects.
 */
final class ForceJsonResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set('Accept', 'application/json');

        return $next($request);
    }
}
