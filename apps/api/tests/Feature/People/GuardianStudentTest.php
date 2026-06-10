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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-people@test.local']);
    $this->teacher1 = $this->createTeacher($this->academy, ['full_name' => 'Teacher One']);
    $this->teacher2 = $this->createTeacher($this->academy, ['full_name' => 'Teacher Two']);
});

// ── TC-4.1 / AC-4.1: guardian + 2 students, each its own price & teacher ─────
it('creates a guardian with two students, each independently priced and taught', function () {
    Sanctum::actingAs($this->owner);

    $guardianId = $this->postJson('/api/guardians', [
        'full_name' => 'Mohamed Family',
        'whatsapp_phone' => '+201000000001',
        'country' => 'EG',
    ])->assertCreated()->json('guardianId');

    $childA = $this->postJson('/api/students', [
        'full_name' => 'Yusuf',
        'guardian_id' => $guardianId,
        'teacher_id' => $this->teacher1,
        'subscription' => [
            'plan_label' => '8/month', 'sessions_per_month' => 8,
            'price_minor' => 10000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION',
            'start_date' => '2026-06-01',
        ],
    ])->assertCreated()->json('studentId');

    $childB = $this->postJson('/api/students', [
        'full_name' => 'Maryam',
        'guardian_id' => $guardianId,
        'teacher_id' => $this->teacher2,
        'subscription' => [
            'plan_label' => '12/month', 'sessions_per_month' => 12,
            'price_minor' => 9000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION',
            'start_date' => '2026-06-01',
        ],
    ])->assertCreated()->json('studentId');

    // Guardian detail lists both children.
    $detail = $this->getJson("/api/guardians/{$guardianId}")->assertOk();
    expect($detail->json('children'))->toHaveCount(2);

    $this->asAcademy($this->academy);
    expect(DB::table('subscriptions')->where('student_id', $childA)->where('price_minor', 10000)->exists())->toBeTrue();
    expect(DB::table('subscriptions')->where('student_id', $childB)->where('price_minor', 9000)->exists())->toBeTrue();
});

// ── TC-4.2 / AC-4.1: two children, different teachers and prices ─────────────
it('lets two children of one guardian have different teachers and prices', function () {
    Sanctum::actingAs($this->owner);
    $guardianId = $this->postJson('/api/guardians', ['full_name' => 'Fam', 'whatsapp_phone' => '+201000000002'])->json('guardianId');

    $a = $this->postJson('/api/students', ['full_name' => 'A', 'guardian_id' => $guardianId, 'teacher_id' => $this->teacher1])->json('studentId');
    $b = $this->postJson('/api/students', ['full_name' => 'B', 'guardian_id' => $guardianId, 'teacher_id' => $this->teacher2])->json('studentId');

    $this->asAcademy($this->academy);
    $tA = DB::table('student_teacher_assignments')->where('student_id', $a)->whereNull('ended_at')->value('teacher_id');
    $tB = DB::table('student_teacher_assignments')->where('student_id', $b)->whereNull('ended_at')->value('teacher_id');
    expect($tA)->toBe($this->teacher1);
    expect($tB)->toBe($this->teacher2);
    expect($tA)->not->toBe($tB);
});

// ── TC-4.3 / AC-4.2: adult-solo student auto-creates a linked guardian ───────
it('creates a linked guardian for an adult-solo (self-guardian) student', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/students', [
        'full_name' => 'Adult Learner',
        'is_self_guardian' => true,
        'whatsapp_phone' => '+201000000003',
        'country' => 'EG',
    ])->assertCreated();

    $studentId = $res->json('studentId');
    $guardianId = $res->json('guardianId');
    expect($guardianId)->not->toBeNull();

    $this->asAcademy($this->academy);
    $student = DB::table('students')->where('id', $studentId)->first();
    expect($student->is_self_guardian)->toBeTrue();
    expect($student->guardian_id)->toBe($guardianId);
    $guardian = DB::table('guardians')->where('id', $guardianId)->first();
    expect($guardian->full_name)->toBe('Adult Learner');
});

// ── TC-4.4 / decision §3.7: a non-E.164 WhatsApp is normalised or rejected ───
it('normalises a forgiving phone format and rejects an unfixable one', function () {
    Sanctum::actingAs($this->owner);

    // Spaces/dashes/00-prefix are normalised to E.164.
    $id = $this->postJson('/api/guardians', ['full_name' => 'Norm', 'whatsapp_phone' => '0020 100-123 4567'])
        ->assertCreated()->json('guardianId');
    $this->asAcademy($this->academy);
    expect(DB::table('guardians')->where('id', $id)->value('whatsapp_phone'))->toBe('+201001234567');

    // Letters cannot be salvaged → 422 with a field error.
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/guardians', ['full_name' => 'Bad', 'whatsapp_phone' => 'not-a-phone'])
        ->assertStatus(422)->assertJsonValidationErrors('whatsapp_phone');
});

// ── TC-4.5 / AC-4.7: deactivate hides from default list, filterable, intact ──
it('hides a deactivated student from the default list but keeps it filterable and intact', function () {
    Sanctum::actingAs($this->owner);
    $guardianId = $this->postJson('/api/guardians', ['full_name' => 'G', 'whatsapp_phone' => '+201000000005'])->json('guardianId');
    $studentId = $this->postJson('/api/students', ['full_name' => 'ToDeactivate', 'guardian_id' => $guardianId])->json('studentId');

    $this->postJson("/api/students/{$studentId}/deactivate")->assertOk();

    // Default list excludes it.
    $default = $this->getJson('/api/students')->assertOk();
    expect(collect($default->json('rows'))->pluck('id'))->not->toContain($studentId);

    // filter[status]=inactive surfaces it.
    $inactive = $this->getJson('/api/students?filter[status]=inactive')->assertOk();
    expect(collect($inactive->json('rows'))->pluck('id'))->toContain($studentId);

    // The row still exists (no hard delete).
    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $studentId)->exists())->toBeTrue();
});

// ── TC-4.6 / AC-4.12: deactivating a guardian with active children is blocked ─
it('blocks deactivating a guardian who still has active children', function () {
    Sanctum::actingAs($this->owner);
    $guardianId = $this->postJson('/api/guardians', ['full_name' => 'Busy', 'whatsapp_phone' => '+201000000006'])->json('guardianId');
    $studentId = $this->postJson('/api/students', ['full_name' => 'Child', 'guardian_id' => $guardianId])->json('studentId');

    $this->postJson("/api/guardians/{$guardianId}/deactivate")->assertStatus(422);

    // Deactivate the child first, then the guardian succeeds.
    $this->postJson("/api/students/{$studentId}/deactivate")->assertOk();
    $this->postJson("/api/guardians/{$guardianId}/deactivate")->assertOk();
});
