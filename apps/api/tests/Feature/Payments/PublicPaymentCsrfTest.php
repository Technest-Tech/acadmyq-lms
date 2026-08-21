<?php

declare(strict_types=1);

use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;

/**
 * The public payer pages carry no session — the invoice token in the URL is the whole
 * authorisation — and they call the API with a plain `fetch` that sends no XSRF header. They are
 * served from a STATEFUL domain, though, so statefulApi() would put session CSRF in front of every
 * one of their POSTs and answer 419 before the controller ever runs. That is exactly what happened
 * in production: "POST /api/i/{token}/xpay/session 419".
 *
 * This cannot be caught by an ordinary feature test — ValidateCsrfToken short-circuits whenever
 * runningUnitTests() is true, so the request would pass here while failing on the box. So assert
 * the CONFIGURATION instead: these URIs must stay in the except list.
 */
/**
 * `inExceptArray` is protected, so call it the way the framework does. Asserting through the
 * framework's own matcher rather than reading a property is deliberate: `validateCsrfTokens(except:)`
 * lands in a STATIC never-verify list, not the instance's `$except`, so a property assertion would
 * look green while testing nothing.
 */
function csrfExempts(string $uri): bool
{
    $middleware = app(ValidateCsrfToken::class);
    $method = new ReflectionMethod($middleware, 'inExceptArray');
    $method->setAccessible(true);

    return $method->invoke($middleware, request()->create($uri, 'POST'));
}

it('exempts the public, token-authenticated payment endpoints from session CSRF', function () {
    // The real shapes a payer's browser posts to, matched the way the framework matches them.
    // The first is the exact URL that answered 419 in production.
    expect(csrfExempts('/api/i/alrayaEqLEUNbFa4Nzw4cd/xpay/session'))->toBeTrue()
        ->and(csrfExempts('/api/i/abc123/paypal/create-order'))->toBeTrue()
        ->and(csrfExempts('/api/i/abc123/paypal/capture/ORDER-1'))->toBeTrue()
        ->and(csrfExempts('/api/a/xyz789/submit'))->toBeTrue();
});

it('still protects session-authenticated writes', function () {
    // Anything a logged-in user does through apiFetch keeps CSRF: apiFetch primes and echoes the
    // XSRF cookie, so these have a token to check and must go on checking it.
    expect(csrfExempts('/api/students'))->toBeFalse()
        ->and(csrfExempts('/api/admin/academies/1/logo'))->toBeFalse()
        ->and(csrfExempts('/api/i/abc123/xpay/session/SESS-1'))->toBeFalse();
});
