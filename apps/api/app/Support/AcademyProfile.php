<?php

declare(strict_types=1);

namespace App\Support;

use App\Services\ModuleBilling;
use Illuminate\Support\Facades\DB;

/**
 * The academy's PROFILE — which kind of school this is, read off `academy_types.code`.
 *
 * Two profiles exist. QURAN is the one-to-one academy the system grew up with (private lessons,
 * hour packages, supervision, the memorisation report). CENTRE is the learning centre — English
 * course academies and curriculum "سناتر" alike — that teaches GROUPS, sells subscriptions in
 * lessons and keeps numbered receipts.
 *
 * The profile decides two things and nothing else:
 *   1. the PRESET a new client starts from — which opt-in features are switched on and which
 *      Quran-only ones are switched off (the switches themselves stay the real gates, see
 *      {@see Entitlement}; the profile only bundles them so a client is one choice, not seven);
 *   2. the SHAPE of the workspace — sidebar order, dashboard, wording — which the web reads from
 *      the session (`academy.profile`).
 *
 * Behaviour that differs between the two never keys on the profile directly: it keys on the
 * feature switch that owns it (`centre`, `accounting`, `groups`), exactly as before. That is what
 * keeps a Quran academy's code path byte-for-byte what it was.
 */
final class AcademyProfile
{
    public const QURAN = 'QURAN';

    public const CENTRE = 'CENTRE';

    public const ALL = [self::QURAN, self::CENTRE];

    /**
     * What a client of each profile starts with on its MANAGEMENT module. `enabled` are the opt-in
     * features switched ON; `disabled` the module features switched OFF. Everything else the module
     * owns stays granted (packages included — a centre's packages ARE its lesson subscriptions).
     *
     * @var array<string, array{enabled: list<string>, disabled: list<string>}>
     */
    public const PRESETS = [
        // The default the system always had: nothing opted in, nothing switched off.
        self::QURAN => ['enabled' => [], 'disabled' => []],
        self::CENTRE => [
            'enabled' => ['centre', 'accounting'],
            // Built for the one-to-one Quran lesson: following a lesson that was not marked, the
            // rubric that scores a teacher, the memorisation report and its picture — and the hour
            // packages, because a centre's private subscription is its own engine
            // (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md): with `packages` off,
            // MoneyPolicy hands a centre's lessons to CentreSubscriptions.
            'disabled' => ['supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages'],
        ],
    ];

    /** The profile behind an `academy_types.code` — anything that is not a centre is the Quran default. */
    public static function fromTypeCode(?string $code): string
    {
        return $code === self::CENTRE ? self::CENTRE : self::QURAN;
    }

    /**
     * The academy's profile. Reads through the BYPASSRLS-safe join on `academies`, which under a
     * tenant context can only ever see the caller's own row.
     */
    public static function forAcademy(?string $academyId): string
    {
        if ($academyId === null) {
            return self::QURAN;
        }

        $code = DB::table('academies as a')
            ->leftJoin('academy_types as t', 't.id', '=', 'a.academy_type_id')
            ->where('a.id', $academyId)
            ->value('t.code');

        return self::fromTypeCode($code === null ? null : (string) $code);
    }

    /**
     * Apply a profile's preset to the academy's MANAGEMENT module, MERGING with what is already
     * switched: a feature the Super Admin switched off stays off, one they opted into stays on. Only
     * the preset's own keys move. Returns what changed, or null when the module is not enabled.
     *
     * @return array{enabled: list<string>, disabled: list<string>}|null
     */
    public static function applyPreset(ModuleBilling $modules, string $academyId, string $profile): ?array
    {
        $preset = self::PRESETS[$profile] ?? self::PRESETS[self::QURAN];

        $sub = $modules->current($academyId, 'MANAGEMENT');
        if ($sub === null) {
            return null;
        }

        $ov = json_decode((string) ($sub->overrides ?? ''), true);
        $ov = is_array($ov) ? $ov : [];
        $wasEnabled = array_map('strval', (array) ($ov['enabled'] ?? []));
        $wasDisabled = array_map('strval', (array) ($ov['disabled'] ?? []));

        $enabled = array_values(array_unique([...$wasEnabled, ...$preset['enabled']]));
        $disabled = array_values(array_unique([...$wasDisabled, ...$preset['disabled']]));
        // A key the preset switches ON cannot also be switched OFF.
        $disabled = array_values(array_diff($disabled, $preset['enabled']));

        $modules->setDisabledFeatures($academyId, 'MANAGEMENT', $disabled, $enabled);

        return ['enabled' => $enabled, 'disabled' => $disabled];
    }
}
