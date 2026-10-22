<?php

declare(strict_types=1);

use App\Services\Invoicing;
use App\Services\Payroll;
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
 * A lesson marked AFTER its month was closed (Alrayan, 2026-10-22: a 17 Sept lesson marked in
 * October). The month's salary statement was finalized on the 3rd and its bill closed on the 2nd;
 * both refuse a new line at the DB, and the mark used to die there as a 500 — leaving the lesson
 * pending forever. Now the teacher's pay lands on the next open statement and the charge on the
 * payer's next open bill, each line keeping the lesson's own date; the closed documents stay as
 * they were paid.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-20 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-late@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'currency' => 'EGP']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->subscribe = function (string $basis, int $priceMinor, ?int $perMonth = null): void {
        $this->asAcademy($this->academy);
        DB::table('subscriptions')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academy,
            'student_id' => $this->student,
            'plan_label' => 'Test',
            'price_minor' => $priceMinor,
            'currency' => 'EGP',
            'price_basis' => $basis,
            'sessions_per_month' => $perMonth,
            'status' => 'ACTIVE',
            'start_date' => '2026-01-01',
        ]);
    };
    $this->lesson = fn (string $at): string => $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => $at, 'duration_minutes' => 60, 'status' => 'SCHEDULED',
    ]);
    $this->attend = function (string $sessionId) {
        Sanctum::actingAs($this->owner);

        return $this->postJson("/api/sessions/{$sessionId}/attendance", ['status' => 'ATTENDED']);
    };
    // June's statement finalized on the 3rd and its bills closed on the 2nd, as the jobs do.
    $this->closeJune = function (): void {
        $this->asAcademy($this->academy);
        app(Invoicing::class)->closePeriodInvoices($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
        app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
        Carbon::setTestNow('2026-07-05 12:00:00');
    };
    $this->payout = function (int $month): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->where('period_year', 2026)->where('period_month', $month)->first();
    };
    $this->invoice = function (int $month): ?object {
        $this->asAcademy($this->academy);

        return DB::table('invoices')->where('guardian_id', $this->guardian)->where('kind', 'AUTO')->where('period_year', 2026)->where('period_month', $month)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

it('pays a lesson marked after its month was finalized on the next open statement', function () {
    ($this->attend)(($this->lesson)('2026-06-10 10:00:00+00'))->assertOk();
    $late = ($this->lesson)('2026-06-17 10:00:00+00');
    ($this->closeJune)();

    ($this->attend)($late)->assertOk();

    $june = ($this->payout)(6);
    $july = ($this->payout)(7);
    expect($june->finalized_at)->not->toBeNull()
        ->and((int) $june->total_minor)->toBe(5000)   // the paid statement is untouched
        ->and($july->finalized_at)->toBeNull()
        ->and((int) $july->total_minor)->toBe(5000);

    $this->asAcademy($this->academy);
    $line = DB::table('payout_line_items')->where('session_id', $late)->first();
    expect($line->payout_id)->toBe($july->id)
        ->and(Carbon::parse($line->session_date)->toDateString())->toBe('2026-06-17');

    $row = DB::table('sessions')->where('id', $late)->first();
    expect($row->status)->toBe('ATTENDED')->and((bool) $row->paid_to_teacher)->toBeTrue();

    $audit = DB::table('audit_log')->where('action', 'payout.line_accrued')->where('entity_id', $july->id)->first();
    expect(json_decode($audit->after, true)['carried_from'])->toBe('2026-06');
});

it('charges a lesson marked after its month\'s bill closed on the payer\'s next open bill', function () {
    ($this->subscribe)('PER_SESSION', 10000);
    ($this->attend)(($this->lesson)('2026-06-10 10:00:00+00'))->assertOk();
    $late = ($this->lesson)('2026-06-17 10:00:00+00');
    ($this->closeJune)();

    ($this->attend)($late)->assertOk();

    expect(($this->invoice)(6)->status)->toBe('CLOSED')
        ->and((int) ($this->invoice)(6)->total_minor)->toBe(10000)
        ->and(($this->invoice)(7)->status)->toBe('OPEN')
        ->and((int) ($this->invoice)(7)->total_minor)->toBe(10000);

    $this->asAcademy($this->academy);
    $line = DB::table('invoice_line_items')->where('session_id', $late)->first();
    expect($line->invoice_id)->toBe(($this->invoice)(7)->id)
        ->and(Carbon::parse($line->session_date)->toDateString())->toBe('2026-06-17');
});

it('prices a late PER_MONTH lesson against its own month, not the bill it rides on', function () {
    // 2 lessons a month for 10 000: each fills one slot of 5 000, and a third is already paid for.
    ($this->subscribe)('PER_MONTH', 10000, 2);
    ($this->attend)(($this->lesson)('2026-06-10 10:00:00+00'))->assertOk();
    $lateA = ($this->lesson)('2026-06-17 10:00:00+00');
    $lateB = ($this->lesson)('2026-06-24 10:00:00+00');
    $july = ($this->lesson)('2026-07-02 10:00:00+00');
    ($this->closeJune)();

    ($this->attend)($lateA)->assertOk();   // June's second slot → the 5 000 June still owed
    ($this->attend)($july)->assertOk();    // July's FIRST slot, however many June lines ride July's bill
    ($this->attend)($lateB)->assertOk();   // June is fully charged → 0

    $this->asAcademy($this->academy);
    $amount = fn (string $id): int => (int) DB::table('invoice_line_items')->where('session_id', $id)->value('amount_minor');
    expect($amount($lateA))->toBe(5000)
        ->and($amount($july))->toBe(5000)
        ->and($amount($lateB))->toBe(0)
        ->and((int) ($this->invoice)(7)->total_minor)->toBe(10000);
});

it('still takes a carried lesson back while the statement it rides on is open', function () {
    $late = ($this->lesson)('2026-06-17 10:00:00+00');
    ($this->attend)(($this->lesson)('2026-06-10 10:00:00+00'))->assertOk();
    ($this->closeJune)();
    ($this->attend)($late)->assertOk();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$late}/attendance", ['status' => 'CANCELLED_BY_STUDENT'])->assertOk();

    expect((int) ($this->payout)(7)->total_minor)->toBe(0)
        ->and((int) ($this->payout)(6)->total_minor)->toBe(5000);
});
