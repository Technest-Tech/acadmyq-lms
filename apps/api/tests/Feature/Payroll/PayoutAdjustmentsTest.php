<?php

declare(strict_types=1);

use App\Services\Payroll;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

// ─── Shared setup ────────────────────────────────────────────────────────────
//
// Rewards & deductions sit on a teacher's payout statement alongside the per-session lines and
// shift the net total. They obey the same OPEN/finalize immutability as session lines.

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone'         => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
    ]);

    $this->owner       = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-adj@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-adj@test.local']);
    $this->teacher     = $this->createTeacher($this->academy, [
        'user_id'            => $this->teacherUser->id,
        'session_rate_minor' => 5000,
        'currency'           => 'EGP',
    ]);

    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student  = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id'                 => (string) Str::uuid(),
        'academy_id'         => $this->academy,
        'student_id'         => $this->student,
        'plan_label'         => '1:1 EGP',
        'price_minor'        => 10000,
        'currency'           => 'EGP',
        'price_basis'        => 'PER_SESSION',
        'sessions_per_month' => null,
        'status'             => 'ACTIVE',
        'start_date'         => '2026-01-01',
    ]);

    // Accrue one ATTENDED session so an OPEN payout (total 5000) exists for the teacher.
    // 60-minute session so the hourly rate (5000/hr) pays exactly 5000.
    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 10:00:00+00',
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->payout = function (): object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ─── Rewards ──────────────────────────────────────────────────────────────────

it('TC-8.22: a REWARD increases the net total and the rewards subtotal, with reason + details', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/payouts/{$payout->id}/adjustments", [
        'type' => 'REWARD',
        'amount_minor' => 2000,
        'reason' => 'Excellent student results',
        'details' => 'Three students advanced a level this month.',
    ])->assertCreated();

    $fresh = ($this->payout)();
    expect((int) $fresh->total_minor)->toBe(7000)        // 5000 sessions + 2000 reward
        ->and((int) $fresh->rewards_minor)->toBe(2000)
        ->and((int) $fresh->deductions_minor)->toBe(0);

    $this->asAcademy($this->academy);
    $adj = DB::table('payout_adjustments')->where('payout_id', $payout->id)->first();
    expect($adj->type)->toBe('REWARD')
        ->and((int) $adj->amount_minor)->toBe(2000)
        ->and($adj->currency)->toBe('EGP')              // inherits statement currency
        ->and($adj->reason)->toBe('Excellent student results')
        ->and($adj->details)->toBe('Three students advanced a level this month.');
});

it('TC-8.23: a DEDUCTION decreases the net total and increases the deductions subtotal', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/payouts/{$payout->id}/adjustments", [
        'type' => 'DEDUCTION',
        'amount_minor' => 1500,
        'reason' => 'Late cancellation penalty',
    ])->assertCreated();

    $fresh = ($this->payout)();
    expect((int) $fresh->total_minor)->toBe(3500)        // 5000 sessions − 1500 deduction
        ->and((int) $fresh->deductions_minor)->toBe(1500)
        ->and((int) $fresh->rewards_minor)->toBe(0);
});

it('TC-8.24: rewards and deductions combine into the correct net (sessions + rewards − deductions)', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 3000, 'reason' => 'Bonus'])->assertCreated();
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'DEDUCTION', 'amount_minor' => 1000, 'reason' => 'Advance'])->assertCreated();

    $fresh = ($this->payout)();
    expect((int) $fresh->total_minor)->toBe(7000)        // 5000 + 3000 − 1000
        ->and((int) $fresh->rewards_minor)->toBe(3000)
        ->and((int) $fresh->deductions_minor)->toBe(1000);
});

it('TC-8.25: removing an adjustment reverses its effect on the totals', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])->assertCreated();

    $this->asAcademy($this->academy);
    $adjId = DB::table('payout_adjustments')->where('payout_id', $payout->id)->value('id');

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/payouts/{$payout->id}/adjustments/{$adjId}")->assertOk();

    $fresh = ($this->payout)();
    expect((int) $fresh->total_minor)->toBe(5000)        // back to sessions-only
        ->and((int) $fresh->rewards_minor)->toBe(0);

    $this->asAcademy($this->academy);
    expect(DB::table('payout_adjustments')->where('payout_id', $payout->id)->count())->toBe(0);
});

