<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The single sanctioned entry point for running DB work under a tenant context outside the
 * HTTP request path — jobs, Artisan commands, scheduled tasks (Sprint 2 §4.2/§4.3).
 *
 * It mirrors exactly what TenantContextMiddleware does on the HTTP path: open one
 * transaction, set the three RLS GUCs transaction-locally (set_config(..., true)), run the
 * callback, and let the GUCs vanish when the transaction ends — so nothing leaks across a
 * pooled connection. Any code that touches tenant tables must go through this helper or the
 * middleware; raw, context-free DB access is banned by review and fails closed anyway.
 */
final class Tenancy
{
    /**
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
    public static function withContext(AuthContext $ctx, callable $fn): mixed
    {
        return DB::transaction(function () use ($ctx, $fn) {
            TenantContext::apply(
                userId: $ctx->userId,
                academyId: $ctx->academyId,
                role: $ctx->role,
                local: true, // transaction-local: scoped to this transaction only
            );

            return $fn();
        });
    }
}
