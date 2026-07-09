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

/**
 * Marking a lesson FREE mirrors the cancellation approval flow: the per-academy billing decision
 * (charge the student? pay the teacher?) is the owner's, so a TEACHER can't apply FREE directly —
 * they raise a request the owner approves (→ status FREE, with the same charge/pay override).
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-free@test.local']);

    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-free@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Free Teacher', 'user_id' => $this->teacherUser->id]);

    $this->student = $this->createStudent($this->academy, overrides: ['full_name' => 'Pupil']);
    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

it('blocks a teacher from marking a lesson free directly (no back door)', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/sessions/{$this->session}/attendance", [
        'status' => 'FREE', 'override_timing' => true,
    ])->assertStatus(422)->assertJsonValidationErrors('status');

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
});

it('lets an owner mark a lesson free directly, on the house by default', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$this->session}/attendance", [
        'status' => 'FREE', 'override_timing' => true,
    ])->assertOk();

    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $this->session)->first();
    expect($row->status)->toBe('FREE')
        ->and((bool) $row->billed)->toBeFalse();
    expect(DB::table('invoice_line_items')->where('session_id', $this->session)->count())->toBe(0);
});

it('lets an owner mark free but still charge the student via a billing override', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$this->session}/attendance", [
        'status' => 'FREE',
        'charge_student' => true,
        'pay_teacher' => false,
        'reason' => 'Make-up already billed',
        'override_timing' => true,
    ])->assertOk();

    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $this->session)->first();
    expect($row->status)->toBe('FREE')
        ->and((bool) $row->bill_override)->toBeTrue()
        ->and((bool) $row->billed)->toBeTrue();
    $line = DB::table('invoice_line_items')->where('session_id', $this->session)->first();
    expect($line)->not->toBeNull()
        ->and($line->description)->toContain('Make-up already billed');
});

it('lets a teacher raise a free request without changing the session', function () {
    Sanctum::actingAs($this->teacherUser);

    $res = $this->postJson("/api/sessions/{$this->session}/free-request", ['reason' => 'Comp lesson'])
        ->assertStatus(201);
    expect($res->json('status'))->toBe('PENDING');

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
    $req = DB::table('session_cancellation_requests')->where('session_id', $this->session)->first();
    expect($req->status)->toBe('PENDING')
        ->and($req->request_type)->toBe('FREE')
        ->and($req->cancel_type)->toBeNull()
        ->and((string) $req->teacher_id)->toBe($this->teacher);
});

it('surfaces a pending free request on the session detail and clears it on approval', function () {
    Sanctum::actingAs($this->teacherUser);
    expect($this->getJson("/api/sessions/{$this->session}")->assertOk()->json('session.pending_free'))->toBeNull();

    $this->postJson("/api/sessions/{$this->session}/free-request", ['reason' => 'Comp lesson'])->assertStatus(201);

    $res = $this->getJson("/api/sessions/{$this->session}")->assertOk();
    expect($res->json('session.status'))->toBe('SCHEDULED')
        ->and($res->json('session.pending_free.reason'))->toBe('Comp lesson')
        // A free request is NOT a cancellation — the cancel indicator stays empty.
        ->and($res->json('session.pending_cancellation'))->toBeNull();

    $reqId = DB::table('session_cancellation_requests')->where('session_id', $this->session)->value('id');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/cancellation-requests/{$reqId}/approve")->assertOk();

    Sanctum::actingAs($this->teacherUser);
    expect($this->getJson("/api/sessions/{$this->session}")->assertOk()->json('session.pending_free'))->toBeNull();
});

it('marks the lesson free when the owner approves, charging the parent per the billing decision', function () {
    Sanctum::actingAs($this->teacherUser);
    $reqId = $this->postJson("/api/sessions/{$this->session}/free-request", ['reason' => 'Comp lesson'])
        ->assertStatus(201)->json('requestId');

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/cancellation-requests/{$reqId}/approve", [
        'charge_student' => true,
        'pay_teacher' => false,
        'reason' => 'Charged — policy exception',
    ])->assertOk();
    expect($res->json('sessionStatus'))->toBe('FREE');

    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $this->session)->first();
    expect($row->status)->toBe('FREE')
        ->and((bool) $row->bill_override)->toBeTrue()
        ->and((bool) $row->billed)->toBeTrue();
    $line = DB::table('invoice_line_items')->where('session_id', $this->session)->first();
    expect($line)->not->toBeNull()
        ->and($line->description)->toContain('Charged — policy exception');
    expect(DB::table('audit_log')->where('action', 'session.marked_free')->where('entity_id', $this->session)->exists())->toBeTrue();
});

it('leaves the session scheduled when the owner rejects a free request', function () {
    Sanctum::actingAs($this->teacherUser);
    $reqId = $this->postJson("/api/sessions/{$this->session}/free-request")
        ->assertStatus(201)->json('requestId');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/cancellation-requests/{$reqId}/reject", ['note' => 'Charge as normal'])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
    expect(DB::table('session_cancellation_requests')->where('id', $reqId)->value('status'))->toBe('REJECTED');
});

it('forbids a teacher from approving a free request', function () {
    Sanctum::actingAs($this->teacherUser);
    $reqId = $this->postJson("/api/sessions/{$this->session}/free-request")
        ->assertStatus(201)->json('requestId');

    $this->postJson("/api/cancellation-requests/{$reqId}/approve")->assertStatus(403);

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->session)->value('status'))->toBe('SCHEDULED');
});

it('shows a free request in the owner approval queue with its type', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/free-request", ['reason' => 'Comp lesson'])->assertStatus(201);

    Sanctum::actingAs($this->owner);
    $rows = $this->getJson('/api/cancellation-requests')->assertOk()->json('requests');
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['request_type'])->toBe('FREE');

    // It also counts toward the owner's Classes badge.
    expect($this->getJson('/api/notifications/summary')->assertOk()->json('classes'))->toBe(1);
});

it('allows only one pending request per session across both types', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/free-request")->assertStatus(201);

    // A cancellation request can't be raised while a free request is still pending, and vice versa.
    $this->postJson("/api/sessions/{$this->session}/cancellation-request", ['cancelled_by' => 'teacher'])
        ->assertStatus(422)->assertJsonValidationErrors('session');
    $this->postJson("/api/sessions/{$this->session}/free-request")
        ->assertStatus(422)->assertJsonValidationErrors('session');
});

it('refuses a free request on a session that is not scheduled', function () {
    $done = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 16:00:00+00', 'status' => 'ATTENDED',
    ]);
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/sessions/{$done}/free-request")
        ->assertStatus(422)->assertJsonValidationErrors('session');
});
