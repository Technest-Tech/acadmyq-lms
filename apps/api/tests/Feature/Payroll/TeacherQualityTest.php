<?php

declare(strict_types=1);

use App\Services\Payroll;
use App\Services\TeacherQuality;
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
// A quality report stores a PERCENT; the money is a DERIVED payout_adjustments row (source=QUALITY)
// the service recomputes while the statement is OPEN. These tests pin that indirection down: the
// derived amount must track a moving monthly gross, must vanish when there is nothing to bite into,
// and must freeze the moment the statement is finalized.

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // Quality + Discounts & Awards ride payroll's plan gate (entitled:payroll), so the academy
    // needs a plan that includes it — PRO carries the full catalog. Same shape as TrialsTest.
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone'         => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id'          => $proPlan,
    ]);

    $this->owner       = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-q@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-q@test.local']);
    $this->teacher     = $this->createTeacher($this->academy, [
        'user_id'            => $this->teacherUser->id,
        'session_rate_minor' => 5000,   // 5000/hr
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

    // A rubric: one category, two criteria worth 10% and 25%.
    $this->category = (string) Str::uuid();
    DB::table('teacher_quality_categories')->insert([
        'id'         => $this->category,
        'academy_id' => $this->academy,
        'name'       => 'Punctuality',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $this->crit10 = (string) Str::uuid();
    $this->crit25 = (string) Str::uuid();
    // Seeded straight into the table, so these are basis points: 10% = 1000, 25% = 2500.
    foreach ([[$this->crit10, 'Started on time', 1000], [$this->crit25, 'Stayed the full hour', 2500]] as [$id, $name, $bp]) {
        DB::table('teacher_quality_criteria')->insert([
            'id'               => $id,
            'academy_id'       => $this->academy,
            'category_id'      => $this->category,
            'name'             => $name,
            'discount_bp'      => $bp,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    /** Accrue one ATTENDED 60-min session → 5000 on the teacher's OPEN payout. */
    $this->attendSession = function (string $atUtc = '2026-06-01 10:00:00+00'): string {
        $this->clearTenantContext();
        $sessionId = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => $atUtc,
            'duration_minutes' => 60,
            'status'           => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $sessionId;
    };

    $this->payout = function (): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->first();
    };

    $this->qualityAdjustment = function (): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payout_adjustments')->where('source', 'QUALITY')->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ─── SESSION scope ────────────────────────────────────────────────────────────

it('docks a SESSION report against that lesson\'s own pay, not the month', function () {
    $sessionId = ($this->attendSession)();
    ($this->attendSession)('2026-06-02 10:00:00+00');   // a second lesson: month gross is now 10000

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id' => $this->teacher,
        'scope'      => 'SESSION',
        'session_id' => $sessionId,
        'items'      => [
            ['criterion_id' => $this->crit10, 'met' => false],
            ['criterion_id' => $this->crit25, 'met' => true],
        ],
    ])->assertCreated();

    // 10% of THAT lesson (5000) = 500 — not 10% of the 10000 month.
    $adj = ($this->qualityAdjustment)();
    expect($adj)->not->toBeNull()
        ->and((int) $adj->amount_minor)->toBe(500)
        ->and($adj->type)->toBe('DEDUCTION')
        ->and($adj->currency)->toBe('EGP');

    $payout = ($this->payout)();
    expect((int) $payout->total_minor)->toBe(9500)          // 10000 − 500
        ->and((int) $payout->deductions_minor)->toBe(500);
});

it('sums only the BREACHED criteria and leaves a clean report costing nothing', function () {
    $sessionId = ($this->attendSession)();

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id' => $this->teacher,
        'scope'      => 'SESSION',
        'session_id' => $sessionId,
        'items'      => [
            ['criterion_id' => $this->crit10, 'met' => true],
            ['criterion_id' => $this->crit25, 'met' => true],
        ],
    ])->assertCreated();

    // Everything met → 0% → no adjustment row at all (amount_minor > 0 is a CHECK).
    expect(($this->qualityAdjustment)())->toBeNull();
    expect((int) ($this->payout)()->total_minor)->toBe(5000);

    $this->asAcademy($this->academy);
    expect((int) DB::table('teacher_quality_reports')->value('total_bp'))->toBe(0);
});

it('rejects a second report on the same lesson — a lesson is judged once', function () {
    $sessionId = ($this->attendSession)();
    Sanctum::actingAs($this->owner);

    $payload = [
        'teacher_id' => $this->teacher,
        'scope'      => 'SESSION',
        'session_id' => $sessionId,
        'items'      => [['criterion_id' => $this->crit10, 'met' => false]],
    ];

    $this->postJson('/api/quality/reports', $payload)->assertCreated();

    // A clean 422 naming the actual problem — not the raw 23505 the unique index would raise.
    $this->postJson('/api/quality/reports', $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('session_id');

    // And exactly one report survives: the second attempt changed nothing.
    $this->asAcademy($this->academy);
    expect(DB::table('teacher_quality_reports')->count())->toBe(1)
        ->and(DB::table('payout_adjustments')->where('source', 'QUALITY')->count())->toBe(1);
});

it('rejects a SESSION report on a lesson another teacher delivered', function () {
    $sessionId = ($this->attendSession)();

    $this->clearTenantContext();
    $other = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'currency' => 'EGP']);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id' => $other,
        'scope'      => 'SESSION',
        'session_id' => $sessionId,
        'items'      => [['criterion_id' => $this->crit10, 'met' => false]],
    ])->assertStatus(422);
});

