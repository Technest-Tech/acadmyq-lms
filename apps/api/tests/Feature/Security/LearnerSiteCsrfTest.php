<?php

declare(strict_types=1);

use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Http\Request;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

/**
 * The LMS course site must never be subjected to session CSRF (docs/lms).
 *
 * This pins a bug that took every client's course site down at the front door: a client site is
 * served from `<handle>.acadmyq.com`, which matches the `*.acadmyq.com` wildcard in
 * SANCTUM_STATEFUL_DOMAINS, so `statefulApi()` wrapped every learner POST in the session + CSRF
 * stack. Learners carry a Sanctum BEARER token in localStorage and send no XSRF header and no
 * cookie, so the check could only ever fail — every register and login answered 419 "CSRF token
 * mismatch" before reaching the controller.
 *
 * These assertions are deliberately made against the middleware CONFIGURATION rather than by
 * firing an HTTP request, because a request test CANNOT reproduce the failure: VerifyCsrfToken
 * short-circuits on `runningUnitTests()` before it ever consults the except-array, which is
 * precisely why the whole existing LMS suite stayed green while production was broken.
 */

/** Does the CSRF middleware consider this path exempt? `inExceptArray` is protected. */
function csrfExempts(string $path): bool
{
    $middleware = app(ValidateCsrfToken::class);
    $method = new ReflectionMethod($middleware, 'inExceptArray');
    $method->setAccessible(true);

    return (bool) $method->invoke($middleware, Request::create($path, 'POST'));
}

it('exempts the whole learner surface from session CSRF', function () {
    // The two doors that were reported broken.
    expect(csrfExempts('/api/learn/auth/login'))->toBeTrue();
    expect(csrfExempts('/api/learn/auth/register'))->toBeTrue();

    // Password reset is reachable by someone who cannot sign in, and carries no token at all.
    expect(csrfExempts('/api/learn/auth/forgot-password'))->toBeTrue();
    expect(csrfExempts('/api/learn/auth/reset-password'))->toBeTrue();

    // Every other learner write is the same bearer shape and would fail the same way.
    expect(csrfExempts('/api/learn/redeem'))->toBeTrue();
    expect(csrfExempts('/api/learn/courses/chemistry-101/enroll'))->toBeTrue();
    expect(csrfExempts('/api/learn/courses/chemistry-101/orders'))->toBeTrue();
    expect(csrfExempts('/api/learn/orders/ORD-1/receipt'))->toBeTrue();
    expect(csrfExempts('/api/learn/lessons/'.fake()->uuid().'/quiz/submit'))->toBeTrue();
    expect(csrfExempts('/api/learn/notifications/read'))->toBeTrue();
});

it('still protects the staff SPA, which DOES authenticate with an ambient session', function () {
    // The exemption must not have widened past the learner prefix: the staff app is cookie-based,
    // so CSRF is load-bearing there and removing it would be a real vulnerability.
    expect(csrfExempts('/api/auth/login'))->toBeFalse();
    expect(csrfExempts('/api/students'))->toBeFalse();
    expect(csrfExempts('/api/courses'))->toBeFalse();
    expect(csrfExempts('/api/admin/clients'))->toBeFalse();
});

it('treats a client subdomain as a stateful domain, which is why the exemption is needed', function () {
    // The precondition for the bug. If this ever stops being true the exemption becomes redundant
    // rather than wrong — but while it holds, the exemption above is what keeps the site alive.
    config(['sanctum.stateful' => ['acadmyq.com', 'app.acadmyq.com', '*.acadmyq.com']]);

    $fromClientSite = Request::create('/api/learn/auth/login', 'POST');
    $fromClientSite->headers->set('origin', 'https://academyx.acadmyq.com');

    expect(EnsureFrontendRequestsAreStateful::fromFrontend($fromClientSite))->toBeTrue();
});
