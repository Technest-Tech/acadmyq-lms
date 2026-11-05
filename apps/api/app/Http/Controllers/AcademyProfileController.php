<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AcademyLevelLabel;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

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
            ->select(['id', 'name', 'timezone', 'default_currency', 'country', 'invoice_grouping', 'billing_day', 'level_label'])
            ->first();

        if ($row === null) {
            abort(404, 'Academy not found.');
        }
        // What the classification is called; null has always read as LEVEL.
        $row->level_label = AcademyLevelLabel::of($row->level_label);

        return response()->json(['academy' => $row]);
    }

    /**
     * PATCH /api/academy — update the name, timezone, country / currency defaults, or what the
     * classification is called. Each field is optional; what is not sent keeps its value.
     */
    public function update(Request $request): JsonResponse
    {
        // The classification's word sits on the levels card, under the course catalogue a
        // supervisor keeps (specialization.manage); every other field is the owner's settings.
        $onlyLabel = $request->has('level_label') && array_diff(array_keys($request->all()), ['level_label']) === [];
        if ($onlyLabel) {
            if (! Gate::any(['settings.manage', 'specialization.manage'])) {
                abort(403, 'This action is unauthorized.');
            }
        } else {
            Gate::authorize('settings.manage');
        }

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'min:2', 'max:120'],
            'timezone' => ['sometimes', 'string', 'max:60'],
            // The defaults every new-person form opens on (country → dial code too; currency).
            'country' => ['sometimes', 'nullable', 'string', 'size:2', 'alpha'],
            'default_currency' => ['sometimes', 'string', 'size:3', 'alpha'],
            // What the classification is called: a level, a grade, a year (docs/centre-profile §3).
            'level_label' => ['sometimes', Rule::in(AcademyLevelLabel::ALL)],
        ]);

        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to update its settings.');
        }

        $before = DB::table('academies')
            ->select(['name', 'timezone', 'country', 'default_currency', 'level_label'])
            ->first();

        $name = isset($data['name']) ? trim($data['name']) : (string) ($before->name ?? '');
        $timezone = isset($data['timezone']) ? trim($data['timezone']) : ($before->timezone ?? 'UTC');

        if (isset($data['name']) || isset($data['timezone'])) {
            $ok = DB::selectOne(
                'select app.update_academy_settings(?, ?) as ok',
                [$name, $timezone],
            )?->ok;

            if (! $ok) {
                abort(500, 'Could not update academy settings.');
            }
        }
        $country = array_key_exists('country', $data) ? strtoupper((string) ($data['country'] ?? '')) : strtoupper((string) ($before->country ?? ''));
        $currency = isset($data['default_currency']) ? strtoupper((string) $data['default_currency']) : (string) ($before->default_currency ?? '');
        $levelLabel = $data['level_label'] ?? null;
        if (array_key_exists('country', $data) || isset($data['default_currency']) || $levelLabel !== null) {
            DB::selectOne('select app.update_academy_defaults(?, ?, ?) as ok', [$country, $currency, $levelLabel]);
        }

        Audit::log(
            'academy.settings',
            'academies',
            $ctx->academyId,
            $ctx->academyId,
            $ctx->userId,
            $ctx->role,
            before: ['name' => $before?->name, 'timezone' => $before?->timezone, 'country' => $before?->country, 'default_currency' => $before?->default_currency, 'level_label' => $before?->level_label],
            after: ['name' => $name, 'timezone' => $timezone, 'country' => $country ?: null, 'default_currency' => $currency, 'level_label' => $levelLabel ?? $before?->level_label],
        );

        return response()->json(['ok' => true]);
    }
}
