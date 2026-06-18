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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-tr@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'currency' => 'EGP']);
});

it('an owner writes, lists and deletes a report about a teacher', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson("/api/teachers/{$this->teacher}/reports", [
        'kind' => 'INCIDENT',
        'body' => 'Arrived 30 minutes late without notice.',
    ])->assertCreated()->json('reportId');

    $list = $this->getJson("/api/teachers/{$this->teacher}/reports")->assertOk();
    expect($list->json('reports'))->toHaveCount(1)
        ->and($list->json('reports.0.kind'))->toBe('INCIDENT')
        ->and($list->json('reports.0.body'))->toBe('Arrived 30 minutes late without notice.')
        ->and($list->json('reports.0.author_name'))->not->toBeNull();

    $this->deleteJson("/api/teachers/{$this->teacher}/reports/{$id}")->assertOk();
    $this->asAcademy($this->academy);
    expect(DB::table('teacher_reports')->where('id', $id)->exists())->toBeFalse();
});

it('rejects an invalid kind and an empty body', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/teachers/{$this->teacher}/reports", ['kind' => 'BOGUS', 'body' => 'x'])->assertStatus(422);
    $this->postJson("/api/teachers/{$this->teacher}/reports", ['body' => ''])->assertStatus(422);
});

it('forbids a teacher from reading or writing reports about teachers', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-tr@test.local']);
    Sanctum::actingAs($teacherUser);

    $this->getJson("/api/teachers/{$this->teacher}/reports")->assertStatus(403);
    $this->postJson("/api/teachers/{$this->teacher}/reports", ['body' => 'sneaky'])->assertStatus(403);
});

it('isolates teacher reports per academy (RLS)', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/teachers/{$this->teacher}/reports", ['body' => 'Academy A note'])->assertCreated();

    $academyB = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $ownerB = $this->makeUser($academyB, 'ACADEMY_OWNER', ['email' => 'owner-b-tr@test.local']);
    Sanctum::actingAs($ownerB);

    // Academy B's owner cannot see (404 — the teacher row isn't visible under their RLS scope).
    $this->getJson("/api/teachers/{$this->teacher}/reports")->assertStatus(404);
});