it('TC-8.26: the detail endpoint returns the breakdown and the adjustments list', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus', 'details' => 'Great work'])->assertCreated();
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'DEDUCTION', 'amount_minor' => 500, 'reason' => 'Advance'])->assertCreated();

    $res = $this->getJson("/api/payouts/{$payout->id}")->assertOk();

    expect((int) $res->json('payout.sessions_minor'))->toBe(5000)
        ->and((int) $res->json('payout.rewards_minor'))->toBe(2000)
        ->and((int) $res->json('payout.deductions_minor'))->toBe(500)
        ->and((int) $res->json('payout.total_minor'))->toBe(6500)
        ->and($res->json('adjustments'))->toHaveCount(2);
});

// ─── Immutability ───────────────────────────────────────────────────────────

it('TC-8.27: adjustments are rejected once the payout is finalized (service guard)', function () {
    $payout = ($this->payout)();
    app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])
        ->assertStatus(422);

    expect((int) ($this->payout)()->total_minor)->toBe(5000);
});

it('TC-8.28: inserting an adjustment on a finalized payout is rejected by the DB trigger', function () {
    $payout = ($this->payout)();
    app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');

    $this->asAcademy($this->academy);
    expect(fn () => DB::table('payout_adjustments')->insert([
        'id'           => (string) Str::uuid(),
        'academy_id'   => $this->academy,
        'payout_id'    => $payout->id,
        'type'         => 'REWARD',
        'amount_minor' => 2000,
        'currency'     => 'EGP',
        'reason'       => 'Bonus',
    ]))->toThrow(QueryException::class);
});

it('TC-8.29: finalize integrity check accounts for adjustments (net = sessions + rewards − deductions)', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])->assertCreated();

    // total now 7000 = 5000 + 2000; finalize should succeed (integrity holds).
    app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
    expect(($this->payout)()->finalized_at)->not->toBeNull();
});

it('TC-8.30: a corrupt rewards subtotal makes the finalize integrity check fail loudly', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])->assertCreated();

    // Corrupt rewards_minor on the still-OPEN payout so net no longer reconciles.
    $this->asAcademy($this->academy);
    DB::table('payouts')->where('id', $payout->id)->update(['rewards_minor' => 9999]);

    expect(fn () => app(Payroll::class)->finalizePayout((string) $payout->id, $this->academy, $this->owner->id, 'ACADEMY_OWNER'))
        ->toThrow(RuntimeException::class);
});

// ─── Roles, validation, isolation ──────────────────────────────────────────────

it('TC-8.31: a teacher cannot add an adjustment to their own payout (403)', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])
        ->assertStatus(403);
});

it('TC-8.32: validation rejects a missing reason, a bad type, and a non-positive amount', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000])
        ->assertStatus(422)->assertJsonValidationErrors('reason');
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'GIFT', 'amount_minor' => 2000, 'reason' => 'x'])
        ->assertStatus(422)->assertJsonValidationErrors('type');
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 0, 'reason' => 'x'])
        ->assertStatus(422)->assertJsonValidationErrors('amount_minor');
});

it('TC-8.33: adjustments are RLS-isolated — academy B cannot adjust academy A\'s payout', function () {
    $payout = ($this->payout)();

    $academyB = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $ownerB = $this->makeUser($academyB, 'ACADEMY_OWNER', ['email' => 'owner-b-adj@test.local']);

    Sanctum::actingAs($ownerB);
    // B's context cannot see A's payout → the service treats it as "not found" (422), no mutation.
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])
        ->assertStatus(422);

    expect((int) ($this->payout)()->total_minor)->toBe(5000);
});

it('TC-8.34: adding and removing an adjustment each write an audit entry', function () {
    $payout = ($this->payout)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payout->id}/adjustments", ['type' => 'DEDUCTION', 'amount_minor' => 1000, 'reason' => 'Advance'])->assertCreated();

    $this->asAcademy($this->academy);
    $adjId = DB::table('payout_adjustments')->where('payout_id', $payout->id)->value('id');
    $added = DB::table('audit_log')->where('action', 'payout.adjustment_added')->where('entity_id', $payout->id)->first();
    expect($added)->not->toBeNull()
        ->and(json_decode($added->after, true)['type'])->toBe('DEDUCTION')
        ->and(json_decode($added->after, true)['amount_minor'])->toBe(1000);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/payouts/{$payout->id}/adjustments/{$adjId}")->assertOk();

    $this->asAcademy($this->academy);
    $removed = DB::table('audit_log')->where('action', 'payout.adjustment_removed')->where('entity_id', $payout->id)->first();
    expect($removed)->not->toBeNull()
        ->and(json_decode($removed->before, true)['amount_minor'])->toBe(1000);
});
