<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
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
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-assign@test.local']);
    $this->teacher1 = $this->createTeacher($this->academy, ['full_name' => 'Teacher One']);
    $this->teacher2 = $this->createTeacher($this->academy, ['full_name' => 'Teacher Two']);
    $this->guardian = $this->createGuardian($this->academy);
    $this->student = $this->createStudent($this->academy, $this->guardian);
});

// ── TC-4.11 / AC-4.3: assigning a teacher yields exactly one active assignment ─
it('creates exactly one active assignment when a teacher is assigned', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->teacher1])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('student_teacher_assignments')->where('student_id', $this->student)->whereNull('ended_at')->count())->toBe(1);
});

// ── TC-4.12 / AC-4.3: reassignment closes the old and opens a new one ────────
it('closes the old assignment and opens a new one on reassignment', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->teacher1])->assertOk();
    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->teacher2, 'effective_date' => '2026-06-10'])->assertOk();

    $this->asAcademy($this->academy);
    $rows = DB::table('student_teacher_assignments')->where('student_id', $this->student)->get();
    expect($rows)->toHaveCount(2);
    expect($rows->whereNull('ended_at'))->toHaveCount(1);
    expect($rows->firstWhere('teacher_id', $this->teacher1)->ended_at)->not->toBeNull();
    expect($rows->firstWhere('teacher_id', $this->teacher2)->ended_at)->toBeNull();
});

// ── TC-4.13 / AC-4.3: the partial unique index rejects a second active row ───
it('rejects a second active assignment at the database level', function () {
    $this->asAcademy($this->academy);
    DB::table('student_teacher_assignments')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy,
        'student_id' => $this->student, 'teacher_id' => $this->teacher1, 'ended_at' => null,
    ]);

    expect(fn () => DB::table('student_teacher_assignments')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy,
        'student_id' => $this->student, 'teacher_id' => $this->teacher2, 'ended_at' => null,
    ]))->toThrow(QueryException::class);
});

// ── TC-4.14 / AC-4.3: teacher-history returns both assignments with date ranges ─
it('returns the full teacher history with correct date ranges', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->teacher1])->assertOk();
    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->teacher2])->assertOk();

    $history = $this->getJson("/api/students/{$this->student}/teacher-history")->assertOk()->json('history');
    expect($history)->toHaveCount(2);
    $current = collect($history)->firstWhere('ended_at', null);
    $past = collect($history)->first(fn ($h) => $h['ended_at'] !== null);
    expect($current['teacher_id'])->toBe($this->teacher2);
    expect($past['teacher_id'])->toBe($this->teacher1);
    expect($past['ended_at'])->not->toBeNull();
});

// ── TC-4.15 / AC-4.4: reassignment writes student.teacher_reassigned (from→to) ─
it('audits a reassignment with from, to and effective date', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->teacher1])->assertOk();
    $this->postJson("/api/students/{$this->student}/teacher", ['teacher_id' => $this->teacher2, 'effective_date' => '2026-06-10'])->assertOk();

    $this->asAcademy($this->academy);
    $audit = DB::table('audit_log')
        ->where('action', 'student.teacher_reassigned')
        ->where('entity_id', $this->student)
        ->whereRaw("after->>'teacher_id' = ?", [$this->teacher2])
        ->first();
    expect($audit)->not->toBeNull();
    expect(json_decode($audit->before, true)['teacher_id'])->toBe($this->teacher1);
    expect(json_decode($audit->after, true)['teacher_id'])->toBe($this->teacher2);
    expect(json_decode($audit->after, true)['effective_date'])->toContain('2026-06-10');
});