// ─── MONTHLY scope: the derived amount must TRACK the growing gross ───────────

it('recomputes a MONTHLY report as the month accrues — the percent follows the total', function () {
    ($this->attendSession)('2026-06-01 10:00:00+00');   // gross 5000

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id'   => $this->teacher,
        'scope'        => 'MONTHLY',
        'period_year'  => 2026,
        'period_month' => 6,
        'items'        => [['criterion_id' => $this->crit10, 'met' => false]],   // 10%
    ])->assertCreated();

    // 10% of 5000
    expect((int) ($this->qualityAdjustment)()->amount_minor)->toBe(500);
    expect((int) ($this->payout)()->total_minor)->toBe(4500);

    // A second lesson lands — the SAME report must now cost more, because it docks a percent of
    // the month's total and the month grew. This is the whole reason the amount is derived.
    ($this->attendSession)('2026-06-02 10:00:00+00');   // gross 10000

    expect((int) ($this->qualityAdjustment)()->amount_minor)->toBe(1000);   // 10% of 10000
    expect((int) ($this->payout)()->total_minor)->toBe(9000)                // 10000 − 1000
        ->and((int) ($this->payout)()->deductions_minor)->toBe(1000);
});

it('caps a report at 100% so no verdict can cost more than the pay it bites into', function () {
    ($this->attendSession)();

    // Breach both (10 + 25 = 35), plus a 90% criterion → 125% raw, capped to 100.
    $crit90 = (string) Str::uuid();
    $this->asAcademy($this->academy);
    DB::table('teacher_quality_criteria')->insert([
        'id'               => $crit90,
        'academy_id'       => $this->academy,
        'category_id'      => $this->category,
        'name'             => 'Catastrophe',
        'discount_bp'      => 9000,
        'created_at'       => now(),
        'updated_at'       => now(),
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id'   => $this->teacher,
        'scope'        => 'MONTHLY',
        'period_year'  => 2026,
        'period_month' => 6,
        'items'        => [
            ['criterion_id' => $this->crit10, 'met' => false],
            ['criterion_id' => $this->crit25, 'met' => false],
            ['criterion_id' => $crit90, 'met' => false],
        ],
    ])->assertCreated();

    $this->asAcademy($this->academy);
    expect((int) DB::table('teacher_quality_reports')->value('total_bp'))->toBe(10000);
    expect((int) ($this->qualityAdjustment)()->amount_minor)->toBe(5000);   // 100% of 5000
    expect((int) ($this->payout)()->total_minor)->toBe(0);                  // never negative from a cap
});

