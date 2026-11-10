<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\AcademyProfile;
use App\Support\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Change an existing client's PROFILE from the Super Admin panel — the same move `profile:set` makes
 * on the server, with a preview first and a refusal where the move would strand money.
 *
 *   QURAN  → CENTRE: the type changes and the centre's preset is MERGED onto the MANAGEMENT
 *                    switches (receipts + the centre's ways on, the one-to-one Quran features off).
 *   CENTRE → QURAN : the type changes and the centre's preset is UNWOUND: `centre` comes off, the
 *                    Quran features it had switched off come back. `accounting` stays on when the
 *                    academy already keeps receipts (a Quran academy may run on receipts too).
 *
 * Refused while the academy holds live money of the engine the move would retire (see MoneyPolicy:
 * `centre` ON + `packages` OFF is what hands a private lesson's money to the centre's subscriptions):
 *   - onto CENTRE with ACTIVE hour packages — those move first, with `centre:migrate-packages`;
 *   - back to QURAN with OPEN centre subscriptions — they would have no engine left to bill them.
 * An academy that has not sold anything yet (the usual case: it was created with the wrong type)
 * moves freely. Must run inside the academy's context as SUPER_ADMIN (RLS on every row read here).
 */
final class ProfileSwitch
{
    public function __construct(private readonly ModuleBilling $modules) {}

    /**
     * What moving the academy onto $to would do, without doing it.
     *
     * @return array{from: string, to: string, turned_on: list<string>, turned_off: list<string>,
     *               blocker: array{code: string, count: int}|null, has_management: bool}
     */
    public function preview(string $academyId, string $to): array
    {
        $from = AcademyProfile::forAcademy($academyId);
        [$enabledNow, $disabledNow, $hasManagement] = $this->switchesNow($academyId);
        [$enabled, $disabled] = $from === $to
            ? [$enabledNow, $disabledNow]
            : $this->switchesAfter($enabledNow, $disabledNow, $to, $this->keepsReceipts($academyId));

        return [
            'from' => $from,
            'to' => $to,
            // A feature is ON when it is an enabled opt-in or a module feature not disabled; the
            // two lists below are what that reading changes, whichever store holds the key.
            'turned_on' => $hasManagement ? array_values(array_unique([
                ...array_diff($enabled, $enabledNow),
                ...array_diff($disabledNow, $disabled),
            ])) : [],
            'turned_off' => $hasManagement ? array_values(array_unique([
                ...array_diff($enabledNow, $enabled),
                ...array_diff($disabled, $disabledNow),
            ])) : [],
            'blocker' => $from === $to ? null : $this->blocker($academyId, $to),
            'has_management' => $hasManagement,
        ];
    }

    /**
     * Move the academy onto $to. Refuses (422) a no-op or a move the preview blocks.
     *
     * @return array{from: string, to: string, turned_on: list<string>, turned_off: list<string>,
     *               blocker: null, has_management: bool}
     */
    public function apply(string $academyId, string $to, string $actorUserId): array
    {
        return DB::transaction(function () use ($academyId, $to, $actorUserId): array {
            $plan = $this->preview($academyId, $to);
            if ($plan['from'] === $to) {
                throw ValidationException::withMessages(['profile' => ['The academy is already on this type.']]);
            }
            if ($plan['blocker'] !== null) {
                throw ValidationException::withMessages(['profile' => [$this->blockerMessage($plan['blocker'])]]);
            }

            $typeId = DB::table('academy_types')->where('code', $to)->value('id');
            if ($typeId === null) {
                throw ValidationException::withMessages(['profile' => ["No academy type '{$to}' — run the migrations first."]]);
            }

            $before = $this->modules->current($academyId, 'MANAGEMENT')?->overrides;
            $beforeType = DB::table('academies')->where('id', $academyId)->value('academy_type_id');

            DB::table('academies')->where('id', $academyId)->update(['academy_type_id' => $typeId]);

            if ($plan['has_management']) {
                [$enabledNow, $disabledNow] = $this->switchesNow($academyId);
                [$enabled, $disabled] = $this->switchesAfter($enabledNow, $disabledNow, $to, $this->keepsReceipts($academyId));
                $this->modules->setDisabledFeatures($academyId, 'MANAGEMENT', $disabled, $enabled);
            }

            Audit::log('academy.profile', 'academy', $academyId, $academyId, $actorUserId, 'SUPER_ADMIN', after: [
                'type_code' => $to,
                'turned_on' => $plan['turned_on'],
                'turned_off' => $plan['turned_off'],
                'source' => 'admin_panel',
            ], before: [
                'type_code' => $plan['from'],
                'academy_type_id' => $beforeType,
                'overrides' => $before === null ? null : json_decode((string) $before, true),
            ]);

            return $plan;
        });
    }

    /**
     * The MANAGEMENT switches once the academy is on $to.
     *
     * @param  list<string>  $enabled
     * @param  list<string>  $disabled
     * @return array{0: list<string>, 1: list<string>}
     */
    public function switchesAfter(array $enabled, array $disabled, string $to, bool $keepAccounting): array
    {
        $centre = AcademyProfile::PRESETS[AcademyProfile::CENTRE];

        if ($to === AcademyProfile::CENTRE) {
            // The same merge AcademyProfile::applyPreset makes on create and in profile:set.
            $enabled = array_values(array_unique([...$enabled, ...$centre['enabled']]));
            $disabled = array_values(array_diff(array_unique([...$disabled, ...$centre['disabled']]), $centre['enabled']));

            return [$enabled, $disabled];
        }

        $drop = $keepAccounting ? array_diff($centre['enabled'], ['accounting']) : $centre['enabled'];

        return [
            array_values(array_diff($enabled, $drop)),
            array_values(array_diff($disabled, $centre['disabled'])),
        ];
    }

    /** @return array{0: list<string>, 1: list<string>, 2: bool} enabled, disabled, MANAGEMENT held */
    private function switchesNow(string $academyId): array
    {
        $sub = $this->modules->current($academyId, 'MANAGEMENT');
        if ($sub === null) {
            return [[], [], false];
        }
        $ov = json_decode((string) ($sub->overrides ?? ''), true);
        $ov = is_array($ov) ? $ov : [];

        return [
            array_values(array_map('strval', (array) ($ov['enabled'] ?? []))),
            array_values(array_map('strval', (array) ($ov['disabled'] ?? []))),
            true,
        ];
    }

    /** @return array{code: string, count: int}|null */
    private function blocker(string $academyId, string $to): ?array
    {
        if ($to === AcademyProfile::CENTRE) {
            $open = DB::table('lesson_packages')->where('academy_id', $academyId)->where('status', 'ACTIVE')->count();

            return $open > 0 ? ['code' => 'open_packages', 'count' => $open] : null;
        }

        $open = DB::table('centre_subscriptions')->where('academy_id', $academyId)->where('status', 'OPEN')->count();

        return $open > 0 ? ['code' => 'open_subscriptions', 'count' => $open] : null;
    }

    private function keepsReceipts(string $academyId): bool
    {
        return DB::table('receipts')->where('academy_id', $academyId)->exists();
    }

    /** @param array{code: string, count: int} $blocker */
    private function blockerMessage(array $blocker): string
    {
        return $blocker['code'] === 'open_packages'
            ? "The academy has {$blocker['count']} active hour packages. Move them onto centre subscriptions first (centre:migrate-packages)."
            : "The academy has {$blocker['count']} open centre subscriptions. Close them first.";
    }
}
