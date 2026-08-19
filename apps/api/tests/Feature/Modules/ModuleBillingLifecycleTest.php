<?php

declare(strict_types=1);

use App\Jobs\ExpireAcademyTrialsJob;
use App\Services\AcademyBilling;
use App\Services\ModuleBilling;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\Tenancy;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// R1 (docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN §5) — the per-module subscription engine:
// enable/trial/activate/pause per module through /admin/clients/*, scoped suspension (M-BILL-2 /
// AC-M2.3), the per-module trial expiry job, the legacy write-through mirror, and plans.module CRUD.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

/** A catalog plan scoped to a module, with known capabilities/limits. */
function mbPlan(string $module, array $capabilities, array $limits = [], int $priceMinor = 30000): string
{
    $id = (string) Str::uuid();
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::table('plans')->insert([
        'id' => $id,
        'code' => 'MB-'.substr($id, 0, 8),
        'name' => "MB {$module} plan",
        'price_minor' => $priceMinor,
        'currency' => 'EGP',
        'module' => $module,
        'features' => json_encode(['capabilities' => $capabilities, 'limits' => $limits]),
        'is_active' => true,
    ]);

    return $id;
}

/** Resolve entitlement in the academy's own context. */
function mbResolve(string $academyId): array
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);

    return Entitlement::resolve($academyId);
}

/** Set what a client pays for a module (prices live on the client's own row now). */
function mbPrice(string $academyId, string $module, int $priceMinor): void
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);
    app(ModuleBilling::class)->setPricing($academyId, $module, priceMinor: $priceMinor);
}

/** The live module sub row (read in the academy's context). */
function mbSub(string $academyId, string $module): ?object
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);

    return DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', $module)->where('status', '<>', 'ENDED')
        ->first();
}

it('enables VIDEO with a trial through the client endpoint: sub + entitlement + mirror', function () {
    $academyId = $this->createAcademy();
    mbPrice($academyId, 'MANAGEMENT', 30000);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription", [
        'mode' => 'trial', 'trial_days' => 7, 'price_minor' => 20000,
    ])->assertCreated()->assertJsonPath('subscription.is_trial', true);

    $sub = mbSub($academyId, 'VIDEO');
    expect($sub)->not->toBeNull();
    expect((bool) $sub->is_trial)->toBeTrue();
    expect((int) $sub->base_price_minor)->toBe(20000);
    expect(Carbon::parse($sub->trial_end)->diffInDays(now()->addDays(7)))->toBeLessThan(1);

    // Entitlement: the module grants the classroom, the management side is untouched, and the
    // client's own cap (set from its profile) is the only limit in play.
    $this->putJson("/api/admin/clients/{$academyId}/modules/video/features", [
        'limits' => ['maxRooms' => 5],
    ])->assertOk();

    $resolved = mbResolve($academyId);
    expect($resolved['capabilities'])->toContain('video.conferencing')->toContain('invoicing');
    expect($resolved['limits']['maxRooms'] ?? null)->toBe(5);
    expect($resolved['modules'])->toContain('VIDEO')->toContain('MANAGEMENT');

    // Legacy mirror: one consolidated total (30000 + 20000) for the client.
    $this->enterAcademyAsSuperAdmin($academyId);
    $legacy = DB::table('academy_subscriptions')->where('academy_id', $academyId)->where('status', '<>', 'ENDED')->first();
    expect((int) $legacy->total_cost_minor)->toBe(50000);

    // Audit trail for the enable (audit_log is tenant-scoped — read in the academy's context).
    $this->enterAcademyAsSuperAdmin($academyId);
    expect(DB::table('audit_log')->where('action', 'module_subscription.enabled')->exists())->toBeTrue();
});

it('defaults the trial length to config(billing.trial_days) when no days are sent', function () {
    $academyId = $this->createAcademy();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription", [
        'mode' => 'trial',
    ])->assertCreated();

    $sub = mbSub($academyId, 'VIDEO');
    $days = (int) config('billing.trial_days');
    expect(Carbon::parse($sub->trial_end)->between(
        now()->addDays($days)->subDay(),
        now()->addDays($days)->addDay(),
    ))->toBeTrue();
});

it('rejects a module the client type cannot hold (422)', function () {
    $academyId = $this->createAcademy(); // a MANAGEMENT client — never the course platform

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/lms/subscription", [
        'mode' => 'trial',
    ])->assertUnprocessable();
});

