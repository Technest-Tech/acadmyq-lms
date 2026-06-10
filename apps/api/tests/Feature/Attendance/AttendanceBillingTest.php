<?php

declare(strict_types=1);

use App\Billing\BillingHook;
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
    // "Now" sits AFTER the session time so the §3.7 timing gate is satisfied by default.
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-att@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-att@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id, 'full_name' => 'Att Teacher']);
    $this->student = $this->createStudent($this->academy);

    // Test-bound helpers (closures see $this, so they can use the protected trait methods).
    $this->pendingSession = fn (): string => $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
    $this->lineItems = function (string $sessionId): int {
        $this->asAcademy($this->academy);

        return DB::table('invoice_line_items')->where('session_id', $sessionId)->count();
    };
    $this->row = function (string $sessionId): object {
        $this->asAcademy($this->academy);

        return DB::table('sessions')->where('id', $sessionId)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ── §4 classification matrix, end-to-end through the endpoint ────────────────

it('marks ATTENDED: billable + counts for teacher, outcome provenance set', function () {
    // TC-6.1 — §4 row ATTENDED
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $res = $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect($res->json('classification'))->toBe(['billableToStudent' => true, 'countsForTeacher' => true]);

    $row = ($this->row)($session);
    expect($row->status)->toBe('ATTENDED')
        ->and((bool) $row->billed)->toBeTrue()
        ->and($row->outcome_set_at)->not->toBeNull()
        ->and($row->outcome_set_by)->toBe($this->owner->id);
});

it('marks ABSENT_UNEXCUSED: billable but not counting for teacher', function () {
    // TC-6.2 / TC-6.9 — §4 row ABSENT_UNEXCUSED (charged, no notice)
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $res = $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ABSENT_UNEXCUSED'])->assertOk();
    expect($res->json('classification'))->toBe(['billableToStudent' => true, 'countsForTeacher' => false]);

    expect((bool) ($this->row)($session)->billed)->toBeTrue()
        ->and(($this->lineItems)($session))->toBe(1);
});

it('marks ABSENT_EXCUSED: neither billable nor counting, no line item', function () {
    // TC-6.3 / TC-6.13 — §4 row ABSENT_EXCUSED
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $res = $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ABSENT_EXCUSED', 'reason' => 'gave notice'])->assertOk();
    expect($res->json('classification'))->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);

    expect((bool) ($this->row)($session)->billed)->toBeFalse()
        ->and(($this->lineItems)($session))->toBe(0);
});

it('marks CANCELLED_BY_TEACHER and CANCELLED_BY_STUDENT: non-billable, no line item', function () {
    // TC-6.4 / TC-6.5 / TC-6.13 — §4 rows CANCELLED_BY_*
    Sanctum::actingAs($this->owner);

    foreach (['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'] as $status) {
        $session = ($this->pendingSession)();
        $res = $this->postJson("/api/sessions/{$session}/attendance", ['status' => $status])->assertOk();
        expect($res->json('classification'))->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);
        expect((bool) ($this->row)($session)->billed)->toBeFalse()
            ->and(($this->lineItems)($session))->toBe(0);
    }
});

// ── billing hook & idempotency ──────────────────────────────────────────────

it('fires the billable hook exactly once and creates one line item', function () {
    // TC-6.7 — fires once; billed=true; exactly one line item
    $session = ($this->pendingSession)();

    $spy = new class implements BillingHook
    {
        public int $billable = 0;

        public int $unbilled = 0;

        public function onSessionBillable(object $session): void
        {
            $this->billable++;
        }

        public function onSessionUnbilled(object $session): void
        {
            $this->unbilled++;
        }
    };
    app()->instance(BillingHook::class, $spy);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    expect($spy->billable)->toBe(1)->and($spy->unbilled)->toBe(0);
    expect((bool) ($this->row)($session)->billed)->toBeTrue();
});

it('is idempotent on re-submitting the same ATTENDED outcome', function () {
    // TC-6.8 — re-POST: no second hook fire, no duplicate line item (guard + unique constraint)
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    expect(($this->lineItems)($session))->toBe(1);
});

