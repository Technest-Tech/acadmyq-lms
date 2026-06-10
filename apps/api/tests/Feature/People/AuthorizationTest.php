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

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->A = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->B = $this->createAcademy(overrides: ['default_currency' => 'EGP']);

    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER', ['email' => 'owner-a@test.local']);
    $this->ownerB = $this->makeUser($this->B, 'ACADEMY_OWNER', ['email' => 'owner-b@test.local']);

    // A teacher in academy A with a login + one assigned student.
    $this->teacherUser = $this->makeUser($this->A, 'TEACHER', ['email' => 'teacher-a@test.local']);
    $this->teacherA = $this->createTeacher($this->A, ['user_id' => $this->teacherUser->id, 'full_name' => 'Teacher A']);
    $this->otherTeacher = $this->createTeacher($this->A, ['full_name' => 'Other Teacher']);
    $this->guardianA = $this->createGuardian($this->A);
    $this->myStudent = $this->createStudent($this->A, $this->guardianA, ['full_name' => 'My Student']);
    $this->notMyStudent = $this->createStudent($this->A, $this->guardianA, ['full_name' => 'Not Mine']);

    $this->asAcademy($this->A);
    DB::table('student_teacher_assignments')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A,
        'student_id' => $this->myStudent, 'teacher_id' => $this->teacherA, 'ended_at' => null,
    ]);
    DB::table('student_teacher_assignments')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A,
        'student_id' => $this->notMyStudent, 'teacher_id' => $this->otherTeacher, 'ended_at' => null,
    ]);
});

// ── TC-4.26 / AC-4.11: Owner of A cannot read or edit B's people (RLS) ───────
it('isolates academies: owner of A cannot read or edit B\'s people', function () {
    $guardianB = $this->createGuardian($this->B, ['full_name' => 'B Guardian']);

    Sanctum::actingAs($this->ownerA);

    // B's guardian is invisible (404, not 403 — it does not exist in A's scope).
    $this->getJson("/api/guardians/{$guardianB}")->assertStatus(404);
    $this->patchJson("/api/guardians/{$guardianB}", ['full_name' => 'Hacked'])->assertStatus(404);

    // A's list never contains B's guardian.
    $rows = $this->getJson('/api/guardians')->assertOk()->json('rows');
    expect(collect($rows)->pluck('id'))->not->toContain($guardianB);

    // The row is untouched, seen from B.
    $this->asAcademy($this->B);
    expect(DB::table('guardians')->where('id', $guardianB)->value('full_name'))->toBe('B Guardian');
});

// ── TC-4.27 / AC-4.10: Teacher sees only assigned students; no guardian list ─
it('limits a teacher to their assigned students and denies the guardian list', function () {
    Sanctum::actingAs($this->teacherUser);

    // Students list is row-scoped to the teacher's assigned students only.
    $rows = $this->getJson('/api/students')->assertOk()->json('rows');
    expect(collect($rows)->pluck('id')->all())->toBe([$this->myStudent]);

    // Reading a student they do not teach → 403.
    $this->getJson("/api/students/{$this->notMyStudent}")->assertForbidden();

    // The full guardian list requires guardian.read, which a TEACHER lacks → 403.
    $this->getJson('/api/guardians')->assertForbidden();

    // Editing another teacher's record → 403 (TEACHER lacks teacher.update).
    $this->patchJson("/api/teachers/{$this->otherTeacher}", ['full_name' => 'X'])->assertForbidden();
});

// ── TC-4.28 / AC-4.10: a teacher can read their own teacher record and rate ──
it('lets a teacher read their own teacher record but not another\'s', function () {
    Sanctum::actingAs($this->teacherUser);

    $own = $this->getJson("/api/teachers/{$this->teacherA}")->assertOk();
    expect($own->json('teacher.id'))->toBe($this->teacherA);
    expect($own->json('teacher.session_rate_minor'))->not->toBeNull();

    // Another teacher's record is forbidden even though it is in the same academy.
    $this->getJson("/api/teachers/{$this->otherTeacher}")->assertForbidden();
});

// ── AC-4.10: a teacher cannot create people (no create capability) ───────────
it('forbids a teacher from creating guardians, students or teachers', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->postJson('/api/guardians', ['full_name' => 'X', 'whatsapp_phone' => '+201000000099'])->assertForbidden();
    $this->postJson('/api/students', ['full_name' => 'X', 'guardian_id' => $this->guardianA])->assertForbidden();
    $this->postJson('/api/teachers', ['full_name' => 'X', 'session_rate_minor' => 1000])->assertForbidden();
});
