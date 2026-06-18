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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-delete@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Delete Teacher']);
});

/** A guardian + student with an active subscription and teacher, created via the API. */
function deletableStudent(): string
{
    $guardianId = test()->postJson('/api/guardians', ['full_name' => 'Fam', 'whatsapp_phone' => '+201000000400'])->json('guardianId');

    return test()->postJson('/api/students', [
        'full_name' => 'Removable',
        'guardian_id' => $guardianId,
        'teacher_id' => test()->teacher,
        'subscription' => [
            'plan_label' => '8/month', 'sessions_per_month' => 8,
            'price_minor' => 10000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION',
            'start_date' => '2026-06-01',
        ],
    ])->assertCreated()->json('studentId');
}

// ── Delete is a recoverable soft-delete: hidden, retained, actives ended ──────
it('soft-deletes a student, hides them, ends their active subscription and assignment, and keeps the row', function () {
    Sanctum::actingAs($this->owner);
    $studentId = deletableStudent();

    $res = $this->deleteJson("/api/students/{$studentId}")->assertOk();
    expect($res->json('recoverable'))->toBeTrue();
    expect($res->json('message'))->not->toBeNull();

    // Hidden from the default list…
    $default = $this->getJson('/api/students')->assertOk();
    expect(collect($default->json('rows'))->pluck('id'))->not->toContain($studentId);

    $this->asAcademy($this->academy);
    // …but the row and its history are retained (no hard delete).
    $student = DB::table('students')->where('id', $studentId)->first();
    expect($student)->not->toBeNull();
    expect($student->deleted_at)->not->toBeNull();

    // Nothing dangles: no ACTIVE subscription, no open teacher assignment.
    expect(DB::table('subscriptions')->where('student_id', $studentId)->where('status', 'ACTIVE')->count())->toBe(0);
    expect(DB::table('student_teacher_assignments')->where('student_id', $studentId)->whereNull('ended_at')->count())->toBe(0);

    // The action is audited as a deliberate delete.
    expect(DB::table('audit_log')->where('action', 'student.delete')->where('entity_id', $studentId)->exists())->toBeTrue();
});

// ── A deleted student can be brought back via reactivate ──────────────────────
it('restores a deleted student through reactivate', function () {
    Sanctum::actingAs($this->owner);
    $studentId = deletableStudent();
    $this->deleteJson("/api/students/{$studentId}")->assertOk();

    $this->postJson("/api/students/{$studentId}/reactivate")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $studentId)->value('deleted_at'))->toBeNull();

    // Visible again in the default list.
    Sanctum::actingAs($this->owner);
    $rows = $this->getJson('/api/students')->assertOk()->json('rows');
    expect(collect($rows)->pluck('id'))->toContain($studentId);
});

// ── Deleting an already-removed student is a 404 ─────────────────────────────
it('returns 404 when deleting a student that is already removed', function () {
    Sanctum::actingAs($this->owner);
    $studentId = deletableStudent();
    $this->deleteJson("/api/students/{$studentId}")->assertOk();

    $this->deleteJson("/api/students/{$studentId}")->assertStatus(404);
});

// ── A teacher cannot delete a student ────────────────────────────────────────
it('forbids a teacher from deleting a student', function () {
    Sanctum::actingAs($this->owner);
    $studentId = deletableStudent();

    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-delete@test.local']);
    Sanctum::actingAs($teacherUser);
    $this->deleteJson("/api/students/{$studentId}")->assertForbidden();
});