it('creates no deduction while the teacher has no pay to dock, then materializes it once they earn', function () {
    // No sessions yet. The report still records the verdict; there is simply nothing to take.
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id'   => $this->teacher,
        'scope'        => 'MONTHLY',
        'period_year'  => 2026,
        'period_month' => 6,
        'items'        => [['criterion_id' => $this->crit25, 'met' => false]],   // 25%
    ])->assertCreated();

    expect(($this->qualityAdjustment)())->toBeNull();
    expect((int) ($this->payout)()->total_minor)->toBe(0);

    // They teach — the deduction appears by itself.
    ($this->attendSession)();

    expect((int) ($this->qualityAdjustment)()->amount_minor)->toBe(1250);   // 25% of 5000
    expect((int) ($this->payout)()->total_minor)->toBe(3750);
});

// ─── Snapshots + withdrawal ───────────────────────────────────────────────────

it('snapshots the rubric so re-pricing a criterion never restates a past report', function () {
    $sessionId = ($this->attendSession)();

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id' => $this->teacher,
        'scope'      => 'SESSION',
        'session_id' => $sessionId,
        'items'      => [['criterion_id' => $this->crit10, 'met' => false]],
    ])->assertCreated();

    // Re-price 10% → 80% and rename it.
    $this->patchJson("/api/quality/rubric/criteria/{$this->crit10}", [
        'name'             => 'Renamed entirely',
        'discount_percent' => 80,
    ])->assertOk();

    $this->asAcademy($this->academy);
    $item = DB::table('teacher_quality_report_items')->first();
    expect((int) $item->discount_bp)->toBe(1000)                    // the percent it was judged by
        ->and($item->criterion_name)->toBe('Started on time');      // the wording it was judged by
    expect((int) DB::table('teacher_quality_reports')->value('total_bp'))->toBe(1000);
    expect((int) ($this->qualityAdjustment)()->amount_minor)->toBe(500);
});

it('withdrawing a report cascades the deduction away and restates the total', function () {
    $sessionId = ($this->attendSession)();

    Sanctum::actingAs($this->owner);
    $res = $this->postJson('/api/quality/reports', [
        'teacher_id' => $this->teacher,
        'scope'      => 'SESSION',
        'session_id' => $sessionId,
        'items'      => [['criterion_id' => $this->crit25, 'met' => false]],
    ])->assertCreated();

    expect((int) ($this->payout)()->total_minor)->toBe(3750);   // 5000 − 25%

    $this->deleteJson("/api/quality/reports/{$res->json('reportId')}")->assertOk();

    expect(($this->qualityAdjustment)())->toBeNull();
    $payout = ($this->payout)();
    expect((int) $payout->total_minor)->toBe(5000)
        ->and((int) $payout->deductions_minor)->toBe(0);
});

// ─── Immutability ─────────────────────────────────────────────────────────────

it('refuses a report against an already-finalized month', function () {
    ($this->attendSession)();

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/payouts/finalize', ['year' => 2026, 'month' => 6])->assertOk();

    $this->postJson('/api/quality/reports', [
        'teacher_id'   => $this->teacher,
        'scope'        => 'MONTHLY',
        'period_year'  => 2026,
        'period_month' => 6,
        'items'        => [['criterion_id' => $this->crit10, 'met' => false]],
    ])->assertStatus(422);
});

