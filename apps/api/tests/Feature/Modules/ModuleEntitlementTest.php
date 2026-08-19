<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\Entitlement;
use App\Support\FeatureCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// docs/superadmin-modules/05-MODULES-NOT-PACKAGES — modules grant everything they own; the ONLY
// thing that takes a feature away from a client is that client's own switch in its profile.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

/** Resolve entitlement in the client's own context. */
function meResolve(string $academyId): array
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);

    return Entitlement::resolve($academyId);
}

/** Run an engine call inside the client's context (as the controllers do). */
function meEngine(string $academyId, callable $fn): mixed
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);

    return $fn(app(ModuleBilling::class));
}

it('grants every feature the module owns — no package decides anything', function () {
    $academyId = $this->createAcademy();

    $resolved = meResolve($academyId);

    foreach (FeatureCatalog::capabilitiesOfModule('MANAGEMENT') as $capability) {
        expect($resolved['capabilities'])->toContain($capability);
    }
    // CRM is a management feature now, not something a client subscribes to separately.
    expect($resolved['capabilities'])->toContain('crm');
    // Nothing it never bought.
    expect($resolved['capabilities'])->not->toContain('video.conferencing')->not->toContain('lms');
    // Uncapped until we decide otherwise.
    expect($resolved['limits'])->toBe([]);
    expect($resolved['clientType'])->toBe('MANAGEMENT');
});

it('switching a feature off for one client removes exactly that feature', function () {
    $academyId = $this->createAcademy();

    meEngine($academyId, fn (ModuleBilling $e) => $e->setDisabledFeatures($academyId, 'MANAGEMENT', ['certificates', 'payroll']));

    $resolved = meResolve($academyId);
    expect($resolved['capabilities'])
        ->not->toContain('certificates')
        ->not->toContain('payroll')
        ->toContain('invoicing')
        ->toContain('staff');

    // …and switching them back on restores them.
    meEngine($academyId, fn (ModuleBilling $e) => $e->setDisabledFeatures($academyId, 'MANAGEMENT', []));
    expect(meResolve($academyId)['capabilities'])->toContain('certificates')->toContain('payroll');
});

it('rejects a feature key that does not belong to the module', function () {
    $academyId = $this->createAcademy();

    expect(fn () => meEngine($academyId, fn (ModuleBilling $e) => $e->setDisabledFeatures($academyId, 'MANAGEMENT', ['video.conferencing'])))
        ->toThrow(ValidationException::class);
});

it('caps are per client and optional: unlimited until one is set, and a pause never uncaps', function () {
    $academyId = $this->createAcademy();

    expect(meResolve($academyId)['limits'])->toBe([]);

    meEngine($academyId, fn (ModuleBilling $e) => $e->setLimitOverrides($academyId, 'MANAGEMENT', ['maxStudents' => 200]));
    expect(meResolve($academyId)['limits']['maxStudents'] ?? null)->toBe(200);

    meEngine($academyId, fn (ModuleBilling $e) => $e->pause($academyId, 'MANAGEMENT'));
    $paused = meResolve($academyId);
    expect($paused['capabilities'])->toBe([]);              // a paused module grants nothing…
    expect($paused['limits']['maxStudents'] ?? null)->toBe(200); // …but its cap stays put
});

it('a management client may add video and whatsapp, but never the course platform', function () {
    $academyId = $this->createAcademy();

    meEngine($academyId, fn (ModuleBilling $e) => $e->enable($academyId, 'VIDEO', trial: false, priceMinor: 20000));
    meEngine($academyId, fn (ModuleBilling $e) => $e->enable($academyId, 'WHATSAPP', trial: false, priceMinor: 15000));

    $resolved = meResolve($academyId);
    expect($resolved['capabilities'])->toContain('video.conferencing')->toContain('whatsapp.automation');
    expect($resolved['capabilities'])->not->toContain('video.only'); // a school keeps its full panel
    expect($resolved['modules'])->toContain('VIDEO')->toContain('WHATSAPP')->toContain('MANAGEMENT');

    expect(fn () => meEngine($academyId, fn (ModuleBilling $e) => $e->enable($academyId, 'LMS', trial: false)))
        ->toThrow(ValidationException::class);
});