it('reconciles ABSENT_UNEXCUSED → ATTENDED while OPEN without duplicating the line', function () {
    // TC-6.10 — both billable; the guard means no second hook, still one line
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ABSENT_UNEXCUSED'])->assertOk();
    expect(($this->lineItems)($session))->toBe(1);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->lineItems)($session))->toBe(1)
        ->and((bool) ($this->row)($session)->billed)->toBeTrue();
});

it('reverses the line item when ATTENDED → ABSENT_EXCUSED while OPEN', function () {
    // TC-6.11 — onSessionUnbilled removes the line; billed=false
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->lineItems)($session))->toBe(1);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ABSENT_EXCUSED', 'reason' => 'notice after all'])->assertOk();
    expect(($this->lineItems)($session))->toBe(0)
        ->and((bool) ($this->row)($session)->billed)->toBeFalse();
});

it('blocks un-billing once the invoice is CLOSED and rolls the change back', function () {
    // TC-6.12 — immutability after close (R-INV-3)
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // Close the invoice the hook opened (OPEN → CLOSED is a legal transition).
    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoice_line_items')->where('session_id', $session)->value('invoice_id');
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ABSENT_EXCUSED'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');

    // Nothing changed: still ATTENDED, still billed, line item intact (atomic rollback).
    $row = ($this->row)($session);
    expect($row->status)->toBe('ATTENDED')->and((bool) $row->billed)->toBeTrue();
    expect(($this->lineItems)($session))->toBe(1);
});

// ── roles, scoping, timing ──────────────────────────────────────────────────

it('lets a Teacher mark their OWN session; outcome_set_by is the teacher', function () {
    // TC-6.21
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->row)($session)->outcome_set_by)->toBe($this->teacherUser->id);
});

it('forbids a Teacher from marking ANOTHER teacher\'s session', function () {
    // TC-6.22
    $otherTeacher = $this->createTeacher($this->academy, ['full_name' => 'Other']);
    $session = $this->createSession($this->academy, $this->student, $otherTeacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertForbidden();

    expect(($this->row)($session)->status)->toBe('SCHEDULED');
});

it('lets the Owner mark any session; outcome_set_by is the owner', function () {
    // TC-6.23
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->row)($session)->outcome_set_by)->toBe($this->owner->id);
});

it('cannot reach a session in another academy (RLS makes it invisible)', function () {
    // TC-6.24
    $otherAcademy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $otherTeacher = $this->createTeacher($otherAcademy);
    $otherStudent = $this->createStudent($otherAcademy);
    $foreign = $this->createSession($otherAcademy, $otherStudent, $otherTeacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner); // owner of $this->academy, not $otherAcademy
    $this->postJson("/api/sessions/{$foreign}/attendance", ['status' => 'ATTENDED'])->assertNotFound();
});

it('blocks attendance on a future session beyond grace, but allows an audited owner override', function () {
    // TC-6.25 — §3.7 timing gate + override
    $future = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 15:00:00+00', 'status' => 'SCHEDULED', // after "now"
    ]);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$future}/attendance", ['status' => 'ATTENDED'])
        ->assertStatus(422)->assertJsonValidationErrors('status');
    expect(($this->row)($future)->status)->toBe('SCHEDULED');

    $this->postJson("/api/sessions/{$future}/attendance", ['status' => 'ATTENDED', 'override_timing' => true])->assertOk();
    expect(($this->row)($future)->status)->toBe('ATTENDED');

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'session.attendance_override')->where('entity_id', $future)->exists())->toBeTrue();
});

it('forbids a Teacher overriding the timing gate', function () {
    // §3.7 — override is Owner/Super-Admin only
    $future = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/sessions/{$future}/attendance", ['status' => 'ATTENDED', 'override_timing' => true])
        ->assertStatus(422);
    expect(($this->row)($future)->status)->toBe('SCHEDULED');
});
