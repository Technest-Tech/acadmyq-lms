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
        // Two readers: the invoicing screens (currency, grouping, billing day) and the Settings
        // page itself. A SUPERVISOR manages settings but is denied every money capability, so gating
        // the read on invoice.read alone broke the academy-name card for exactly the role the
        // Settings tab is shown to.
        if (! Gate::any(['invoice.read', 'specialization.manage', 'settings.manage'])) {
            abort(403, 'This action is unauthorized.');
        }

        $row = DB::table('academies')
            ->select(['id', 'name', 'timezone', 'default_currency', 'country', 'invoice_grouping', 'billing_day'])
            ->first();

        if ($row === null) {
            abort(404, 'Academy not found.');
        }

        return response()->json(['academy' => $row]);
    }

    /** PATCH /api/academy — update name and/or timezone. */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');

        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'timezone' => ['sometimes', 'string', 'max:60'],
            // The defaults every new-person form opens on (country → dial code too; currency).
            'country' => ['sometimes', 'nullable', 'string', 'size:2', 'alpha'],
            'default_currency' => ['sometimes', 'string', 'size:3', 'alpha'],
        ]);

        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to update its settings.');
        }

        $before = DB::table('academies')
            ->select(['name', 'timezone', 'country', 'default_currency'])
            ->first();

        $name = trim($data['name']);
        $timezone = isset($data['timezone']) ? trim($data['timezone']) : ($before->timezone ?? 'UTC');

        $ok = DB::selectOne(
            'select app.update_academy_settings(?, ?) as ok',
            [$name, $timezone],
        )?->ok;

        if (! $ok) {
            abort(500, 'Could not update academy settings.');
        }
        $country = array_key_exists('country', $data) ? strtoupper((string) ($data['country'] ?? '')) : strtoupper((string) ($before->country ?? ''));
        $currency = isset($data['default_currency']) ? strtoupper((string) $data['default_currency']) : (string) ($before->default_currency ?? '');
        if (array_key_exists('country', $data) || isset($data['default_currency'])) {
            DB::selectOne('select app.update_academy_defaults(?, ?) as ok', [$country, $currency]);
        }

        Audit::log(
            'academy.settings',
            'academies',
            $ctx->academyId,
            $ctx->academyId,
            $ctx->userId,
            $ctx->role,
            before: ['name' => $before?->name, 'timezone' => $before?->timezone, 'country' => $before?->country, 'default_currency' => $before?->default_currency],
            after: ['name' => $name, 'timezone' => $timezone, 'country' => $country ?: null, 'default_currency' => $currency],
        );

        return response()->json(['ok' => true]);
    }
}
