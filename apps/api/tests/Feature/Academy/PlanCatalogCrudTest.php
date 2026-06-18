<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->A = $this->createAcademy();
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER');
});

// ── Phase 3: the capability catalog feeds the plan/add-on forms ───────────────
it('returns the gated-feature catalog for a Super Admin', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->getJson('/api/admin/capabilities')->assertOk();
    $res->assertJsonStructure(['capabilities', 'limits']);

    expect($res->json('capabilities'))->toHaveKey('audit.full')
        ->and($res->json('limits'))->toHaveKey('maxStudents');
});

it('forbids an Owner from the capability catalog', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/admin/capabilities')->assertForbidden();
});

// ── Plan create persists the features JSON (capabilities ∪ limits) ────────────
it('creates a plan with capabilities and limits and reads them back', function () {
    Sanctum::actingAs($this->admin);

    $planId = $this->postJson('/api/admin/plans', [
        'code' => 'ELITE',
        'name' => 'Elite',
        'price_minor' => 9900,
        'currency' => 'usd',
        'features' => [
            'capabilities' => ['audit.full', 'report_field.custom'],
            'limits' => ['maxStudents' => 500, 'maxTeachers' => null],
        ],
    ])->assertCreated()->json('planId');

    Sanctum::actingAs($this->admin);
    $row = $this->getJson('/api/admin/plans')->assertOk()->json('plans');
    $elite = collect($row)->firstWhere('id', $planId);

    expect($elite['currency'])->toBe('USD');
    $features = json_decode($elite['features'], true);
    expect($features['capabilities'])->toContain('audit.full')
        ->and($features['limits']['maxStudents'])->toBe(500);
});

// ── Duplicate plan code is rejected (422) ─────────────────────────────────────
it('rejects a duplicate plan code', function () {
    Sanctum::actingAs($this->admin);

    $this->postJson('/api/admin/plans', [
        'code' => 'BASIC', 'name' => 'Dup', 'price_minor' => 0, 'currency' => 'USD',
    ])->assertStatus(422);
});

// ── Editing a plan's price + capabilities persists ────────────────────────────
it('updates a plan price and capabilities', function () {
    Sanctum::actingAs($this->admin);
    $basic = DB::table('plans')->where('code', 'BASIC')->value('id');

    $this->patchJson("/api/admin/plans/{$basic}", [
        'price_minor' => 1500,
        'features' => ['capabilities' => ['report_field.custom'], 'limits' => ['maxStudents' => 50]],
    ])->assertOk();

    $row = DB::table('plans')->where('id', $basic)->first();
    expect($row->price_minor)->toBe(1500);
    expect(json_decode($row->features, true)['capabilities'])->toBe(['report_field.custom']);
});

// ── Add-on create + edit round-trip ───────────────────────────────────────────
it('creates and updates an add-on bound to a feature key', function () {
    Sanctum::actingAs($this->admin);

    $addOnId = $this->postJson('/api/admin/add-ons', [
        'code' => 'AUDIT_PACK',
        'name' => 'Audit Pack',
        'price_minor' => 1900,
        'currency' => 'USD',
        'feature_key' => 'audit.full',
    ])->assertCreated()->json('addOnId');

    Sanctum::actingAs($this->admin);
    $this->patchJson("/api/admin/add-ons/{$addOnId}", ['price_minor' => 2500])->assertOk();

    expect(DB::table('add_ons')->where('id', $addOnId)->value('price_minor'))->toBe(2500);
});
