<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\ModuleBilling;
use App\Support\AcademyProfile;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Move ONE existing academy onto a profile (App\Support\AcademyProfile): its type row changes,
 * and — unless told otherwise — the profile's preset is merged onto its MANAGEMENT switches.
 * Nothing else moves: no table, no row, no money. Moving back is the same command the other way.
 *
 * Always dry-run first: it prints what the academy holds and what would change.
 *
 *   php artisan profile:set <academy-uuid|exact name> CENTRE --dry-run
 *   php artisan profile:set <academy-uuid|exact name> CENTRE
 *   php artisan profile:set <academy-uuid|exact name> QURAN --no-preset
 */
final class ProfileSet extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'profile:set
        {academy : The academy id, or its exact name}
        {profile : QURAN or CENTRE}
        {--no-preset : Change the type only; leave every feature switch as it is}
        {--dry-run : Print what would change and change nothing}';

    protected $description = "Move an academy onto a profile (its type) and merge the profile's preset onto its switches.";

    public function handle(ModuleBilling $modules): int
    {
        $profile = strtoupper((string) $this->argument('profile'));
        if (! in_array($profile, AcademyProfile::ALL, true)) {
            $this->error('Profile must be one of: '.implode(', ', AcademyProfile::ALL).'.');

            return self::FAILURE;
        }

        // Find the academy platform-wide (the academies table lets a Super Admin see every row)…
        [$academy, $typeId] = DB::transaction(function () use ($profile): array {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
            $needle = (string) $this->argument('academy');

            $academy = DB::table('academies as a')
                ->leftJoin('academy_types as t', 't.id', '=', 'a.academy_type_id')
                ->where(fn ($q) => $q->whereRaw('a.id::text = ?', [$needle])->orWhere('a.name', $needle))
                ->first(['a.id', 'a.name', 't.code as type_code']);

            return [$academy, DB::table('academy_types')->where('code', $profile)->value('id')];
        });

        if ($academy === null) {
            $this->error("No academy '{$this->argument('academy')}'.");

            return self::FAILURE;
        }
        if ($typeId === null) {
            $this->error("No academy type '{$profile}' — run the migrations first.");

            return self::FAILURE;
        }

        // …then read its switches inside its own context: module rows are RLS-scoped to the tenant.
        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: (string) $academy->id, role: 'SUPER_ADMIN', permissions: []);
        $before = Tenancy::withContext($ctx, function () use ($modules, $academy): ?array {
            $sub = $modules->current((string) $academy->id, 'MANAGEMENT');
            $ov = $sub === null ? null : json_decode((string) ($sub->overrides ?? ''), true);

            return is_array($ov) ? $ov : null;
        });

        $from = AcademyProfile::fromTypeCode($academy->type_code);
        $withPreset = ! $this->option('no-preset');
        $this->line("{$academy->name}: {$from} ({$academy->type_code}) → {$profile}");
        $this->line('  switches now: '.json_encode($before ?? [], JSON_UNESCAPED_SLASHES));
        $this->line('  preset merge: '.json_encode($withPreset ? AcademyProfile::PRESETS[$profile] : [], JSON_UNESCAPED_SLASHES));

        if ($this->option('dry-run')) {
            $this->info('Dry run — nothing changed.');

            return self::SUCCESS;
        }

        $after = Tenancy::withContext($ctx, function () use ($modules, $academy, $profile, $typeId, $before, $withPreset) {
            DB::table('academies')->where('id', $academy->id)->update(['academy_type_id' => $typeId]);

            $after = $withPreset ? AcademyProfile::applyPreset($modules, (string) $academy->id, $profile) : null;

            Audit::log('academy.profile', 'academy', (string) $academy->id, (string) $academy->id, self::SYSTEM_USER_ID, 'SUPER_ADMIN', after: [
                'type_code' => $profile,
                'overrides' => $after,
                'source' => 'profile:set',
            ], before: [
                'type_code' => $academy->type_code,
                'overrides' => $before,
            ]);

            return $after;
        });

        $this->info("Done. Type is {$profile}".($after === null ? ', switches untouched.' : '; switches now '.json_encode($after, JSON_UNESCAPED_SLASHES).'.'));

        return self::SUCCESS;
    }
}
