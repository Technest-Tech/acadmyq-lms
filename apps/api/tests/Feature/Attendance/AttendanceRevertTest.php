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
 * Taking a recorded outcome BACK (POST /api/sessions/{id}/attendance/revert).
 *
 * The point of the endpoint is that a lesson marked by mistake is not a dead end: it returns to
 * SCHEDULED, the money it moved is moved back, and — the reason the academy asked for it — it
 * becomes reschedulable again, because a reschedule refuses anything that is not SCHEDULED.
 *
 * The two things it must NOT do are equally load-bearing: it must not quietly strand money that
 * has already been closed off, and it must not be reachable by a teacher, for whom it would be a
 * way to undo the owner's own cancellation decision.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    // "Now" sits AFTER the session time so the §3.7 timing gate is satisfied by default.
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-revert@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-revert@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id, 'full_name' => 'Revert Teacher']);
    $this->student = $this->createStudent($this->academy);

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

// ── the happy path ──────────────────────────────────────────────────────────

it('puts an ATTENDED lesson back to SCHEDULED, un-billing it and clearing the outcome stamp', function () {
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->lineItems)($session))->toBe(1);

    $res = $this->postJson("/api/sessions/{$session}/attendance/revert")->assertOk();
    expect($res->json('status'))->toBe('SCHEDULED')
        ->and($res->json('classification'))->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);

    // The lesson looks untouched again — which is what the pending/overdue worklists read.
    $row = ($this->row)($session);
    expect($row->status)->toBe('SCHEDULED')
        ->and((bool) $row->billed)->toBeFalse()
        ->and((bool) $row->paid_to_teacher)->toBeFalse()
        ->and($row->outcome_set_at)->toBeNull()
        ->and($row->outcome_set_by)->toBeNull()
        ->and($row->status_reason)->toBeNull();
    expect(($this->lineItems)($session))->toBe(0);
});

it('clears the per-occurrence billing overrides of a charged cancellation', function () {
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", [
        'status' => 'CANCELLED_BY_STUDENT', 'charge_student' => true, 'pay_teacher' => true, 'reason' => 'late notice',
    ])->assertOk();
    expect(($this->lineItems)($session))->toBe(1);

    $this->postJson("/api/sessions/{$session}/attendance/revert")->assertOk();

    // A stale override would silently re-charge the lesson the next time it was marked.
    $row = ($this->row)($session);
    expect($row->status)->toBe('SCHEDULED')
        ->and($row->bill_override)->toBeNull()
        ->and($row->teacher_override)->toBeNull()
        ->and((bool) $row->billed)->toBeFalse();
    expect(($this->lineItems)($session))->toBe(0);
});

it('lets the reverted lesson be rescheduled — the flow the academy asked for', function () {
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_TEACHER'])->assertOk();

    // A reschedule refuses anything that is not SCHEDULED, so before the revert this is a dead end.
    $this->postJson("/api/sessions/{$session}/reschedule", ['scheduled_at_utc' => '2026-06-20 15:00:00+00'])
        ->assertStatus(422);

    $this->postJson("/api/sessions/{$session}/attendance/revert")->assertOk();
    $this->postJson("/api/sessions/{$session}/reschedule", ['scheduled_at_utc' => '2026-06-20 15:00:00+00'])
        ->assertStatus(201);
});

it('records the revert in the audit trail under its own action', function () {
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$session}/attendance/revert")->assertOk();

    $this->asAcademy($this->academy);
    $entry = DB::table('audit_log')
        ->where('entity_id', $session)
        ->where('action', 'session.outcome_reverted')
        ->first();

    expect($entry)->not->toBeNull();
    $before = json_decode((string) $entry->before, true);
    $after = json_decode((string) $entry->after, true);
    expect($before['status'])->toBe('ATTENDED')
        ->and($before['billed'])->toBeTrue()
        ->and($after['status'])->toBe('SCHEDULED')
        ->and($after['billing_action'])->toBe('unbilled')
        ->and($after['payroll_action'])->toBe('reversed');
});

// ── the guards ──────────────────────────────────────────────────────────────

it('refuses to un-bill a lesson whose invoice is already CLOSED, changing nothing', function () {
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoice_line_items')->where('session_id', $session)->value('invoice_id');
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance/revert")
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');

    // Atomic rollback: still ATTENDED, still billed, the line still on the closed invoice.
    $row = ($this->row)($session);
    expect($row->status)->toBe('ATTENDED')->and((bool) $row->billed)->toBeTrue();
    expect(($this->lineItems)($session))->toBe(1);
});

it('rejects a lesson that is already pending', function () {
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance/revert")
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');
});

it('rejects a MOVED lesson, whose replacement is already live', function () {
    $session = ($this->pendingSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/reschedule", ['scheduled_at_utc' => '2026-06-20 15:00:00+00'])
        ->assertStatus(201);

    $this->postJson("/api/sessions/{$session}/attendance/revert")
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');

    expect(($this->row)($session)->status)->toBe('RESCHEDULED');
});

it('forbids a TEACHER from undoing an outcome on their own lesson', function () {
    $session = ($this->pendingSession)();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_STUDENT'])->assertOk();

    // A teacher marks attendance, but undoing reverses money and would walk back the owner's own
    // cancellation decision — so the capability is not theirs.
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$session}/attendance/revert")->assertStatus(403);

    expect(($this->row)($session)->status)->toBe('CANCELLED_BY_STUDENT');
});
