<?php

declare(strict_types=1);

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

/**
 * A free-trial lesson is free for everyone: the student is never charged (the academy absorbs it)
 * AND the teacher accrues nothing (it's unpaid demo time). The trial flag lives on the session
 * REPORT (`is_free_trial`), and the UI records attendance BEFORE saving that report — so the
 * invoice/payout lines are created at the full rate first and must be re-priced to zero when the
 * report lands. These tests pin both orderings and the un-flag (FREE → ATTENDED) restore.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-trial@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy);

    // A 60-min session so the payout is the full hourly rate (6000) and the maths is obvious.
    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED',
    ]);

    // PER_SESSION subscription so an ordinary ATTENDED session would bill the student 10 000.
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Trial plan',
        'price_minor' => 10000,
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'sessions_per_month' => null,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    $this->invoiceAmount = function (): ?int {
        $this->asAcademy($this->academy);
        $v = DB::table('invoice_line_items')->where('session_id', $this->session)->value('amount_minor');

        return $v === null ? null : (int) $v;
    };
    $this->payoutAmount = function (): ?int {
        $this->asAcademy($this->academy);
        $v = DB::table('payout_line_items')->where('session_id', $this->session)->value('amount_minor');

        return $v === null ? null : (int) $v;
    };
    $this->invoiceTotal = function (): int {
        $this->asAcademy($this->academy);
        $invId = DB::table('invoice_line_items')->where('session_id', $this->session)->value('invoice_id');

        return (int) DB::table('invoices')->where('id', $invId)->value('total_minor');
    };
});

afterEach(fn () => Carbon::setTestNow());

it('zeroes both invoice and payout when the trial flag is saved BEFORE attendance', function () {
    Sanctum::actingAs($this->owner);

    // Report (with the trial flag) lands first, then attendance fires the hooks.
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['is_free_trial' => true]])->assertOk();
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    expect(($this->invoiceAmount)())->toBe(0)
        ->and(($this->payoutAmount)())->toBe(0)
        ->and(($this->invoiceTotal)())->toBe(0);
});

it('re-prices both documents to zero when the trial flag arrives AFTER attendance (UI order)', function () {
    Sanctum::actingAs($this->owner);

    // The real UI order: attendance first (full price), then the report carrying the trial flag.
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->invoiceAmount)())->toBe(10000)
        ->and(($this->payoutAmount)())->toBe(6000);

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['is_free_trial' => true]])->assertOk();

    expect(($this->invoiceAmount)())->toBe(0)
        ->and(($this->payoutAmount)())->toBe(0)
        ->and(($this->invoiceTotal)())->toBe(0);
});

it('restores the real price when a trial is un-flagged (FREE → ATTENDED)', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['is_free_trial' => true]])->assertOk();
    expect(($this->invoiceAmount)())->toBe(0)->and(($this->payoutAmount)())->toBe(0);

    // Switching back to a normal attended lesson re-bills the student and re-pays the teacher.
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['is_free_trial' => false]])->assertOk();

    expect(($this->invoiceAmount)())->toBe(10000)
        ->and(($this->payoutAmount)())->toBe(6000)
        ->and(($this->invoiceTotal)())->toBe(10000);
});

it('leaves a non-attended session untouched when only the report is saved', function () {
    Sanctum::actingAs($this->owner);

    // No attendance recorded yet → no lines exist; saving the trial flag must not create any.
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['is_free_trial' => true]])->assertOk();

    expect(($this->invoiceAmount)())->toBeNull()
        ->and(($this->payoutAmount)())->toBeNull();
});
