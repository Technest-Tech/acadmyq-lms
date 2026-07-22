<?php

declare(strict_types=1);

use App\Jobs\AutoDeductUnreportedSessionsJob;
use Database\Seeders\DemoAcademySeeder;
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
// The hourly sweep docks a teacher who never marked a delivered lesson. It runs with nobody
// watching, so the properties that matter most are the ones that stop it doing damage: it is off
// unless switched on, it never docks twice for one lesson, and it never touches sealed pay.

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // The waive/settings endpoints ride payroll's plan gate (entitled:payroll), so the academy
    // needs a plan that includes it — PRO carries the full catalog. Same shape as TrialsTest.
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone'         => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id'          => $proPlan,
    ]);

    $this->owner       = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-auto@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-auto@test.local']);
    $this->teacher     = $this->createTeacher($this->academy, [
        'user_id'            => $this->teacherUser->id,
        'session_rate_minor' => 6000,   // 6000/hr
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

    /** Turn the policy on for this academy. */
    $this->enablePolicy = function (array $overrides = []): void {
        $this->asAcademy($this->academy);
        DB::table('teacher_quality_settings')->updateOrInsert(
            ['academy_id' => $this->academy],
            array_merge([
                'id'                       => (string) Str::uuid(),
                'auto_deduct_enabled'      => true,
                'auto_deduct_grace_hours'  => 6,
                'auto_deduct_basis'        => 'FIXED',
                'auto_deduct_amount_minor' => 2000,
                'auto_deduct_bp'           => 0,
                'updated_at'               => now(),
            ], $overrides),
        );
    };

    /** A lesson that ended 8h ago and was never reported. */
    $this->unmarkedSession = function (): string {
        $this->clearTenantContext();

        return $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => now()->subHours(9)->format('Y-m-d H:i:sP'),
            'duration_minutes' => 60,
            'status'           => 'SCHEDULED',
        ]);
    };

    $this->autoRows = function (): Illuminate\Support\Collection {
        $this->asAcademy($this->academy);

        return DB::table('payout_adjustments')->where('source', 'AUTO_UNREPORTED')->get();
    };

    $this->payout = function (): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ─── The policy switch ────────────────────────────────────────────────────────

it('does nothing at all while the policy is off', function () {
    ($this->unmarkedSession)();

    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    expect(($this->autoRows)())->toHaveCount(0);
});

it('does nothing when the policy is on but has no amount configured', function () {
    ($this->unmarkedSession)();
    ($this->enablePolicy)(['auto_deduct_amount_minor' => 0]);

    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    // An "on" switch that silently docks 0 would be worse than an off one.
    expect(($this->autoRows)())->toHaveCount(0);
});

// ─── The core behaviour ───────────────────────────────────────────────────────

it('docks a flat amount for a lesson still unmarked past the grace window', function () {
    $sessionId = ($this->unmarkedSession)();
    ($this->enablePolicy)();

    $docked = (new AutoDeductUnreportedSessionsJob($this->academy))->handle();
    expect($docked[$this->academy])->toBe(1);

    $rows = ($this->autoRows)();
    expect($rows)->toHaveCount(1);

    $row = $rows->first();
    expect($row->type)->toBe('DEDUCTION')
        ->and((int) $row->amount_minor)->toBe(2000)
        ->and((string) $row->session_id)->toBe($sessionId)
        ->and($row->currency)->toBe('EGP')
        ->and($row->created_by)->toBeNull()             // the system, not a human
        ->and($row->reason)->toContain('grace period')
        ->and($row->details)->toContain('unmarked');

    // The statement did not exist before this — an unmarked lesson accrues nothing, so the
    // sweep had to open it to have somewhere to put the deduction.
    $payout = ($this->payout)();
    expect($payout)->not->toBeNull()
        ->and((int) $payout->deductions_minor)->toBe(2000)
        ->and((int) $payout->total_minor)->toBe(-2000);  // owed back: no pay, one penalty
});

it('prices PERCENT_SESSION off what the lesson would have paid', function () {
    ($this->unmarkedSession)();
    ($this->enablePolicy)(['auto_deduct_basis' => 'PERCENT_SESSION', 'auto_deduct_bp' => 5000]);  // 50%

    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    // The lesson has no payout line — never being marked is the whole point — so the percent
    // bites into rate × duration: 50% of (6000/hr × 60min) = 3000.
    expect((int) ($this->autoRows)()->first()->amount_minor)->toBe(3000);
});

