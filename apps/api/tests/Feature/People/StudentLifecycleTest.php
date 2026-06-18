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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-lifecycle@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Lifecycle Teacher']);
});

/** Create a guardian + student that already has an active subscription and teacher. */
function enrolledStudent(): array
{
    $guardianId = test()->postJson('/api/guardians', ['full_name' => 'Fam', 'whatsapp_phone' => '+201000000300'])->json('guardianId');
    $studentId = test()->postJson('/api/students', [
        'full_name' => 'Enrolled',
        'guardian_id' => $guardianId,
        'teacher_id' => test()->teacher,
        'subscription' => [
            'plan_label' => '8/month', 'sessions_per_month' => 8,
            'price_minor' => 10000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION',
            'start_date' => '2026-06-01',
        ],
    ])->assertCreated()->json('studentId');

    return [$guardianId, $studentId];
}

// ── Deactivate records the reason and ends the active subscription + assignment ─
it('records the reason and ends the active subscription and teacher assignment on deactivate', function () {
    Sanctum::actingAs($this->owner);
    [, $studentId] = enrolledStudent();

    $this->postJson("/api/students/{$studentId}/deactivate", ['reason' => 'GRADUATED'])->assertOk();

    $this->asAcademy($this->academy);
    $student = DB::table('students')->where('id', $studentId)->first();
    expect($student->status)->toBe('GRADUATED');
    expect($student->deleted_at)->not->toBeNull();

    // No dangling ACTIVE subscription, no open teacher assignment.
    expect(DB::table('subscriptions')->where('student_id', $studentId)->where('status', 'ACTIVE')->count())->toBe(0);
    expect(DB::table('subscriptions')->where('student_id', $studentId)->where('status', 'ENDED')->count())->toBe(1);
    expect(DB::table('student_teacher_assignments')->where('student_id', $studentId)->whereNull('ended_at')->count())->toBe(0);
});

// ── Reason defaults to WITHDRAWN when omitted ────────────────────────────────
it('defaults the deactivation reason to WITHDRAWN', function () {
    Sanctum::actingAs($this->owner);
    [, $studentId] = enrolledStudent();

    $this->postJson("/api/students/{$studentId}/deactivate")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $studentId)->value('status'))->toBe('WITHDRAWN');
});

// ── Reactivate restores an active REGULAR learner; a second call 404s ────────
it('reactivates a deactivated student back to REGULAR and rejects reactivating an active one', function () {
    Sanctum::actingAs($this->owner);
    [, $studentId] = enrolledStudent();
    $this->postJson("/api/students/{$studentId}/deactivate", ['reason' => 'GRADUATED'])->assertOk();

    $this->postJson("/api/students/{$studentId}/reactivate")->assertOk();

    $this->asAcademy($this->academy);
    $student = DB::table('students')->where('id', $studentId)->first();
    expect($student->deleted_at)->toBeNull();
    expect($student->status)->toBe('REGULAR');

    // Already active → 404.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$studentId}/reactivate")->assertStatus(404);
});

// ── A student cannot become REGULAR without an active subscription ────────────
it('blocks promoting a student to REGULAR while they have no active subscription', function () {
    Sanctum::actingAs($this->owner);
    $guardianId = $this->postJson('/api/guardians', ['full_name' => 'G', 'whatsapp_phone' => '+201000000301'])->json('guardianId');
    // A bare trial student — no subscription.
    $studentId = $this->postJson('/api/students', ['full_name' => 'Trial', 'guardian_id' => $guardianId, 'status' => 'TRIAL'])->json('studentId');

    $this->patchJson("/api/students/{$studentId}", ['status' => 'REGULAR'])
        ->assertStatus(422)->assertJsonValidationErrors('status');

    // Once priced, the same transition succeeds.
    $this->putJson("/api/students/{$studentId}/subscription", [
        'plan_label' => '4/month', 'price_minor' => 8000, 'currency' => 'EGP', 'start_date' => '2026-06-01',
    ])->assertOk();
    $this->patchJson("/api/students/{$studentId}", ['status' => 'REGULAR'])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $studentId)->value('status'))->toBe('REGULAR');
});

// ── Terminal states are reachable only via deactivate, not a plain edit ───────
it('refuses to set a terminal status through a profile edit', function () {
    Sanctum::actingAs($this->owner);
    [, $studentId] = enrolledStudent();

    $this->patchJson("/api/students/{$studentId}", ['status' => 'GRADUATED'])
        ->assertStatus(422)->assertJsonValidationErrors('status');

    // Still active, untouched.
    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $studentId)->value('deleted_at'))->toBeNull();
});

// ── An unknown status value is rejected by the vocabulary ─────────────────────
it('rejects a status outside the lifecycle vocabulary', function () {
    Sanctum::actingAs($this->owner);
    [, $studentId] = enrolledStudent();

    $this->patchJson("/api/students/{$studentId}", ['status' => 'ADVANCED'])
        ->assertStatus(422)->assertJsonValidationErrors('status');
});

// ── trialResolved drives the profile's "next step" call-to-action ─────────────
it('flags a booked trial as resolved only once its session is recorded', function () {
    Sanctum::actingAs($this->owner);
    $studentId = $this->createStudent($this->academy, null, ['status' => 'TRIAL_BOOKED']);
    $sessionId = $this->createSession($this->academy, $studentId, $this->teacher, ['status' => 'SCHEDULED']);

    // Trial booked but not yet recorded → not resolved.
    expect($this->getJson("/api/students/{$studentId}")->assertOk()->json('trialResolved'))->toBeFalse();

    // Record the trial outcome (attended / cancelled / …) → resolved.
    $this->asAcademy($this->academy);
    DB::table('sessions')->where('id', $sessionId)->update(['status' => 'CANCELLED_BY_STUDENT']);

    Sanctum::actingAs($this->owner);
    expect($this->getJson("/api/students/{$studentId}")->assertOk()->json('trialResolved'))->toBeTrue();
});

it('never flags trialResolved for a plain TRIAL student (no trial booked yet)', function () {
    Sanctum::actingAs($this->owner);
    $studentId = $this->createStudent($this->academy, null, ['status' => 'TRIAL']);

    expect($this->getJson("/api/students/{$studentId}")->assertOk()->json('trialResolved'))->toBeFalse();
});
