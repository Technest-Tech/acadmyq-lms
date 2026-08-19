<?php

declare(strict_types=1);

use App\Http\Middleware\AuthenticateWhatsAppApiKey;
use App\Http\Middleware\EnsureEntitled;
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
        $middleware->validateCsrfTokens(except: [
            'api/lms/media/*',
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
            'learner.auth' => EnsureLearner::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