it('leaves a lesson alone until the grace window has actually passed', function () {
    $this->clearTenantContext();
    // Ended 2h ago; the policy allows 6h.
    $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => now()->subHours(3)->format('Y-m-d H:i:sP'),
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    ($this->enablePolicy)();

    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    expect(($this->autoRows)())->toHaveCount(0);
});

it('leaves a reported lesson alone — the teacher did the thing', function () {
    $sessionId = ($this->unmarkedSession)();
    ($this->enablePolicy)();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->putJson("/api/sessions/{$sessionId}/report", ['values' => ['notes' => 'Went well']])->assertOk();

    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    expect(($this->autoRows)())->toHaveCount(0);
});

it('ignores a cancelled lesson — there was nothing to mark', function () {
    $this->clearTenantContext();
    $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => now()->subHours(9)->format('Y-m-d H:i:sP'),
        'duration_minutes' => 60,
        'status'           => 'CANCELLED_BY_STUDENT',
    ]);
    ($this->enablePolicy)();

    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    expect(($this->autoRows)())->toHaveCount(0);
});

// ─── Idempotency: the property that makes an hourly job safe ──────────────────

it('never docks the same lesson twice, however often the sweep runs', function () {
    ($this->unmarkedSession)();
    ($this->enablePolicy)();

    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();
    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();
    $third = (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    expect($third[$this->academy])->toBe(0);
    expect(($this->autoRows)())->toHaveCount(1);
    expect((int) ($this->payout)()->deductions_minor)->toBe(2000);   // not 6000
});

// ─── Never touch sealed pay ───────────────────────────────────────────────────

it('skips a lesson whose month is already finalized instead of throwing', function () {
    $sessionId = ($this->unmarkedSession)();

    // Give the teacher some pay in the period, then seal it.
    $this->clearTenantContext();
    $paid = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => now()->subDays(1)->format('Y-m-d H:i:sP'),
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$paid}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson('/api/payouts/finalize', ['year' => 2026, 'month' => 6])->assertOk();

    ($this->enablePolicy)();

    // The DB trigger would reject the insert outright; the job must filter, not crash.
    $docked = (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    expect($docked[$this->academy])->toBe(0);
    expect(($this->autoRows)())->toHaveCount(0);

    $payout = ($this->payout)();
    expect((int) $payout->total_minor)->toBe(6000)   // untouched
        ->and($payout->finalized_at)->not->toBeNull();
    expect($sessionId)->not->toBeNull();
});

// ─── The waive path ───────────────────────────────────────────────────────────

it('refuses to delete an automatic deduction and waives it with a matching award instead', function () {
    ($this->unmarkedSession)();
    ($this->enablePolicy)();
    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    $auto = ($this->autoRows)()->first();
    Sanctum::actingAs($this->owner);

    // Deleting would be futile — the next sweep writes it straight back.
    $this->deleteJson("/api/quality/adjustments/{$auto->id}")->assertStatus(422);

    $this->postJson("/api/quality/adjustments/{$auto->id}/waive", [
        'reason' => 'Power cut at the academy',
    ])->assertCreated();

    // Both sides stay on the record and the statement nets to zero.
    $payout = ($this->payout)();
    expect((int) $payout->deductions_minor)->toBe(2000)
        ->and((int) $payout->rewards_minor)->toBe(2000)
        ->and((int) $payout->total_minor)->toBe(0);

    // A second waive must not pay the teacher twice.
    $this->postJson("/api/quality/adjustments/{$auto->id}/waive", ['reason' => 'Again'])
        ->assertStatus(422);

    // And the deduction survives the next sweep, still un-stacked.
    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();
    expect(($this->autoRows)())->toHaveCount(1);
});

// ─── Teacher visibility ───────────────────────────────────────────────────────

it('shows the teacher their own automatic deduction with its reason', function () {
    ($this->unmarkedSession)();
    ($this->enablePolicy)();
    (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    Sanctum::actingAs($this->teacherUser);
    $rows = $this->getJson('/api/me/adjustments')->assertOk()->json('rows');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['source'])->toBe('AUTO_UNREPORTED')
        ->and($rows[0]['type'])->toBe('DEDUCTION')
        ->and($rows[0]['amount_minor'])->toBe(2000)
        // The lesson's local date — the UI states the reason in the reader's language and
        // needs the date, not a parsed English string.
        ->and($rows[0]['session_local'])->not->toBeNull();
});