it('pausing one module removes only its capabilities — scoped suspension (AC-M2.3)', function () {
    $mgmtPlan = mbPlan('MANAGEMENT', ['invoicing']);
    $videoPlan = mbPlan('VIDEO', ['video.conferencing']);
    $academyId = $this->createAcademy(overrides: ['plan_id' => $mgmtPlan, 'status' => 'ACTIVE']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription", [
        'plan_id' => $videoPlan, 'mode' => 'active',
    ])->assertCreated();
    expect(mbResolve($academyId)['capabilities'])->toContain('video.conferencing');

    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription/pause")->assertOk()
        ->assertJsonPath('subscription.status', 'PAUSED');

    $resolved = mbResolve($academyId);
    expect($resolved['capabilities'])->not->toContain('video.conferencing');
    expect($resolved['capabilities'])->toContain('invoicing'); // management untouched
    expect($resolved['modules'])->not->toContain('VIDEO');

    // The client stays fully usable — another module is still active.
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('ACTIVE');
});

it('an expired module trial stops granting immediately, before the nightly job runs', function () {
    $mgmtPlan = mbPlan('MANAGEMENT', ['invoicing']);
    $videoPlan = mbPlan('VIDEO', ['video.conferencing']);
    $academyId = $this->createAcademy(overrides: ['plan_id' => $mgmtPlan, 'status' => 'ACTIVE']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription", [
        'plan_id' => $videoPlan, 'mode' => 'trial', 'trial_days' => 5,
    ])->assertCreated();

    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->where('academy_id', $academyId)->where('module', 'VIDEO')
        ->update(['trial_end' => now()->subHour()]);

    $resolved = mbResolve($academyId);
    expect($resolved['capabilities'])->not->toContain('video.conferencing');
    expect($resolved['capabilities'])->toContain('invoicing');
});

it('the expiry job pauses only the lapsed module; the client is suspended only when nothing stays active', function () {
    $mgmtPlan = mbPlan('MANAGEMENT', ['invoicing']);
    $videoPlan = mbPlan('VIDEO', ['video.conferencing']);
    $academyId = $this->createAcademy(overrides: ['plan_id' => $mgmtPlan, 'status' => 'ACTIVE']);

    Sanctum::actingAs($this->admin);
    // MANAGEMENT active (paid), VIDEO on a trial that has lapsed.
    $this->postJson("/api/admin/clients/{$academyId}/modules/management/subscription", [
        'plan_id' => $mgmtPlan, 'mode' => 'active',
    ])->assertCreated();
    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription", [
        'plan_id' => $videoPlan, 'mode' => 'trial', 'trial_days' => 5,
    ])->assertCreated();

    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->where('academy_id', $academyId)->where('module', 'VIDEO')
        ->update(['trial_end' => now()->subDay()]);

    $out = (new ExpireAcademyTrialsJob($academyId))->handle(app(AcademyBilling::class), app(ModuleBilling::class));
    expect($out[$academyId]['expired'])->toBeTrue();
    expect($out[$academyId]['modules'])->toBe(['VIDEO']);
    expect($out[$academyId]['suspended'])->toBeFalse(); // management still active

    expect(mbSub($academyId, 'VIDEO')->status)->toBe('PAUSED');
    expect(mbSub($academyId, 'MANAGEMENT')->status)->toBe('ACTIVE');
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('ACTIVE');

    // Now lapse the management trial too → nothing active → the client suspends.
    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['is_trial' => true, 'trial_end' => now()->subDay()]);

    $out2 = (new ExpireAcademyTrialsJob($academyId))->handle(app(AcademyBilling::class), app(ModuleBilling::class));
    expect($out2[$academyId]['suspended'])->toBeTrue();
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('SUSPENDED');
});

