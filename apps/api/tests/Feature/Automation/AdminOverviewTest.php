<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

it('automation overview reports toggles + has_token without leaking the token', function () {
    $academyId = $this->createAcademy();
    $this->asAcademy($academyId);
    DB::table('academy_automation_settings')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId,
        'wasender_token' => Crypt::encryptString('secret-token-xyz'),
        'type1_billing_enabled' => true,
        'created_at' => now(), 'updated_at' => now(),
    ]);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/automation')->assertOk();

    $row = collect($res->json('academies'))->firstWhere('academy_id', $academyId);
    expect($row['has_token'])->toBeTrue();
    expect($row['type1_billing_enabled'])->toBeTrue();
    expect(json_encode($res->json()))->not->toContain('secret-token-xyz');
});

it('forbids a non-admin from the automation overview', function () {
    $academyId = $this->createAcademy();
    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->getJson('/api/admin/automation')->assertForbidden();
});