it('a single-module client gets that product only, and its workspace marker comes from its type', function () {
    $videoId = $this->createAcademy(overrides: ['client_type' => 'VIDEO']);
    $lmsId = $this->createAcademy(overrides: ['client_type' => 'LMS']);
    $waId = $this->createAcademy(overrides: ['client_type' => 'WHATSAPP']);

    expect(meResolve($videoId)['capabilities'])->toContain('video.conferencing')->toContain('video.only')->not->toContain('invoicing');
    expect(meResolve($lmsId)['capabilities'])->toContain('lms')->toContain('lms.only')->not->toContain('invoicing');
    expect(meResolve($waId)['capabilities'])->toBe(['whatsapp.automation']);

    // …and none of them can be sold the management system.
    expect(fn () => meEngine($videoId, fn (ModuleBilling $e) => $e->enable($videoId, 'MANAGEMENT', trial: false)))
        ->toThrow(ValidationException::class);
});

it('pausing video cuts the classroom and leaves the school running (scoped suspension)', function () {
    $academyId = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);

    expect(meResolve($academyId)['capabilities'])->toContain('video.conferencing');

    meEngine($academyId, fn (ModuleBilling $e) => $e->pause($academyId, 'VIDEO'));

    $resolved = meResolve($academyId);
    expect($resolved['capabilities'])->not->toContain('video.conferencing')->toContain('invoicing');
});

it('drives the per-client switches and the price through the admin API', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    // The profile shows what this client is and what each of its modules could switch.
    $show = $this->getJson("/api/admin/clients/{$academyId}")->assertOk();
    $show->assertJsonPath('client.client_type', 'MANAGEMENT');
    $show->assertJsonPath('catalog.allowedModules', ['MANAGEMENT', 'VIDEO', 'WHATSAPP']);
    expect($show->json('catalog.modules.MANAGEMENT.capabilities'))->toHaveKey('certificates');

    // Switch two features off + cap the client, in one call.
    $this->putJson("/api/admin/clients/{$academyId}/modules/management/features", [
        'disabled' => ['certificates', 'trials'],
        'limits' => ['maxStudents' => 120],
    ])->assertOk();

    $resolved = meResolve($academyId);
    expect($resolved['capabilities'])->not->toContain('certificates')->not->toContain('trials')->toContain('invoicing');
    expect($resolved['limits']['maxStudents'] ?? null)->toBe(120);

    // A key from another module is rejected by validation, not silently ignored.
    $this->putJson("/api/admin/clients/{$academyId}/modules/management/features", [
        'disabled' => ['lms'],
    ])->assertUnprocessable();

    // Price is the client's own number.
    $this->putJson("/api/admin/clients/{$academyId}/modules/management/subscription", [
        'price_minor' => 250000, 'currency' => 'EGP', 'billing_interval' => 'YEARLY',
    ])->assertOk()->assertJsonPath('subscription.base_price_minor', 250000);
});

it('creates a client of each type through the wizard, with its modules provisioned', function () {
    Sanctum::actingAs($this->admin);
    $typeId = $this->createAcademyType();

    $res = $this->postJson('/api/admin/academies', [
        'name' => 'Modules School',
        'academy_type_id' => $typeId,
        'client_type' => 'MANAGEMENT',
        'modules' => [['module' => 'VIDEO', 'price_minor' => 20000]],
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'email' => 'owner+modules@example.test',
        'password' => 'secret-password',
    ])->assertCreated();

    $academyId = $res->json('academyId');
    $resolved = meResolve($academyId);
    expect($resolved['clientType'])->toBe('MANAGEMENT');
    expect($resolved['capabilities'])->toContain('invoicing')->toContain('video.conferencing');
    expect($resolved['modules'])->toContain('MANAGEMENT')->toContain('VIDEO');

    // The extra module carries the price it was sold at.
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academyId]);
    $video = DB::table('module_subscriptions')->where('academy_id', $academyId)->where('module', 'VIDEO')->first();
    expect((int) $video->base_price_minor)->toBe(20000);
});
