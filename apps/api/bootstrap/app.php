<?php

declare(strict_types=1);

use App\Http\Middleware\AuthenticateWhatsAppApiKey;
use App\Http\Middleware\EnsureEntitled;
use App\Http\Middleware\EnsureCourseSiteOpen;
use App\Http\Middleware\EnsureLearner;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\ResolveAcademyContext;
use App\Http\Middleware\TenantContextMiddleware;
use App\Http\Middleware\VerifyLivekitWebhook;
use App\Http\Middleware\VerifyWhatsAppWebhook;
use App\Http\Middleware\VerifyXpayWebhook;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // Sanctum SPA cookie auth: requests from a stateful domain receive the session +
        // CSRF stack so Auth::attempt persists and X-XSRF-TOKEN is validated (Sprint 2 §2).
        $middleware->statefulApi();

        // The LMS media proxy (docs/lms/04) is authorised by the URL SIGNATURE, not by the session:
        // it's the local-disk stand-in for a presigned S3 PUT, and the browser uploads to it with a
        // plain XHR that carries no XSRF header. Session CSRF on top would reject every such upload
        // with a 419. Safe to exempt — `signed` still gates it on an unguessable, expiring signature
        // that only this API hands out, and the handler only accepts `lms/*` object keys.
        //
        // The PUBLIC, token-authenticated payer pages are the same shape. A payer opening an
        // invoice link has NO session — the unguessable token in the URL is the entire
        // authorisation — and those pages call the API with a plain `fetch` that carries no
        // XSRF header. But they are served from app.acadmyq.com, which IS a stateful domain, so
        // statefulApi() applies session CSRF to their POSTs and every payment attempt dies on a
        // 419 before it reaches the controller.
        //
        // Exempting them costs nothing: CSRF exists to stop a third-party site spending a
        // victim's AMBIENT session credentials. There are none here, so an attacker would first
        // have to know the invoice token — and if they know it they can call the endpoint
        // directly from anywhere, with or without a browser. The token is the credential, and
        // each controller re-checks it against the invoice it names.
        $middleware->validateCsrfTokens(except: [
            'api/lms/media/*',
            'api/i/*/xpay/session',   // start XPay hosted checkout
            'api/i/*/paypal/*',       // create + capture a PayPal order
            'api/a/*/submit',         // academy uploads its transfer screenshot
            // The marketing site's demo form. A stronger case than any of the above: the sender is
            // a stranger with NO credential of any kind — no session, no token — so there is nothing
            // for a third-party page to forge on their behalf. Requiring CSRF here would only mean
            // priming a session cookie on every anonymous visitor of acadmyq.com to protect a write
            // that carries no authority. Volume is bounded by throttle:demo-requests instead.
            'api/public/demo-requests',
            // The LMS public course site (docs/lms). The same shape again, and the one that bites
            // hardest: a client's site is served from `<handle>.acadmyq.com`, which MATCHES the
            // `*.acadmyq.com` wildcard in SANCTUM_STATEFUL_DOMAINS, so statefulApi() puts session
            // CSRF in front of every learner POST. But a learner has no session to protect — they
            // authenticate with a Sanctum BEARER token kept in localStorage and sent in the
            // Authorization header (lib/learn-api.ts), with no XSRF header and no cookie. The check
            // could therefore only ever fail, and it did: every register/login on every course site
            // died on a 419 "CSRF token mismatch" before reaching the controller.
            //
            // Safe for the same reason as the payer pages: CSRF defends AMBIENT cookie credentials,
            // and this surface has none. The bearer token is the credential, a third-party page
            // cannot read it out of localStorage, and `learner.auth` re-checks on every protected
            // route that the token belongs to an ACTIVE learner OF THIS SUBDOMAIN'S academy. The
            // whole prefix is exempted rather than just the two auth routes because redeem,
            // progress, quiz submit, orders and the receipt upload are all that same bearer shape.
            'api/learn/*',
        ]);

        // All /api/* responses (and errors) negotiate to JSON.
        $middleware->api(prepend: [
            ForceJsonResponse::class,
        ]);

        // The auth → GUC bridge, applied to the authenticated route group in routes/api.php.
        // `entitled:` is the plan-gate (Sprint 9 §4.3), used as `entitled:feature.key` on
        // plan-gated routes — distinct from the RBAC Gate so a plan miss returns 402-upgrade,
        // not 403-forbidden.
        $middleware->alias([
            'tenant.context' => TenantContextMiddleware::class,
            'entitled' => EnsureEntitled::class,
            // HMAC guard for the public inbound webhook from the self-hosted WhatsApp gateway.
            'wa.webhook' => VerifyWhatsAppWebhook::class,
            // JWT/body-hash guard for the public inbound webhook from the self-hosted LiveKit server.
            'livekit.webhook' => VerifyLivekitWebhook::class,
            // HMAC guard for XPay's payment webhooks. Unlike the two above, the signing secret is
            // per-academy (each client has its own merchant account), resolved from the route.
            'xpay.webhook' => VerifyXpayWebhook::class,
            // Per-academy API-key auth for the external WhatsApp API (docs/whatsapp-api).
            'wa.apikey' => AuthenticateWhatsAppApiKey::class,
            // LMS public course site (docs/lms): resolve the academy from the subdomain (X-Academy)
            // into tenant context, then (for protected routes) require an authenticated learner.
            'resolve.academy' => ResolveAcademyContext::class,
            // The public site is only open while the academy is neither SUSPENDED nor without a
            // live LMS module — see the middleware for why both answer 404.
            'site.open' => EnsureCourseSiteOpen::class,
            'learner.auth' => EnsureLearner::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
