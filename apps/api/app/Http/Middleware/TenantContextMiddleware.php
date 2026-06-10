<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * The production bridge from an authenticated Sanctum user to the RLS session GUCs
 * (Master Spec §6.1, sprint §4). Every authenticated request runs inside one database
 * transaction whose tenant context is set transaction-locally; the context therefore
 * cannot outlive the request or leak across a pooled connection (requires the Supabase
 * SESSION-mode pooler / direct connection — NOT transaction-mode).
 *
 * Sprint 1 defines and exercises this contract; Sprint 2 REGISTERS the middleware on the
 * authenticated API group and finalises role resolution (Gates/Policies consume
 * user_roles + role_permissions). The GUC-writing mechanism below is final.
 *
 * Fail-closed by construction: an unauthenticated request sets no context, so every RLS
 * policy compares against NULL and matches nothing.
 */
final class TenantContextMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // No authenticated user → no tenant context. The DB fails closed on its own.
        if ($user === null) {
            return $next($request);
        }

        [$academyId, $role] = $this->resolveContext($user);

        return DB::transaction(function () use ($request, $next, $user, $academyId, $role) {
            TenantContext::apply(
                userId: (string) $user->getKey(),
                academyId: $academyId,
                role: $role,
                local: true, // SET LOCAL: scoped to this request's transaction
            );

            return $next($request);
        });
    }

    /**
     * Resolve the academy + role the request operates within.
     *
     * Sprint 2 owns the full rules (multi-role users, Super Admin "enter academy",
     * request-scoped role selection). Here we read the user's home academy and their
     * single assigned role — enough to honour the §4 contract and drive the tests.
     *
     * @return array{0: ?string, 1: ?string} [academyId, role]
     */
    private function resolveContext(object $user): array
    {
        $academyId = $user->academy_id ?? null;

        $role = DB::table('user_roles')
            ->where('user_id', $user->getKey())
            ->when($academyId !== null, fn ($q) => $q->where('academy_id', $academyId))
            ->value('role');

        return [$academyId !== null ? (string) $academyId : null, $role];
    }
}
