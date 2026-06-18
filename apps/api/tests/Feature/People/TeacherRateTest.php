<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
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

// ── Owner-set login password: the teacher can sign in with the chosen password ──
it('provisions a teacher login with the owner-chosen password', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/teachers', [
        'full_name' => 'Ustadha Mariam',
        'session_rate_minor' => 5000,
        'currency' => 'EGP',
        'create_login' => true,
        'email' => 'mariam@academy.test',
        'password' => 'secret-pass-123',
    ])->assertCreated();

    $userId = $res->json('userId');
    expect($userId)->not->toBeNull();

    $this->asAcademy($this->academy);
    $user = DB::table('users')->where('id', $userId)->first();
    expect($user->email)->toBe('mariam@academy.test')
        ->and(Hash::check('secret-pass-123', $user->password))->toBeTrue();
});

// ── A login without a password is rejected (the owner must set one) ──
it('requires a password when creating a teacher login', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/teachers', [
        'full_name' => 'No Pass',
        'session_rate_minor' => 5000,
        'currency' => 'EGP',
        'create_login' => true,
        'email' => 'nopass@academy.test',
    ])->assertStatus(422);
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

// ── Hard delete: a clean teacher (no history) is permanently removed, login and all ──
it('permanently deletes a clean teacher and their login', function () {
    Sanctum::actingAs($this->owner);
    $res = $this->postJson('/api/teachers', [
        'full_name' => 'Throwaway',
        'session_rate_minor' => 8000,
        'currency' => 'EGP',
        'create_login' => true,
        'email' => 'throwaway@academy.test',
        'password' => 'secret-pass-123',
    ])->assertCreated();
    $teacher = $res->json('teacherId');
    $userId = $res->json('userId');

    $this->deleteJson("/api/teachers/{$teacher}")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('teachers')->where('id', $teacher)->exists())->toBeFalse();
    expect(DB::table('users')->where('id', $userId)->exists())->toBeFalse();
    expect(DB::table('user_roles')->where('user_id', $userId)->exists())->toBeFalse();
    $audit = DB::table('audit_log')->where('action', 'teacher.delete')->where('entity_id', $teacher)->first();
    expect($audit)->not->toBeNull();
});

// ── Hard delete cascades: a teacher WITH history is removed along with their records ──
it('permanently deletes a teacher and cascades their history', function () {
    Sanctum::actingAs($this->owner);
    $teacher = $this->postJson('/api/teachers', ['full_name' => 'Hist', 'session_rate_minor' => 8000, 'currency' => 'EGP'])->json('teacherId');
    $guardian = $this->postJson('/api/guardians', ['full_name' => 'G', 'whatsapp_phone' => '+201000000019'])->json('guardianId');
    $student = $this->postJson('/api/students', ['full_name' => 'S', 'guardian_id' => $guardian, 'teacher_id' => $teacher])->json('studentId');

    // Sanity: the assignment exists before deletion.
    $this->asAcademy($this->academy);
    expect(DB::table('student_teacher_assignments')->where('teacher_id', $teacher)->exists())->toBeTrue();
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/teachers/{$teacher}")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('teachers')->where('id', $teacher)->exists())->toBeFalse();
    expect(DB::table('student_teacher_assignments')->where('teacher_id', $teacher)->exists())->toBeFalse();
    // The student themselves is untouched.
    expect(DB::table('students')->where('id', $student)->exists())->toBeTrue();
    $audit = DB::table('audit_log')->where('action', 'teacher.delete')->where('entity_id', $teacher)->first();
    expect($audit)->not->toBeNull();
    expect(json_decode($audit->before, true)['removed']['assignments'])->toBe(1);
});

