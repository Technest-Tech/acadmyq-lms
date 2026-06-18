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
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-spec@test.local']);
});

it('an owner creates, lists, renames, deactivates and deletes a specialization', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/specializations', ['name' => 'Tajweed'])
        ->assertCreated()->json('specializationId');

    $list = $this->getJson('/api/specializations')->assertOk();
    expect($list->json('specializations'))->toHaveCount(1)
        ->and($list->json('specializations.0.name'))->toBe('Tajweed')
        ->and($list->json('specializations.0.is_active'))->toBeTrue();

    $this->patchJson("/api/specializations/{$id}", ['name' => 'Tajweed & Hifz', 'is_active' => false])->assertOk();

    $this->asAcademy($this->academy);
    $row = DB::table('specializations')->where('id', $id)->first();
    expect($row->name)->toBe('Tajweed & Hifz')->and((bool) $row->is_active)->toBeFalse();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/specializations/{$id}")->assertOk();
    $this->asAcademy($this->academy);
    expect(DB::table('specializations')->where('id', $id)->exists())->toBeFalse();
});

it('rejects a duplicate specialization name case-insensitively', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/specializations', ['name' => 'Quran'])->assertCreated();
    $this->postJson('/api/specializations', ['name' => 'quran'])->assertStatus(422);
});

it('forbids a teacher from managing specializations but lets them read the list', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-spec@test.local']);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/specializations', ['name' => 'Arabic'])->assertCreated();

    // A TEACHER lacks teacher.read (the roster), so even the dropdown list is gated from them.
    Sanctum::actingAs($teacherUser);
    $this->getJson('/api/specializations')->assertStatus(403);
    $this->postJson('/api/specializations', ['name' => 'Hacked'])->assertStatus(403);
});

it('isolates specializations per academy (RLS)', function () {
    $academyB = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $ownerB = $this->makeUser($academyB, 'ACADEMY_OWNER', ['email' => 'owner-b-spec@test.local']);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/specializations', ['name' => 'Academy A only'])->assertCreated();

    Sanctum::actingAs($ownerB);
    expect($this->getJson('/api/specializations')->assertOk()->json('specializations'))->toHaveCount(0);
});
