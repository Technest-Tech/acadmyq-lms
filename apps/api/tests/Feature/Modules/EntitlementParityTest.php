<?php

declare(strict_types=1);

use App\Support\Entitlement;
use App\Support\ModuleSubscriptionBackfill;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\InteractsWithTenancy;

// Phase 2 (docs/superadmin-modules) — AC-M2.1 / M-ENT-1: the module-subscription resolver
// (Entitlement::resolveFromModules) must resolve BYTE-IDENTICAL capabilities, limits, plan and
// add-ons to the live single-plan resolver (Entitlement::resolve) for every academy shape, once the
// Phase-1 backfill has derived that academy's module subs. This is the gate that must be green
// before the resolver cutover.

uses(RefreshDatabase::class, InteractsWithTenancy::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class); // plan catalog (FREE/BASIC/PRO/MEET), WA plans, VIDEO add-ons
    $this->clearTenantContext();
});

/** Create a legacy-shaped academy (plan + optional video columns + optional active add-on). */
function pAcademy(?string $planCode, array $video = [], string $status = 'ACTIVE', ?string $addonCode = null): string
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement("select set_config('app.current_academy_id', '', true)");

    $typeId = (string) Str::uuid();
    DB::table('academy_types')->insert(['id' => $typeId, 'code' => 'ET-'.substr($typeId, 0, 8), 'name' => 'ET']);
    $planId = $planCode !== null ? DB::table('plans')->where('code', $planCode)->value('id') : null;

    $id = (string) Str::uuid();
    $row = array_merge([
        'id' => $id, 'name' => 'Parity Academy', 'academy_type_id' => $typeId, 'plan_id' => $planId,
        'status' => $status, 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
    ], $video);
    if (isset($row['video_overrides']) && is_array($row['video_overrides'])) {
        $row['video_overrides'] = json_encode($row['video_overrides']);
    }
    DB::table('academies')->insert($row);

    if ($addonCode !== null) {
        $addOnId = DB::table('add_ons')->where('code', $addonCode)->value('id');
        DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $id]);
        DB::table('academy_addons')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $id, 'add_on_id' => $addOnId,
            'is_active' => true, 'granted_at' => now(),
        ]);
    }

    return $id;
}

/** Assert the two resolvers agree for one academy (read in its own context). */
function assertParity(string $academyId, string $label): void
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);

    $old = Entitlement::resolve($academyId);
    $new = Entitlement::resolveFromModules($academyId);

    $oldCaps = $old['capabilities'];
    $newCaps = $new['capabilities'];
    sort($oldCaps);
    sort($newCaps);

    expect($newCaps)->toBe($oldCaps, "capabilities differ for {$label}");
    expect($new['limits'])->toEqual($old['limits'], "limits differ for {$label}");
    expect($new['plan'])->toBe($old['plan'], "plan differs for {$label}");

    $oldAdd = $old['addOns'];
    $newAdd = $new['addOns'];
    sort($oldAdd);
    sort($newAdd);
    expect($newAdd)->toBe($oldAdd, "addOns differ for {$label}");
}

it('resolves byte-identically to the single-plan resolver for every academy shape (AC-M2.1)', function () {
    $future = now()->addYear();
    $past = now()->subDay();
    $meetId = DB::table('plans')->where('code', 'MEET')->value('id');

    $cases = [
        'PRO' => pAcademy('PRO'),
        'BASIC' => pAcademy('BASIC'),
        'FREE-trial' => pAcademy('FREE', [], 'TRIAL'),
        'MEET' => pAcademy('MEET'),
        'BASIC+video-grant' => pAcademy('BASIC', ['video_access' => 'ENABLED', 'video_trial_ends_at' => $future]),
        'BASIC+video-grant-notrial' => pAcademy('BASIC', ['video_access' => 'ENABLED']),
        'BASIC+video-expired' => pAcademy('BASIC', ['video_access' => 'ENABLED', 'video_trial_ends_at' => $past]),
        'BASIC+video-disabled' => pAcademy('BASIC', ['video_access' => 'DISABLED']),
        'BASIC+video-addon' => pAcademy('BASIC', [], 'ACTIVE', 'VIDEO_EGP'),
        'BASIC+addon+disabled' => pAcademy('BASIC', ['video_access' => 'DISABLED'], 'ACTIVE', 'VIDEO_EGP'),
        'PRO+video-tier+override' => pAcademy('PRO', [
            'video_plan_id' => $meetId,
            'video_overrides' => ['limits' => ['maxRoomParticipants' => 10]],
        ]),
        'planless' => pAcademy(null),
        'MEET+override' => pAcademy('MEET', ['video_overrides' => ['limits' => ['maxRooms' => 3]]]),
    ];

    // Derive each academy's module subs from its single-plan state, then compare the resolvers.
    ModuleSubscriptionBackfill::run();

    foreach ($cases as $label => $id) {
        assertParity($id, $label);
    }
});