it('freezes the derived amount at finalize — a later lesson cannot move sealed pay', function () {
    ($this->attendSession)('2026-06-01 10:00:00+00');   // gross 5000

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id'   => $this->teacher,
        'scope'        => 'MONTHLY',
        'period_year'  => 2026,
        'period_month' => 6,
        'items'        => [['criterion_id' => $this->crit10, 'met' => false]],
    ])->assertCreated();

    $this->postJson('/api/payouts/finalize', ['year' => 2026, 'month' => 6])->assertOk();

    $sealed = ($this->payout)();
    expect($sealed->finalized_at)->not->toBeNull()
        ->and((int) $sealed->total_minor)->toBe(4500)
        ->and((int) ($this->qualityAdjustment)()->amount_minor)->toBe(500);

    // syncPayout must be a no-op on a sealed statement rather than throwing at the trigger.
    app(TeacherQuality::class)->syncPayout((string) $sealed->id);

    $after = ($this->payout)();
    expect((int) $after->total_minor)->toBe(4500)
        ->and((int) ($this->qualityAdjustment)()->amount_minor)->toBe(500);
});

it('keeps finalize\'s integrity guard honest — the quality refresh must not repair drift', function () {
    ($this->attendSession)();

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/quality/reports', [
        'teacher_id'   => $this->teacher,
        'scope'        => 'MONTHLY',
        'period_year'  => 2026,
        'period_month' => 6,
        'items'        => [['criterion_id' => $this->crit10, 'met' => false]],
    ])->assertCreated();

    // Corrupt the net behind the engine's back, exactly as PayrollEngineTest does.
    $payout = ($this->payout)();
    DB::table('payouts')->where('id', $payout->id)->update(['total_minor' => 999999]);

    // finalize() calls syncPayout first to settle the month's percent. That settling moves the
    // totals by a DELTA — it must never restate them from the rows, or this drift would be
    // silently repaired and AC-8.7 would pass on a broken statement.
    expect(fn () => app(Payroll::class)->finalizePayout(
        (string) $payout->id,
        $this->academy,
        (string) $this->owner->id,
        'ACADEMY_OWNER',
    ))->toThrow(RuntimeException::class);

    expect(($this->payout)()->finalized_at)->toBeNull();
});

// ─── Access control ───────────────────────────────────────────────────────────

it('lets a teacher read the reports about themselves but not a colleague\'s', function () {
    $sessionId = ($this->attendSession)();

    Sanctum::actingAs($this->owner);
    $mine = $this->postJson('/api/quality/reports', [
        'teacher_id' => $this->teacher,
        'scope'      => 'SESSION',
        'session_id' => $sessionId,
        'items'      => [['criterion_id' => $this->crit10, 'met' => false]],
    ])->assertCreated()->json('reportId');

    // A colleague's report, on a colleague's own lesson.
    $this->clearTenantContext();
    $other        = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'currency' => 'EGP']);
    $otherSession = $this->createSession($this->academy, $this->student, $other, [
        'scheduled_at_utc' => '2026-06-03 10:00:00+00',
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$otherSession}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $theirs = $this->postJson('/api/quality/reports', [
        'teacher_id' => $other,
        'scope'      => 'SESSION',
        'session_id' => $otherSession,
        'items'      => [['criterion_id' => $this->crit10, 'met' => false]],
    ])->assertCreated()->json('reportId');

    Sanctum::actingAs($this->teacherUser);

    // Own report: readable, in full.
    $this->getJson("/api/me/quality-reports/{$mine}")->assertOk()
        ->assertJsonPath('report.id', $mine);

    // The list is self-scoped — RLS pins the academy, not the person.
    $rows = $this->getJson('/api/me/quality-reports')->assertOk()->json('rows');
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['id'])->toBe($mine);

    // A colleague's report: not theirs to read.
    $this->getJson("/api/me/quality-reports/{$theirs}")->assertForbidden();

    // And the owner-facing surfaces stay shut.
    $this->getJson('/api/quality/reports')->assertForbidden();
    $this->postJson('/api/quality/rubric/categories', ['name' => 'Nope'])->assertForbidden();
});
