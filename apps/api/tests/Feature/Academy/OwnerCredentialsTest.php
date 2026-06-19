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
    $this->quranType = DB::table('academy_types')->where('code', 'QURAN')->value('id');

    Sanctum::actingAs($this->admin);
    $this->academyId = $this->postJson('/api/admin/academies', [
        'name' => 'Owner Co', 'academy_type_id' => $this->quranType,
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'email' => 'owner@oc.test', 'password' => 'firstpass123',
    ])->assertCreated()->json('academyId');
});

it('reads back the current owner email', function () {
    $this->getJson("/api/admin/academies/{$this->academyId}/owner")
        ->assertOk()
        ->assertJsonPath('owner.email', 'owner@oc.test');
});

it('changes the owner email and the owner can log in with it', function () {
    $this->patchJson("/api/admin/academies/{$this->academyId}/owner", ['email' => 'new@oc.test'])
        ->assertOk()
        ->assertJsonPath('changed', ['email']);

    $this->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => 'new@oc.test', 'password' => 'firstpass123'])
        ->assertOk()
        ->assertJsonPath('role', 'ACADEMY_OWNER')
        ->assertJsonPath('academyId', $this->academyId);
});

it('resets the owner password and the owner can log in with it', function () {
    $this->patchJson("/api/admin/academies/{$this->academyId}/owner", ['password' => 'brandnew123'])
        ->assertOk()
        ->assertJsonPath('changed', ['password']);

    $this->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => 'owner@oc.test', 'password' => 'brandnew123'])
        ->assertOk()
        ->assertJsonPath('academyId', $this->academyId);
});

it('rejects an empty update with no email or password', function () {
    $this->patchJson("/api/admin/academies/{$this->academyId}/owner", [])
        ->assertStatus(422)
        ->assertJsonValidationErrors('email');
});

it('rejects a too-short password', function () {
    $this->patchJson("/api/admin/academies/{$this->academyId}/owner", ['password' => 'short'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('password');
});

it('rejects an email already used by another account', function () {
    $other = $this->createAcademy();
    $this->makeUser($other, 'ACADEMY_OWNER', ['email' => 'taken@dupe.test']);

    Sanctum::actingAs($this->admin);
    $this->patchJson("/api/admin/academies/{$this->academyId}/owner", ['email' => 'taken@dupe.test'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('email');
});

it('forbids a non-admin from managing owner credentials', function () {
    $owner = $this->makeUser($this->academyId, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);
    $this->patchJson("/api/admin/academies/{$this->academyId}/owner", ['password' => 'whatever123'])
        ->assertForbidden();
});
