<?php

declare(strict_types=1);

use App\Support\FeatureCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * docs/superadmin-modules/05-MODULES-NOT-PACKAGES §7 — packages out, client types + modules in.
 *
 * Non-destructive: it ADDS `academies.client_type`, makes sure every client actually holds the
 * module rows its type implies, and folds CRM back into the management system. Nothing is dropped —
 * `plans`, `module_subscriptions.plan_id` and the `academies.video_*` columns stay for the legacy
 * fallback and the ops screens until the R5b cleanup session.
 *
 * NO FORCE-RLS DDL (M-PROC-2): every tenant-table read/write runs under a per-academy context, so
 * re-running this inside MigrationsRollbackTest's transaction can never poison the connection.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academies
              add column if not exists client_type text not null default 'MANAGEMENT';

            alter table academies drop constraint if exists academies_client_type_chk;
            alter table academies add constraint academies_client_type_chk
              check (client_type in ('MANAGEMENT', 'VIDEO', 'WHATSAPP', 'LMS'));
        SQL);

        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        $academies = DB::table('academies')->get(['id', 'plan_id', 'default_currency']);

        foreach ($academies as $academy) {
            $id = (string) $academy->id;
            DB::statement("select set_config('app.current_academy_id', ?, true)", [$id]);

            $subs = DB::table('module_subscriptions as ms')
                ->leftJoin('plans as p', 'p.id', '=', 'ms.plan_id')
                ->where('ms.academy_id', $id)
                ->where('ms.status', '<>', 'ENDED')
                ->get(['ms.id', 'ms.module', 'p.module as plan_module']);

            // 1. An LMS client provisioned as "MANAGEMENT sub carrying an LMS plan" (docs/lms) is a
            //    real LMS client — move the row onto the LMS module so its type and its subs agree.
            $lmsOnMgmt = $subs->first(
                static fn (object $s): bool => $s->module === 'MANAGEMENT' && ($s->plan_module ?? null) === 'LMS'
            );
            if ($lmsOnMgmt !== null && $subs->firstWhere('module', 'LMS') === null) {
                DB::table('module_subscriptions')->where('id', $lmsOnMgmt->id)->update([
                    'module' => 'LMS',
                    'updated_at' => now(),
                ]);
                $lmsOnMgmt->module = 'LMS';
            }

            // 2. CRM stops being a module — it is a management feature now. Its live sub is history.
            $crm = $subs->firstWhere('module', 'CRM');
            if ($crm !== null) {
                DB::table('module_subscriptions')->where('id', $crm->id)->update([
                    'status' => 'ENDED',
                    'canceled_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            $modules = $subs
                ->reject(static fn (object $s): bool => $s->module === 'CRM')
                ->pluck('module')
                ->all();

            // 3. The client's type: whatever its live modules already say, else its legacy plan.
            $type = $this->deriveType($modules, $academy->plan_id);

            DB::table('academies')->where('id', $id)->update([
                'client_type' => $type,
                'updated_at' => now(),
            ]);

            // 4. Every client holds its type's primary module — otherwise the resolver would fall
            //    back to the (now meaningless) plan path and the client would lose everything.
            $primary = FeatureCatalog::CLIENT_TYPE_PRIMARY[$type];
            if (! in_array($primary, $modules, true)) {
                $this->seedPrimarySub($id, $primary, (string) ($academy->default_currency ?? 'EGP'));
            }

            // 5. A module the client's OLD PACKAGE bundled (PRO bundled video + WhatsApp) has to
            //    become a real module row, or this deploy would silently take the feature away.
            $this->preserveBundledModules($id, $type, $modules, (string) ($academy->default_currency ?? 'EGP'));
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");

        $this->seedDefaultPricing();
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academies drop constraint if exists academies_client_type_chk;
            alter table academies drop column if exists client_type;
        SQL);

        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        DB::table('platform_settings')->where('key', 'module_pricing')->delete();
    }

    /**
     * MANAGEMENT wins whenever the client has one (it may also hold Video/WhatsApp); a single-module
     * client is named after that module. With no live modules at all, the legacy plan's own module
     * decides — that is exactly what the old resolver keyed on.
     *
     * @param  list<string>  $modules
     */
    private function deriveType(array $modules, mixed $planId): string
    {
        if (in_array('MANAGEMENT', $modules, true)) {
            return 'MANAGEMENT';
        }
        foreach (['LMS', 'VIDEO', 'WHATSAPP'] as $single) {
            if (in_array($single, $modules, true)) {
                return $single;
            }
        }

        $planModule = $planId === null
            ? null
            : DB::table('plans')->where('id', $planId)->value('module');

        return in_array($planModule, ['VIDEO', 'WHATSAPP', 'LMS'], true) ? (string) $planModule : 'MANAGEMENT';
    }

    /**
     * Video / WhatsApp used to ride along inside a package (a PRO academy simply HAD the video
     * classroom). Modules are sold per module now, so whatever the client's plan or add-ons grant
     * today becomes an actual module row at zero price — a Super Admin prices or removes it in the
     * profile. A force-DISABLED video grant is respected: no row, no access, exactly as today.
     *
     * @param  list<string>  $modules  the client's live module codes
     */
    private function preserveBundledModules(string $academyId, string $clientType, array $modules, string $currency): void
    {
        if ($clientType !== 'MANAGEMENT') {
            return; // single-module clients hold exactly their own module
        }

        $academy = DB::table('academies')->where('id', $academyId)->first(['plan_id', 'video_access']);
        $capabilities = $this->legacyCapabilities($academyId, $academy->plan_id ?? null);

        $wanted = [];
        if (in_array('video.conferencing', $capabilities, true) && ($academy->video_access ?? null) !== 'DISABLED') {
            $wanted[] = 'VIDEO';
        }
        if (in_array('whatsapp.automation', $capabilities, true)) {
            $wanted[] = 'WHATSAPP';
        }

        foreach ($wanted as $module) {
            if (in_array($module, $modules, true)) {
                continue;
            }

            DB::table('module_subscriptions')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'module' => $module,
                'plan_id' => null,
                'status' => 'ACTIVE',
                'is_trial' => false,
                'activated_at' => now(),
                'billing_interval' => 'MONTHLY',
                'base_price_minor' => 0,
                'addons_price_minor' => 0,
                'total_cost_minor' => 0,
                'currency' => $currency,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * What the client's package + active add-ons grant TODAY, read straight from the catalog (the
     * pre-modules resolution rule) — the migration cannot ask Entitlement, which already speaks the
     * new model by the time this runs.
     *
     * @return list<string>
     */
    private function legacyCapabilities(string $academyId, mixed $planId): array
    {
        $features = $planId === null ? null : DB::table('plans')->where('id', $planId)->value('features');
        $decoded = is_string($features) ? json_decode($features, true) : (is_array($features) ? $features : null);
        $capabilities = is_array($decoded['capabilities'] ?? null) ? array_map('strval', $decoded['capabilities']) : [];

        $addOns = DB::table('academy_addons as aa')
            ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
            ->where('aa.academy_id', $academyId)
            ->where('aa.is_active', true)
            ->pluck('ao.feature_key')
            ->all();

        return array_values(array_unique(array_merge($capabilities, array_map('strval', $addOns))));
    }

    /** Create the type's primary module row, mirroring the academy's legacy subscription lifecycle. */
    private function seedPrimarySub(string $academyId, string $module, string $currency): void
    {
        $legacy = DB::table('academy_subscriptions')
            ->where('academy_id', $academyId)
            ->where('status', '<>', 'ENDED')
            ->orderByDesc('created_at')
            ->first();

        DB::table('module_subscriptions')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'module' => $module,
            'plan_id' => null,
            'status' => $legacy->status ?? 'ACTIVE',
            'is_trial' => (bool) ($legacy->is_trial ?? false),
            'trial_start' => $legacy->trial_start ?? null,
            'trial_end' => $legacy->trial_end ?? null,
            'activated_at' => $legacy->activated_at ?? now(),
            'current_period_start' => $legacy->current_period_start ?? null,
            'current_period_end' => $legacy->current_period_end ?? null,
            'billing_interval' => $legacy->billing_interval ?? 'MONTHLY',
            'base_price_minor' => (int) ($legacy->base_price_minor ?? 0),
            'addons_price_minor' => 0,
            'total_cost_minor' => (int) ($legacy->base_price_minor ?? 0),
            'currency' => (string) ($legacy->currency ?? $currency),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Pre-fill the per-module default price (§5) from what the catalog charged for that module today,
     * so the profile's price field opens on a sane number instead of zero. Purely a form default.
     */
    private function seedDefaultPricing(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        if (DB::table('platform_settings')->where('key', 'module_pricing')->exists()) {
            return;
        }

        $pricing = [];
        foreach (['MANAGEMENT', 'VIDEO', 'WHATSAPP', 'LMS'] as $module) {
            $plan = DB::table('plans')
                ->where('module', $module)
                ->where('is_active', true)
                ->where('price_minor', '>', 0)
                ->orderByDesc('price_minor')
                ->first(['price_minor', 'currency']);

            $pricing[$module] = [
                'price_minor' => (int) ($plan->price_minor ?? 0),
                'currency' => (string) ($plan->currency ?? 'EGP'),
            ];
        }

        DB::table('platform_settings')->insert([
            'key' => 'module_pricing',
            'value' => json_encode($pricing),
            'updated_at' => now(),
        ]);
    }
};
