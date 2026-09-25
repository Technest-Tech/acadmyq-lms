<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\FeatureCatalog;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Every screen an academy sees has a per-client switch (2026-09-26): the five features that used to
 * be ungated (supervision, financial statistics, the report card) or ride on another feature's gate
 * (packages on invoicing, teacher quality on payroll) now answer 402-upgrade when a Super Admin
 * switches them off for one client, and keep working for everyone else.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->full = $this->createAcademy();
    $this->fullOwner = $this->makeUser($this->full, 'ACADEMY_OWNER');

    $this->trimmed = $this->createAcademy();
    $this->trimmedOwner = $this->makeUser($this->trimmed, 'ACADEMY_OWNER');
});

/** Switch features off for one client, exactly as the client profile does. */
function fsSwitchOff(string $academyId, array $disabled): void
{
    test()->asAcademy($academyId, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', $disabled);
    test()->clearTenantContext();
}

it('lists the five new switches under the management module', function () {
    foreach (['supervision', 'packages', 'teacher_quality', 'financial_statistics', 'report_card'] as $key) {
        expect(FeatureCatalog::CAPABILITIES)->toHaveKey($key);
        expect(FeatureCatalog::moduleOfCapability($key))->toBe('MANAGEMENT');
    }
});

/**
 * One GET per switch — the route an owner would open first. Switched off ⇒ 402 (never 403); on ⇒
 * anything but 402 (the demo data may make it a 200 or an empty 200, which is not this test's job).
 */
$probes = [
    'supervision' => '/api/supervision/stats',
    'packages' => '/api/packages',
    'teacher_quality' => '/api/quality/rubric',
    'financial_statistics' => '/api/reports/exchange-rates',
    'report_card' => '/api/report-card-template',
];

foreach ($probes as $key => $route) {
    it("answers 402 on {$route} only for the client that had {$key} switched off", function () use ($key, $route) {
        fsSwitchOff($this->trimmed, [$key]);

        Sanctum::actingAs($this->fullOwner);
        expect($this->getJson($route)->status())->not->toBe(402);

        Sanctum::actingAs($this->trimmedOwner);
        $this->getJson($route)->assertStatus(402);
    });
}

it('keeps packages inside the invoicing gate: no invoicing means no packages either', function () {
    fsSwitchOff($this->trimmed, ['invoicing']);

    Sanctum::actingAs($this->trimmedOwner);
    $this->getJson('/api/packages')->assertStatus(402);
});

it('keeps teacher quality inside the payroll gate', function () {
    fsSwitchOff($this->trimmed, ['payroll']);

    Sanctum::actingAs($this->trimmedOwner);
    $this->getJson('/api/quality/rubric')->assertStatus(402);
});
