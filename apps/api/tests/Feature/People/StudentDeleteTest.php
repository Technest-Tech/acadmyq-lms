<?php

declare(strict_types=1);

use App\Services\LessonPackages;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
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

// ── Removing a student winds down their lessons, timetable and package ───────
/** A past lesson nobody marked (it would sit in الحصص المعلقة) with a request waiting on it. */
function unmarkedLessonWithRequest(string $studentId): array
{
    $t = test();
    $sessionId = $t->createSession($t->academy, $studentId, $t->teacher, [
        'scheduled_at_utc' => '2026-06-08 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);
    $requestId = (string) \Illuminate\Support\Str::uuid();
    DB::table('session_cancellation_requests')->insert([
        'id' => $requestId,
        'academy_id' => $t->academy,
        'session_id' => $sessionId,
        'teacher_id' => $t->teacher,
        'cancel_type' => 'student',
        'status' => 'PENDING',
    ]);

    return [$sessionId, $requestId];
}

it('ends the timetable and clears every unmarked lesson when a student is deleted', function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    Sanctum::actingAs($this->owner);
    $studentId = deletableStudent();
    $this->putJson("/api/students/{$studentId}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertCreated();
    [$pastId, $requestId] = unmarkedLessonWithRequest($studentId);

    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson('/api/sessions/overdue')->json('sessions'))->pluck('id'))->toContain($pastId);

    $this->deleteJson("/api/students/{$studentId}")->assertOk();

    // Gone from الحصص المعلقة and from pending attendance.
    expect(collect($this->getJson('/api/sessions/overdue')->json('sessions'))->pluck('id'))->not->toContain($pastId);
    expect(collect($this->getJson('/api/sessions/pending-attendance')->json('sessions'))->pluck('id'))->not->toContain($pastId);

    $this->asAcademy($this->academy);
    // The timetable is ended, so nothing new is generated and future lessons are gone.
    expect(DB::table('schedules')->where('student_id', $studentId)->where('is_active', true)->count())->toBe(0);
    expect(DB::table('sessions')->where('student_id', $studentId)->where('scheduled_at_utc', '>', now())->count())->toBe(0);
    // Nothing of theirs is left waiting to be marked; the past one is kept, closed as not billed.
    expect(DB::table('sessions')->where('student_id', $studentId)->where('status', 'SCHEDULED')->count())->toBe(0);
    expect(DB::table('sessions')->where('id', $pastId)->value('status'))->toBe('CANCELLED_BY_STUDENT');
    // The request waiting on it has left the approvals queue.
    expect(DB::table('session_cancellation_requests')->where('id', $requestId)->value('status'))->toBe('REJECTED');
});

it('closes the open lesson package when a student is deleted', function () {
    Sanctum::actingAs($this->owner);
    $studentId = deletableStudent();

    $this->asAcademy($this->academy);
    $packages = app(LessonPackages::class);
    $open = fn () => $packages->open([
        'student_id' => $studentId, 'label' => '10 hours', 'minutes_total' => 600,
        'price_minor' => 200000, 'currency' => 'EGP', 'bill_timing' => 'ON_START',
        'starts_on' => '2026-06-01', 'carry_over' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER');
    $packageId = $open()['package_id'];

    $this->deleteJson("/api/students/{$studentId}")->assertOk();

    $this->asAcademy($this->academy);
    // Untouched → voided, not left ACTIVE.
    $row = DB::table('lesson_packages')->where('id', $packageId)->first();
    expect($row->status)->toBe('CANCELLED');
    expect($row->closed_reason)->toBe('STUDENT_REMOVED');
    expect($packages->activeFor($studentId))->toBeNull();
});

it('closes a partly used package as completed, and deactivate does the same wind-down', function () {
    Sanctum::actingAs($this->owner);
    $studentId = deletableStudent();

    $this->asAcademy($this->academy);
    $packageId = app(LessonPackages::class)->open([
        'student_id' => $studentId, 'label' => '10 hours', 'minutes_total' => 600,
        'price_minor' => 200000, 'currency' => 'EGP', 'bill_timing' => 'ON_START',
        'starts_on' => '2026-06-01', 'carry_over' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER')['package_id'];
    DB::table('lesson_packages')->where('id', $packageId)->update(['minutes_consumed' => 60]);
    [$pastId] = unmarkedLessonWithRequest($studentId);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$studentId}/deactivate")->assertOk();

    $this->asAcademy($this->academy);
    $row = DB::table('lesson_packages')->where('id', $packageId)->first();
    expect($row->status)->toBe('COMPLETED');
    expect($row->closed_reason)->toBe('STUDENT_REMOVED');
    expect(DB::table('sessions')->where('id', $pastId)->value('status'))->toBe('CANCELLED_BY_STUDENT');
});
