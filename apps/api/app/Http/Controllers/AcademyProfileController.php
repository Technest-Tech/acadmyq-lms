<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Academy-owner-facing profile settings (Settings → General).
 *
 * The academy owner can read their own academy row (the SELECT RLS policy allows it)
 * and update the name + timezone via a SECURITY DEFINER function (the UPDATE policy
 * restricts direct writes to Super Admin only, so the function is the safe bypass).
 */
final class AcademyProfileController extends Controller
{
    /** GET /api/academy — the current academy's editable profile fields. */
    public function show(): JsonResponse
    {
        Gate::authorize('invoice.read');

        $row = DB::table('academies')
            ->select(['id', 'name', 'timezone', 'default_currency', 'invoice_grouping', 'billing_day'])
            ->first();

        if ($row === null) {
            abort(404, 'Academy not found.');
        }

        return response()->json(['academy' => $row]);
    }

    /** PATCH /api/academy — update name and/or timezone. */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $data = $request->validate([
            'name'     => ['required', 'string', 'min:2', 'max:120'],
            'timezone' => ['sometimes', 'string', 'max:60'],
        ]);

        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to update its settings.');
        }

        $before = DB::table('academies')
            ->select(['name', 'timezone'])
            ->first();

        $name     = trim($data['name']);
        $timezone = isset($data['timezone']) ? trim($data['timezone']) : ($before->timezone ?? 'UTC');

        $ok = DB::selectOne(
            'select app.update_academy_settings(?, ?) as ok',
            [$name, $timezone],
        )?->ok;

        if (! $ok) {
            abort(500, 'Could not update academy settings.');
        }

        Audit::log(
            'academy.settings',
            'academies',
            $ctx->academyId,
            $ctx->academyId,
            $ctx->userId,
            $ctx->role,
            before: ['name' => $before?->name, 'timezone' => $before?->timezone],
            after:  ['name' => $name, 'timezone' => $timezone],
        );

        return response()->json(['ok' => true]);
    }
}
