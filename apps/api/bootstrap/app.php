<?php

declare(strict_types=1);

use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\TenantContextMiddleware;
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

        // All /api/* responses (and errors) negotiate to JSON.
        $middleware->api(prepend: [
            ForceJsonResponse::class,
        ]);

        // The auth → GUC bridge, applied to the authenticated route group in routes/api.php.
        $middleware->alias([
            'tenant.context' => TenantContextMiddleware::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
