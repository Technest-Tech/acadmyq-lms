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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-rate@test.local']);
});

// ── TC-4.16 / AC-4.5: create teacher with a session rate, visible on detail ──
it('creates a teacher with a session rate that shows on the detail', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/teachers', [
        'full_name' => 'Ustadh Kareem',
        'specialization' => 'Tajweed',
        'session_rate_minor' => 8000,   // 80.00 EGP / session
        'currency' => 'EGP',
        'availability' => [['weekday' => 1, 'start_local' => '17:00', 'end_local' => '19:00']],
    ])->assertCreated()->json('teacherId');

    $detail = $this->getJson("/api/teachers/{$id}")->assertOk();
    expect($detail->json('teacher.session_rate_minor'))->toBe(8000);
    expect($detail->json('teacher.currency'))->toBe('EGP');
    expect($detail->json('teacher.availability'))->toHaveCount(1);
});

// ── TC-4.17 / AC-4.5: editing the rate is audited (forward-looking metadata) ─
it('audits a teacher rate change as a forward-looking edit', function () {
    Sanctum::actingAs($this->owner);
    $id = $this->postJson('/api/teachers', ['full_name' => 'Rate', 'session_rate_minor' => 8000, 'currency' => 'EGP'])->json('teacherId');

    $this->patchJson("/api/teachers/{$id}", ['session_rate_minor' => 9000])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('teachers')->where('id', $id)->value('session_rate_minor'))->toBe(9000);
    $audit = DB::table('audit_log')->where('action', 'teacher.update')->where('entity_id', $id)->latest('created_at')->first();
    expect(json_decode($audit->before, true)['session_rate_minor'])->toBe(8000);
    expect(json_decode($audit->after, true)['session_rate_minor'])->toBe(9000);
});

// ── TC-4.18 / AC-4.12: deactivating a teacher with active students is blocked ─
it('blocks deactivating a teacher with active students until they are reassigned', function () {
    Sanctum::actingAs($this->owner);
    $teacher1 = $this->postJson('/api/teachers', ['full_name' => 'Busy', 'session_rate_minor' => 8000, 'currency' => 'EGP'])->json('teacherId');
    $teacher2 = $this->postJson('/api/teachers', ['full_name' => 'Free', 'session_rate_minor' => 8000, 'currency' => 'EGP'])->json('teacherId');
    $guardian = $this->postJson('/api/guardians', ['full_name' => 'G', 'whatsapp_phone' => '+201000000018'])->json('guardianId');
    $student = $this->postJson('/api/students', ['full_name' => 'S', 'guardian_id' => $guardian, 'teacher_id' => $teacher1])->json('studentId');

    $this->postJson("/api/teachers/{$teacher1}/deactivate")->assertStatus(422);

    // Reassign the student to another teacher, then deactivation succeeds.
    $this->postJson("/api/students/{$student}/teacher", ['teacher_id' => $teacher2])->assertOk();
    $this->postJson("/api/teachers/{$teacher1}/deactivate")->assertOk();
});