it('extending a module trial restores a suspended client and reflects everywhere', function () {
    $mgmtPlan = mbPlan('MANAGEMENT', ['invoicing']);
    $academyId = $this->createAcademy(overrides: ['plan_id' => $mgmtPlan, 'status' => 'TRIAL']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/management/subscription", [
        'plan_id' => $mgmtPlan, 'mode' => 'trial', 'trial_days' => 5,
    ])->assertCreated();

    // Lapse + expire → suspended.
    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['trial_end' => now()->subDay()]);
    (new ExpireAcademyTrialsJob($academyId))->handle(app(AcademyBilling::class), app(ModuleBilling::class));
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('SUSPENDED');

    // One extend → module ACTIVE trial again, client TRIAL, suspension cleared, mirror agrees.
    $this->postJson("/api/admin/clients/{$academyId}/modules/management/subscription/trial", ['days' => 10])
        ->assertOk()->assertJsonPath('subscription.is_trial', true);

    $sub = mbSub($academyId, 'MANAGEMENT');
    expect($sub->status)->toBe('ACTIVE');
    expect(Carbon::parse($sub->trial_end)->isFuture())->toBeTrue();
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('TRIAL');
    $this->enterAcademyAsSuperAdmin($academyId);
    $legacy = DB::table('academy_subscriptions')->where('academy_id', $academyId)->where('status', '<>', 'ENDED')->first();
    expect((bool) $legacy->is_trial)->toBeTrue();
    expect(Carbon::parse($legacy->trial_end)->isFuture())->toBeTrue();
});

it('enables and ends WHATSAPP independently of the other modules', function () {
    $mgmtPlan = mbPlan('MANAGEMENT', ['invoicing']);
    $waPlan = mbPlan('WHATSAPP', ['whatsapp.automation'], [], 10000);
    $academyId = $this->createAcademy(overrides: ['plan_id' => $mgmtPlan, 'status' => 'ACTIVE']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/whatsapp/subscription", [
        'plan_id' => $waPlan, 'mode' => 'active',
    ])->assertCreated();
    expect(mbResolve($academyId)['capabilities'])->toContain('whatsapp.automation');

    $this->postJson("/api/admin/clients/{$academyId}/modules/whatsapp/subscription/end")->assertOk();
    $resolved = mbResolve($academyId);
    expect($resolved['capabilities'])->not->toContain('whatsapp.automation');
    expect($resolved['capabilities'])->toContain('invoicing');
    expect(mbSub($academyId, 'WHATSAPP'))->toBeNull();
});

it('lists every client with its module chips in the directory (SUPER_ADMIN only)', function () {
    $mgmtPlan = mbPlan('MANAGEMENT', ['invoicing']);
    $videoPlan = mbPlan('VIDEO', ['video.conferencing']);
    $academyId = $this->createAcademy(overrides: ['plan_id' => $mgmtPlan, 'status' => 'ACTIVE', 'name' => 'Directory Test Academy']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription", [
        'plan_id' => $videoPlan, 'mode' => 'trial', 'trial_days' => 7,
    ])->assertCreated();

    $res = $this->getJson('/api/admin/clients')->assertOk();
    $client = collect($res->json('clients'))->firstWhere('id', $academyId);
    expect($client)->not->toBeNull();
    $modules = collect($client['modules'])->keyBy('module');
    expect($modules->has('VIDEO'))->toBeTrue();
    expect($modules['VIDEO']['is_trial'])->toBeTrue();
    expect($modules->has('MANAGEMENT'))->toBeTrue();

    // Composite client read.
    $show = $this->getJson("/api/admin/clients/{$academyId}")->assertOk();
    expect(collect($show->json('modules'))->pluck('module'))->toContain('VIDEO');

    // An academy owner is forbidden.
    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);
    $this->getJson('/api/admin/clients')->assertForbidden();
});

it('stamps a consolidated bill with its per-module breakdown (M-BILL-1)', function () {
    $academyId = $this->createAcademy();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/management/subscription", [
        'mode' => 'active', 'price_minor' => 30000,
    ])->assertCreated();
    $this->postJson("/api/admin/clients/{$academyId}/modules/video/subscription", [
        'mode' => 'active', 'price_minor' => 20000,
    ])->assertCreated();

    $res = $this->postJson("/api/admin/academies/{$academyId}/bills/generate")->assertOk();
    $billId = $res->json('billId');

    $this->enterAcademyAsSuperAdmin($academyId);
    $bill = DB::table('academy_invoices')->where('id', $billId)->first();
    expect((int) $bill->total_minor)->toBe(50000); // one consolidated total…

    $breakdown = collect(json_decode((string) $bill->module_breakdown, true))->keyBy('module');
    expect($breakdown->has('MANAGEMENT'))->toBeTrue(); // …with a line per module
    expect($breakdown->has('VIDEO'))->toBeTrue();
    expect((int) $breakdown['MANAGEMENT']['total_minor'])->toBe(30000);
    expect((int) $breakdown['VIDEO']['total_minor'])->toBe(20000);
});

