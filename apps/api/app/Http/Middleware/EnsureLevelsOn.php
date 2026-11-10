<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\AuthContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * `levels.on` — the levels list and promotions (docs/centre-profile, Phase 2.1). A centre always has
 * them (`entitled:centre`, unchanged); any other academy once it switched them on itself in
 * Settings → Levels (`academies.levels_enabled`, 2026-11-10). Otherwise the same 402 `entitled:centre`
 * answered before, so nothing that read that changes.
 */
final class EnsureLevelsOn
{
    public function handle(Request $request, Closure $next): Response
    {
        if (app()->bound(AuthContext::class)) {
            $academyId = app(AuthContext::class)->academyId;
            if ($academyId !== null && (bool) DB::table('academies')->where('id', $academyId)->value('levels_enabled')) {
                return $next($request);
            }
        }

        return app(EnsureEntitled::class)->handle($request, $next, 'centre');
    }
}
