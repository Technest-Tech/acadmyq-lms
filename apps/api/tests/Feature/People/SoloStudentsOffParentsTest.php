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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-solo@test.local']);
    Sanctum::actingAs($this->owner);

    $this->solo = $this->postJson('/api/students', [
        'full_name' => 'Solo Adult', 'whatsapp_phone' => '+201000000001', 'is_self_guardian' => true,
    ])->assertCreated()->json('studentId');

    $parent = fn (string $name, string $phone) => $this->postJson('/api/guardians', ['full_name' => $name, 'whatsapp_phone' => $phone])
        ->assertCreated()->json('guardianId');
    $child = fn (string $name, string $guardian) => $this->postJson('/api/students', ['full_name' => $name, 'guardian_id' => $guardian])
        ->assertCreated()->json('studentId');

    // Typed in as a parent under the student's own name: still one person.
    $this->sameName = $parent('Same Name', '+201000000002');
    $child('Same Name', $this->sameName);

    $this->oneChild = $parent('Real Parent', '+201000000003');
    $child('Only Kid', $this->oneChild);

    $this->siblings = $parent('Two Kids', '+201000000004');
    $child('First', $this->siblings);
    $child('Second', $this->siblings);

    $this->empty = $parent('No Kids Yet', '+201000000005');

    $this->names = fn () => collect($this->getJson('/api/guardians?pageSize=50')->assertOk()->json('rows'))->pluck('full_name')->all();
    $this->switchOn = fn () => $this->putJson('/api/academy/settings', ['hide_solo_students_from_parents' => true])->assertOk();
});

it('lists every parent as before while the switch is off', function () {
    expect(($this->names)())->toContain('Solo Adult', 'Same Name', 'Real Parent', 'Two Kids', 'No Kids Yet');
});

it('keeps a student on their own off the parents page once the switch is on, and no one else', function () {
    ($this->switchOn)();

    $names = ($this->names)();
    expect($names)->not->toContain('Solo Adult')
        ->and($names)->not->toContain('Same Name')
        ->and($names)->toContain('Real Parent', 'Two Kids', 'No Kids Yet');
});

it('keeps the hidden row as the billing anchor, and shows it again when a sibling joins', function () {
    ($this->switchOn)();

    $this->asAcademy($this->academy);
    $guardian = (string) DB::table('students')->where('id', $this->solo)->value('guardian_id');
    Sanctum::actingAs($this->owner);
    expect($guardian)->not->toBe('');
    $this->getJson("/api/guardians/{$guardian}")->assertOk();

    $this->postJson('/api/students', ['full_name' => 'Sibling', 'guardian_id' => $guardian])->assertCreated();
    expect(($this->names)())->toContain('Solo Adult');
});

it('does not touch another academy', function () {
    ($this->switchOn)();

    $other = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    Sanctum::actingAs($this->makeUser($other, 'ACADEMY_OWNER', ['email' => 'other-solo@test.local']));
    $this->postJson('/api/students', ['full_name' => 'Other Solo', 'whatsapp_phone' => '+201000000006', 'is_self_guardian' => true])->assertCreated();

    expect(collect($this->getJson('/api/guardians')->assertOk()->json('rows'))->pluck('full_name')->all())->toContain('Other Solo');
});
