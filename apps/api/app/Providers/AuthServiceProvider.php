<?php

declare(strict_types=1);

namespace App\Providers;

use App\Auth\RlsBypassUserProvider;
use App\Support\AuthContext;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

/**
 * Wires the two app-layer authorization pieces of Sprint 2:
 *
 *  1. The `rls-eloquent` user provider (RlsBypassUserProvider) — used by the session/
 *     Sanctum guard so credential and session-id lookups bypass RLS (config/auth.php).
 *
 *  2. A single data-driven Gate::before — every $user->can($code) / Gate::authorize($code)
 *     is answered from the per-request AuthContext's capability set (§5.1/§5.2), which was
 *     resolved from role_permissions. There are no per-ability Gate::define calls and no
 *     `if ($role === …)` anywhere: a new capability or role is a data change (§3.2).
 */
class AuthServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Auth::provider('rls-eloquent', function ($app, array $config) {
            return new RlsBypassUserProvider($app['hash'], $config['model']);
        });

        Gate::before(function (Authenticatable $user, string $ability): ?bool {
            // Authority lives in the request-scoped AuthContext (bound by
            // TenantContextMiddleware). Absent → no context → fall through (deny).
            if (! app()->bound(AuthContext::class)) {
                return null;
            }

            // true short-circuits to "allowed"; null falls through to default deny
            // (we never hard-deny here so genuinely-undefined abilities still 403).
            return app(AuthContext::class)->can($ability) ? true : null;
        });
    }
}
