<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The second, optional phone on a parent and a student (contact only — messages still go to the
 * WhatsApp number), and a parent typed into the student form when there is none on file yet.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-phones@test.local']);
});

it('keeps an optional second phone on a parent and a student, normalised and searchable', function () {
    Sanctum::actingAs($this->owner);

    $guardianId = $this->postJson('/api/guardians', [
        'full_name' => 'Hassan Family',
        'whatsapp_phone' => '+201000000001',
        'secondary_phone' => '0020 100 000 0009',
    ])->assertCreated()->json('guardianId');

    $studentId = $this->postJson('/api/students', [
        'full_name' => 'Yusuf',
        'guardian_id' => $guardianId,
        'secondary_phone' => '+20 111 222 3333',
    ])->assertCreated()->json('studentId');

    expect($this->getJson("/api/guardians/{$guardianId}")->assertOk()->json('guardian.secondary_phone'))->toBe('+201000000009');
    expect($this->getJson("/api/students/{$studentId}")->assertOk()->json('student.secondary_phone'))->toBe('+201112223333');

    // Either number finds them.
    expect($this->getJson('/api/guardians?search=1000000009')->assertOk()->json('rows.0.id'))->toBe($guardianId);
    expect($this->getJson('/api/students?search=1112223333')->assertOk()->json('rows.0.id'))->toBe($studentId);

    // Editable, and clearable.
    $this->patchJson("/api/students/{$studentId}", ['secondary_phone' => '+201119998888'])->assertOk();
    $this->patchJson("/api/guardians/{$guardianId}", ['secondary_phone' => null])->assertOk();
    expect($this->getJson("/api/students/{$studentId}")->json('student.secondary_phone'))->toBe('+201119998888');
    expect($this->getJson("/api/guardians/{$guardianId}")->json('guardian.secondary_phone'))->toBeNull();

    // Held to the same E.164 rule as the first number.
    $this->patchJson("/api/students/{$studentId}", ['secondary_phone' => 'call me'])
        ->assertStatus(422)->assertJsonValidationErrors('secondary_phone');
});

it('creates a brand-new parent with the student in one save', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/students', [
        'full_name' => 'Maryam',
        'country' => 'EG',
        'new_guardian' => [
            'full_name' => 'Ali Family',
            'whatsapp_phone' => '+201000000002',
            'secondary_phone' => '+201000000003',
            'currency' => 'usd',
        ],
    ])->assertCreated();

    $this->asAcademy($this->academy);
    $guardian = DB::table('guardians')->where('id', $res->json('guardianId'))->first();
    expect($guardian->full_name)->toBe('Ali Family');
    expect($guardian->whatsapp_phone)->toBe('+201000000002');
    expect($guardian->secondary_phone)->toBe('+201000000003');
    expect($guardian->country)->toBe('EG');
    expect($guardian->currency)->toBe('USD');
    expect(DB::table('students')->where('id', $res->json('studentId'))->value('guardian_id'))->toBe($guardian->id);
    expect(DB::table('audit_log')->where('action', 'guardian.create')->where('entity_id', $guardian->id)->exists())->toBeTrue();
});

it('leaves neither the new parent nor the student behind when the save is refused', function () {
    Sanctum::actingAs($this->owner);

    $this->asAcademy($this->academy);
    $guardians = DB::table('guardians')->count();
    $students = DB::table('students')->count();
    $this->clearTenantContext();

    // An unknown teacher is refused AFTER the parent and the student were written.
    $this->postJson('/api/students', [
        'full_name' => 'Omar',
        'teacher_id' => (string) Str::uuid(),
        'new_guardian' => ['full_name' => 'Omar Family', 'whatsapp_phone' => '+201000000004'],
    ])->assertStatus(422)->assertJsonValidationErrors('teacher_id');

    $this->asAcademy($this->academy);
    expect(DB::table('guardians')->count())->toBe($guardians);
    expect(DB::table('students')->count())->toBe($students);
});

it('refuses a new parent without a WhatsApp number', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/students', [
        'full_name' => 'Omar',
        'new_guardian' => ['full_name' => 'Omar Family'],
    ])->assertStatus(422)->assertJsonValidationErrors('new_guardian.whatsapp_phone');
});
