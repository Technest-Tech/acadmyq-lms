<?php

declare(strict_types=1);

use App\Support\ModuleSubscriptionBackfill;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\InteractsWithTenancy;

// Phase 1 (docs/superadmin-modules/03-ROADMAP) — TC-M1.1/1.2/1.3: the parity backfill derives the
// correct per-module subscriptions from the current single-plan model.

uses(RefreshDatabase::class, InteractsWithTenancy::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
});

/** Create a legacy academy (as it exists pre-modules) with a plan + optional video override cols. */
function modAcademy(?string $planCode = null, array $extra = [], string $status = 'ACTIVE'): string
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement("select set_config('app.current_academy_id', '', true)");

    $typeId = (string) Str::uuid();
    DB::table('academy_types')->insert(['id' => $typeId, 'code' => 'MT-'.substr($typeId, 0, 8), 'name' => 'M Type']);
    $planId = $planCode !== null ? DB::table('plans')->where('code', $planCode)->value('id') : null;

    $id = (string) Str::uuid();
    DB::table('academies')->insert(array_merge([
        'id' => $id, 'name' => 'Mod Academy', 'academy_type_id' => $typeId, 'plan_id' => $planId,
        'status' => $status, 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
    ], $extra));

    return $id;
}

/** The academy's module subscriptions, keyed by module (read in the academy's own tenant context). */
function modSubs(string $academyId): Collection
{
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);

    return DB::table('module_subscriptions')->where('academy_id', $academyId)->get()->keyBy('module');
}

function planId(string $code): ?string
{
    return DB::table('plans')->where('code', $code)->value('id');
}

it('derives per-module subscriptions from the single-plan state (TC-M1.1)', function () {
    $pro = modAcademy('PRO');
    $basic = modAcademy('BASIC', ['video_access' => 'ENABLED']);
    $meet = modAcademy('MEET');
    $trial = modAcademy(null, [], 'TRIAL');

    ModuleSubscriptionBackfill::run();

    // PRO: MANAGEMENT(PRO) + WHATSAPP(bundled). No VIDEO — video is bundled inside the PRO plan,
    // resolved via the plan's capabilities (no override, no add-on).
    $s = modSubs($pro);
    expect($s->keys()->sort()->values()->all())->toBe(['MANAGEMENT', 'WHATSAPP']);
    expect($s['MANAGEMENT']->plan_id)->toBe(planId('PRO'));
    expect($s['WHATSAPP']->plan_id)->toBe(planId('WA_BUNDLED'));

    // BASIC + a per-academy video grant: MANAGEMENT + WHATSAPP + a VIDEO sub carrying the override.
    $s = modSubs($basic);
    expect($s->keys()->sort()->values()->all())->toBe(['MANAGEMENT', 'VIDEO', 'WHATSAPP']);
    expect($s['MANAGEMENT']->plan_id)->toBe(planId('BASIC'));
    expect(json_decode($s['VIDEO']->overrides, true)['access'])->toBe('ENABLED');

    // MEET (video-only): a single VIDEO sub (the primary), no MANAGEMENT/WHATSAPP.
    $s = modSubs($meet);
    expect($s->keys()->all())->toBe(['VIDEO']);
    expect($s['VIDEO']->plan_id)->toBe(planId('MEET'));

    // Plan-less trial: MANAGEMENT only, plan null, is_trial from the academy status.
    $s = modSubs($trial);
    expect($s->keys()->all())->toBe(['MANAGEMENT']);
    expect($s['MANAGEMENT']->plan_id)->toBeNull();
    expect(DB::table('module_subscriptions')->where('academy_id', $trial)
        ->where('module', 'MANAGEMENT')->where('is_trial', true)->exists())->toBeTrue();
});

it('is idempotent and enforces one live sub per (academy, module) (TC-M1.2)', function () {
    $pro = modAcademy('PRO');

    ModuleSubscriptionBackfill::run();
    ModuleSubscriptionBackfill::run(); // a second pass must not duplicate

    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $pro]);
    expect(DB::table('module_subscriptions')->where('academy_id', $pro)->where('module', 'MANAGEMENT')->count())
        ->toBe(1);

    // A manual second LIVE MANAGEMENT sub violates the partial unique index.
    expect(fn () => DB::table('module_subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $pro, 'module' => 'MANAGEMENT',
        'status' => 'ACTIVE', 'billing_interval' => 'MONTHLY', 'currency' => 'EGP',
    ]))->toThrow(QueryException::class);
});

it('sets a module on every plan and gives the seeded demo academy its module subs (TC-M1.3)', function () {
    expect(DB::table('plans')->whereNull('module')->count())->toBe(0);
    expect(planIdModule('PRO'))->toBe('MANAGEMENT');
    expect(planIdModule('MEET'))->toBe('VIDEO');
    expect(planIdModule('WA_BUNDLED'))->toBe('WHATSAPP');
    expect(planIdModule('WA_STANDARD'))->toBe('WHATSAPP');

    // The demo academy (PRO) is the only seeded academy; the seeder's backfill gave it its subs.
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement("select set_config('app.current_academy_id', '', true)");
    $demo = DB::table('academies')->value('id');

    $mods = modSubs($demo)->keys()->sort()->values()->all();
    expect($mods)->toBe(['MANAGEMENT', 'WHATSAPP']);
});

function planIdModule(string $code): ?string
{
    return DB::table('plans')->where('code', $code)->value('module');
}