it('provisions a WhatsApp-only external client: no login, WHATSAPP sub, sends gated by lifecycle (M-CLI-2)', function () {
    $waPlan = mbPlan('WHATSAPP', ['whatsapp.automation'], [], 25000);
    // The type catalog must exist (external clients borrow a type); DemoAcademySeeder seeds one.

    Sanctum::actingAs($this->admin);
    $res = $this->postJson('/api/admin/clients', [
        'name' => 'Sunrise Nursery (external)',
        'plan_id' => $waPlan,
        'mode' => 'trial',
        'trial_days' => 5,
    ])->assertCreated();
    $clientId = $res->json('clientId');

    // No owner login exists — nobody can ever sign in for this client.
    $this->enterAcademyAsSuperAdmin($clientId);
    expect(DB::table('users')->where('academy_id', $clientId)->count())->toBe(0);

    // The WHATSAPP sub grants the capability while the trial runs…
    $sub = mbSub($clientId, 'WHATSAPP');
    expect((bool) $sub->is_trial)->toBeTrue();
    expect(mbResolve($clientId)['capabilities'])->toContain('whatsapp.automation');
    expect(mbResolve($clientId)['modules'])->toBe(['WHATSAPP']);

    // …and appears in the directory with no owner email.
    $dir = $this->getJson('/api/admin/clients')->assertOk();
    $row = collect($dir->json('clients'))->firstWhere('id', $clientId);
    expect($row['owner_email'])->toBeNull();
    expect(collect($row['modules'])->pluck('module'))->toContain('WHATSAPP');

    // Pausing the sub cuts the capability (external sends 402) and suspends the client — it has
    // no other module to stay alive for.
    $this->postJson("/api/admin/clients/{$clientId}/modules/whatsapp/subscription/pause")->assertOk();
    expect(mbResolve($clientId)['capabilities'])->not->toContain('whatsapp.automation');
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $clientId)->value('status'))->toBe('SUSPENDED');
});

it('rolls the billing period on the PRIMARY module sub and mirrors it (R5a — no legacy writer left)', function () {
    $mgmtPlan = mbPlan('MANAGEMENT', ['invoicing'], [], 30000);
    $academyId = $this->createAcademy(overrides: ['plan_id' => $mgmtPlan, 'status' => 'ACTIVE']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$academyId}/modules/management/subscription", [
        'plan_id' => $mgmtPlan, 'mode' => 'active',
    ])->assertCreated();

    // Lapse the current period, then roll: the elapsed period is billed and the window advances
    // ON THE MODULE SUB, with the legacy row following as its mirror.
    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->where('academy_id', $academyId)->where('module', 'MANAGEMENT')->update([
        'current_period_start' => now()->subMonth()->subDay(),
        'current_period_end' => now()->subDay(),
    ]);
    Tenancy::withContext(new AuthContext(
        userId: (string) $this->admin->id, academyId: $academyId, role: 'SUPER_ADMIN', permissions: [],
    ), function () use ($academyId) {
        $billId = app(AcademyBilling::class)->rollAndBill($academyId);
        expect($billId)->not->toBeNull();
    });

    $sub = mbSub($academyId, 'MANAGEMENT');
    expect(Carbon::parse($sub->current_period_end)->isFuture())->toBeTrue();

    $this->enterAcademyAsSuperAdmin($academyId);
    $legacy = DB::table('academy_subscriptions')->where('academy_id', $academyId)->where('status', '<>', 'ENDED')->first();
    expect((string) $legacy->current_period_end)->toBe((string) $sub->current_period_end);
    expect(DB::table('academy_invoices')->where('academy_id', $academyId)->count())->toBe(1);
});

it('plan CRUD carries the module (create + edit)', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->postJson('/api/admin/plans', [
        'code' => 'VIDEO-TIER-X', 'name' => 'Video Tier X', 'price_minor' => 15000,
        'currency' => 'EGP', 'module' => 'VIDEO',
        'features' => ['capabilities' => ['video.conferencing'], 'limits' => ['maxRooms' => 3]],
    ])->assertCreated();
    $planId = $res->json('planId');

    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    expect(DB::table('plans')->where('id', $planId)->value('module'))->toBe('VIDEO');

    $this->patchJson("/api/admin/plans/{$planId}", ['module' => 'WHATSAPP'])->assertOk();
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    expect(DB::table('plans')->where('id', $planId)->value('module'))->toBe('WHATSAPP');
});
