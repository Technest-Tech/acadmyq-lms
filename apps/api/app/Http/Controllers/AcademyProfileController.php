<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AcademyLevelLabel;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\OnlineLessons;
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

        // Always by id, never "the one row RLS lets me see": academies_select also admits a Super
        // Admin to EVERY academy, so an unfiltered first() inside an entered academy answered with
        // whichever academy came first — another client's name, timezone and currency on this
        // academy's Settings, written back over this academy on the next save.
        $academyId = app(AuthContext::class)->academyId;
        if ($academyId === null) {
            abort(404, 'Academy not found.');
        }

        $row = DB::table('academies')
            ->where('id', $academyId)
            ->select(['id', 'name', 'timezone', 'default_currency', 'country', 'invoice_grouping', 'billing_day', 'level_label', 'online_lessons', 'levels_enabled'])
            ->first();

        if ($row === null) {
            abort(404, 'Academy not found.');
        }
        // What the classification is called; null has always read as LEVEL.
        $row->level_label = AcademyLevelLabel::of($row->level_label);
        // `online_lessons` is what the academy said (null = automatic); this is what it comes to.
        $row->online_lessons_effective = OnlineLessons::forAcademy((string) $row->id);

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
        // So does the levels switch beside it (a Quran academy turning its levels list on).
        $levelKeys = ['level_label', 'levels_enabled'];
        $onlyLabel = $request->hasAny($levelKeys) && array_diff(array_keys($request->all()), $levelKeys) === [];
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
            // Whether Enter, meeting links and Punctuality exist: on, off, or null = automatic.
            'online_lessons' => ['sometimes', 'nullable', 'boolean'],
            // A Quran academy's levels list, on or off (a centre always has it).
            'levels_enabled' => ['sometimes', 'boolean'],
        ]);

        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to update its settings.');
        }

        // By id (see show()): the fallback name/timezone below come from this row.
        $before = DB::table('academies')
            ->where('id', $ctx->academyId)
            ->select(['name', 'timezone', 'country', 'default_currency', 'level_label', 'online_lessons', 'levels_enabled'])
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
        $onlineLessons = ! array_key_exists('online_lessons', $data)
            ? null
            : ($data['online_lessons'] === null ? 'AUTO' : ($request->boolean('online_lessons') ? 'ON' : 'OFF'));
        $levelsEnabled = array_key_exists('levels_enabled', $data) ? $request->boolean('levels_enabled') : null;
        if (array_key_exists('country', $data) || isset($data['default_currency']) || $levelLabel !== null || $onlineLessons !== null || $levelsEnabled !== null) {
            DB::selectOne('select app.update_academy_defaults(?, ?, ?, ?, ?::boolean) as ok', [$country, $currency, $levelLabel, $onlineLessons, $levelsEnabled === null ? null : ($levelsEnabled ? 'true' : 'false')]);
        }

        Audit::log(
            'academy.settings',
            'academies',
            $ctx->academyId,
            $ctx->academyId,
            $ctx->userId,
            $ctx->role,
            before: ['name' => $before?->name, 'timezone' => $before?->timezone, 'country' => $before?->country, 'default_currency' => $before?->default_currency, 'level_label' => $before?->level_label, 'online_lessons' => $before?->online_lessons, 'levels_enabled' => $before?->levels_enabled],
            after: ['name' => $name, 'timezone' => $timezone, 'country' => $country ?: null, 'default_currency' => $currency, 'level_label' => $levelLabel ?? $before?->level_label, 'online_lessons' => $onlineLessons ?? $before?->online_lessons, 'levels_enabled' => $levelsEnabled ?? $before?->levels_enabled],
        );

        return response()->json(['ok' => true]);
    }
}
