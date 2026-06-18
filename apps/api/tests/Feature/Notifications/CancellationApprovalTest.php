<?php

declare(strict_types=1);

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
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-appr@test.local']);

    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-appr@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Req Teacher', 'user_id' => $this->teacherUser->id]);

    $this->student = $this->createStudent($this->academy, overrides: ['full_name' => 'Pupil']);
    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

it('lets a teacher raise a cancellation request without changing the session', function () {
    Sanctum::actingAs($this->teacherUser);

    $res = $this->postJson("/api/sessions/{$this->session}/cancellation-request", [
        'cancelled_by' => 'teacher', 'reason' => 'Sick',
    ])->assertStatus(201);

    expect($res->json('status'))->toBe('PENDING');

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
    $req = DB::table('session_cancellation_requests')->where('session_id', $this->session)->first();
    expect($req->status)->toBe('PENDING')
        ->and($req->cancel_type)->toBe('teacher')
        ->and((string) $req->teacher_id)->toBe($this->teacher);
});

it('blocks a teacher from cancelling a class directly (must request)', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/sessions/{$this->session}/cancel", ['cancelled_by' => 'teacher'])
        ->assertStatus(403);
});

it('blocks a teacher from cancelling via the attendance endpoint (no back door)', function () {
    Sanctum::actingAs($this->teacherUser);

    foreach (['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'] as $status) {
        $this->postJson("/api/sessions/{$this->session}/attendance", [
            'status' => $status, 'override_timing' => true,
        ])->assertStatus(422)->assertJsonValidationErrors('status');
    }

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
});

it('still lets an owner cancel via the attendance endpoint', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$this->session}/attendance", [
        'status' => 'CANCELLED_BY_TEACHER', 'override_timing' => true,
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('CANCELLED_BY_TEACHER');
});

it('blocks a teacher from marking a student absent (academy-only outcome)', function () {
    Sanctum::actingAs($this->teacherUser);

    foreach (['ABSENT_UNEXCUSED', 'ABSENT_EXCUSED'] as $status) {
        $this->postJson("/api/sessions/{$this->session}/attendance", [
            'status' => $status, 'override_timing' => true,
        ])->assertStatus(422)->assertJsonValidationErrors('status');
    }

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
});

it('still lets an owner mark a student absent via the attendance endpoint', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$this->session}/attendance", [
        'status' => 'ABSENT_UNEXCUSED', 'override_timing' => true,
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('ABSENT_UNEXCUSED');
});

it('rejects a second pending request for the same session', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])->assertStatus(201);

    $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'student'])
        ->assertStatus(422)->assertJsonValidationErrors('session');
});

it('refuses a request on a session that is not scheduled', function () {
    $done = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 16:00:00+00', 'status' => 'ATTENDED',
    ]);
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/sessions/{$done}/cancellation-request", ['cancelled_by' => 'teacher'])
        ->assertStatus(422)->assertJsonValidationErrors('session');
});

it('forbids a teacher from approving a request', function () {
    Sanctum::actingAs($this->teacherUser);
    $reqId = $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])
        ->assertStatus(201)->json('requestId');

    $this->postJson("/api/cancellation-requests/{$reqId}/approve")->assertStatus(403);
});

it('cancels the session when the owner approves', function () {
    Sanctum::actingAs($this->teacherUser);
    $reqId = $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'student', 'reason' => 'Travel'])
        ->assertStatus(201)->json('requestId');

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/cancellation-requests/{$reqId}/approve", ['note' => 'OK'])->assertOk();
    expect($res->json('status'))->toBe('APPROVED')
        ->and($res->json('sessionStatus'))->toBe('CANCELLED_BY_STUDENT');

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('CANCELLED_BY_STUDENT');
    expect(DB::table('session_cancellation_requests')->where('id', $reqId)->value('status'))->toBe('APPROVED');
    expect(DB::table('audit_log')->where('action', 'session.cancellation_approved')->where('entity_id', $reqId)->exists())->toBeTrue();
    expect(DB::table('audit_log')->where('action', 'session.cancelled')->where('entity_id', $this->session)->exists())->toBeTrue();
});

it('leaves the session scheduled when the owner rejects', function () {
    Sanctum::actingAs($this->teacherUser);
    $reqId = $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])
        ->assertStatus(201)->json('requestId');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/cancellation-requests/{$reqId}/reject", ['note' => 'Find a sub'])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
    expect(DB::table('session_cancellation_requests')->where('id', $reqId)->value('status'))->toBe('REJECTED');
});

it('cannot decide a request twice', function () {
    Sanctum::actingAs($this->teacherUser);
    $reqId = $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])
        ->assertStatus(201)->json('requestId');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/cancellation-requests/{$reqId}/approve")->assertOk();
    $this->postJson("/api/cancellation-requests/{$reqId}/reject")->assertStatus(422);
});

it('shows the owner every request in the academy (approval queue)', function () {
    // A second teacher with their own request.
    $otherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher2-appr@test.local']);
    $otherTeacher = $this->createTeacher($this->academy, ['full_name' => 'Other', 'user_id' => $otherUser->id]);
    $otherStudent = $this->createStudent($this->academy, overrides: ['full_name' => 'Other Pupil']);
    $otherSession = $this->createSession($this->academy, $otherStudent, $otherTeacher, [
        'scheduled_at_utc' => '2026-06-21 15:00:00+00', 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])->assertStatus(201);
    Sanctum::actingAs($otherUser);
    $this->postJson("/api/sessions/{$otherSession}/cancellation-request", ['cancelled_by' => 'teacher'])->assertStatus(201);

    // The owner sees both.
    Sanctum::actingAs($this->owner);
    expect($this->getJson('/api/cancellation-requests')->assertOk()->json('requests'))->toHaveCount(2);
});

it('counts pending requests in the owner badge summary', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])->assertStatus(201);

    Sanctum::actingAs($this->owner);
    expect($this->getJson('/api/notifications/summary')->assertOk()->json('classes'))->toBe(1);
});

it('forbids a teacher from the owner-only Notifications endpoints', function () {
    Sanctum::actingAs($this->teacherUser);
    // A teacher can still RAISE a cancellation request…
    $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])->assertStatus(201);

    // …but the Notifications page (approval queue + report feed) is owner-only: a teacher has no
    // notification.read, so every read endpoint behind it is 403.
    $this->getJson('/api/cancellation-requests')->assertStatus(403);
    $this->getJson('/api/notifications')->assertStatus(403);
    $this->getJson('/api/notifications/summary')->assertStatus(403);
});
