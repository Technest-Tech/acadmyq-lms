<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AcademySettings;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Academy controls (Settings → Controls): the switches an academy flips to turn features on or
 * off for its own users. Read and write both sit on `specialization.manage` — the "settings"
 * capability the rest of the Settings page uses. What each switch DOES is enforced elsewhere
 * (see {@see AcademySettings}); this only stores it.
 */
final class AcademySettingsController extends Controller
{
    /** GET /api/academy/settings */
    public function show(): JsonResponse
    {
        Gate::authorize('specialization.manage');

        return response()->json(['settings' => AcademySettings::forAcademy($this->academyId())]);
    }

    /** PUT /api/academy/settings */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('specialization.manage');

        // Each switch is optional, so a client may send just the one it flipped; anything left out
        // keeps its stored value.
        $data = $request->validate(array_map(
            fn () => ['sometimes', 'boolean'],
            AcademySettings::DEFAULTS,
        ));

        $academyId = $this->academyId();
        $before = AcademySettings::forAcademy($academyId);

        DB::table('academy_settings')->updateOrInsert(
            ['academy_id' => $academyId],
            [...$before, ...$data, 'updated_at' => now()],
        );

        $ctx = app(AuthContext::class);
        Audit::log(
            'academy.controls_updated',
            'academy',
            $academyId,
            $academyId,
            $ctx->userId,
            $ctx->role,
            before: $before,
            after: $data,
        );

        return response()->json(['settings' => AcademySettings::forAcademy($academyId)]);
    }

    private function academyId(): string
    {
        $academyId = app(AuthContext::class)->academyId;
        if ($academyId === null) {
            abort(403, 'Enter an academy to manage its settings.');
        }

        return $academyId;
    }
}