// ── Full cascade: schedule, slot, session, lesson report, payroll all go; invoice survives ──
it('cascades schedule, sessions, reports and payroll on delete while keeping the invoice', function () {
    Sanctum::actingAs($this->owner);
    $teacher = $this->postJson('/api/teachers', ['full_name' => 'Full', 'session_rate_minor' => 8000, 'currency' => 'EGP'])->json('teacherId');
    $guardian = $this->postJson('/api/guardians', ['full_name' => 'G', 'whatsapp_phone' => '+201000000020'])->json('guardianId');
    $student = $this->postJson('/api/students', ['full_name' => 'S', 'guardian_id' => $guardian, 'teacher_id' => $teacher])->json('studentId');

    // Build a full history graph directly under the academy's tenant context.
    $this->asAcademy($this->academy);
    $aid = $this->academy;
    $now = now();
    $scheduleId = (string) Str::uuid();
    DB::table('schedules')->insert(['id' => $scheduleId, 'academy_id' => $aid, 'student_id' => $student, 'teacher_id' => $teacher, 'timezone' => 'Africa/Cairo', 'created_at' => $now, 'updated_at' => $now]);
    $slotId = (string) Str::uuid();
    DB::table('schedule_slots')->insert(['id' => $slotId, 'academy_id' => $aid, 'schedule_id' => $scheduleId, 'weekday' => 1, 'start_time_local' => '17:00', 'created_at' => $now, 'updated_at' => $now]);
    $sessionId = (string) Str::uuid();
    DB::table('sessions')->insert(['id' => $sessionId, 'academy_id' => $aid, 'student_id' => $student, 'teacher_id' => $teacher, 'schedule_id' => $scheduleId, 'slot_id' => $slotId, 'scheduled_at_utc' => $now, 'duration_minutes' => 60, 'created_at' => $now, 'updated_at' => $now]);
    DB::table('session_reports')->insert(['id' => (string) Str::uuid(), 'academy_id' => $aid, 'session_id' => $sessionId, 'created_at' => $now, 'updated_at' => $now]);
    $payoutId = (string) Str::uuid();
    DB::table('payouts')->insert(['id' => $payoutId, 'academy_id' => $aid, 'teacher_id' => $teacher, 'period_year' => 2026, 'period_month' => 6, 'currency' => 'EGP', 'created_at' => $now, 'updated_at' => $now]);
    DB::table('payout_line_items')->insert(['id' => (string) Str::uuid(), 'academy_id' => $aid, 'payout_id' => $payoutId, 'session_id' => $sessionId, 'amount_minor' => 8000, 'currency' => 'EGP', 'created_at' => $now]);
    $invoiceId = (string) Str::uuid();
    DB::table('invoices')->insert(['id' => $invoiceId, 'academy_id' => $aid, 'guardian_id' => $guardian, 'period_year' => 2026, 'period_month' => 6, 'currency' => 'EGP', 'public_token' => Str::random(32), 'created_at' => $now, 'updated_at' => $now]);
    $lineId = (string) Str::uuid();
    DB::table('invoice_line_items')->insert(['id' => $lineId, 'academy_id' => $aid, 'invoice_id' => $invoiceId, 'session_id' => $sessionId, 'student_id' => $student, 'description' => 'Session', 'amount_minor' => 8000, 'currency' => 'EGP', 'created_at' => $now]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/teachers/{$teacher}")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('teachers')->where('id', $teacher)->exists())->toBeFalse();
    expect(DB::table('schedules')->where('id', $scheduleId)->exists())->toBeFalse();
    expect(DB::table('schedule_slots')->where('id', $slotId)->exists())->toBeFalse();
    expect(DB::table('sessions')->where('id', $sessionId)->exists())->toBeFalse();
    expect(DB::table('session_reports')->where('session_id', $sessionId)->exists())->toBeFalse();
    expect(DB::table('payouts')->where('id', $payoutId)->exists())->toBeFalse();
    expect(DB::table('payout_line_items')->where('session_id', $sessionId)->exists())->toBeFalse();
    // The guardian's invoice survives; the line item is detached from the deleted session.
    expect(DB::table('invoices')->where('id', $invoiceId)->exists())->toBeTrue();
    $line = DB::table('invoice_line_items')->where('id', $lineId)->first();
    expect($line)->not->toBeNull();
    expect($line->session_id)->toBeNull();
});
