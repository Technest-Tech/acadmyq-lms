<?php

declare(strict_types=1);

use App\Services\Ledger;
use App\Services\LessonPackages;
use App\Services\ModuleBilling;
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
 * lingo, 2026-11-03, the day after October's salaries were sealed. A lesson recorded on the wrong day
 * could not be undone, and the refusal still took it off its package: "why does it say 7 when 8 are
 * recorded". And a family deleted and added again left every bill behind on the dues pages.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-20 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-cac@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'currency' => 'EGP']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);

    $this->blockStudent = function (string $name, ?string $guardian = null): string {
        $id = $this->createStudent($this->academy, $guardian ?? $this->guardian, ['full_name' => $name]);
        $this->asAcademy($this->academy);
        DB::table('subscriptions')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $id,
            'plan_label' => 'Lessons', 'price_minor' => 20000, 'currency' => 'EGP',
            'price_basis' => 'PER_PACKAGE', 'sessions_per_month' => null, 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
        ]);

        return $id;
    };
    $this->block = function (string $student, int $minutes = 240, int $price = 80000): array {
        $this->asAcademy($this->academy);

        return app(LessonPackages::class)->open([
            'student_id' => $student, 'label' => 'Private', 'minutes_total' => $minutes, 'lesson_minutes' => 60,
            'price_minor' => $price, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
        ], (string) $this->owner->id, 'ACADEMY_OWNER');
    };
    $this->attend = function (string $student, string $at = '2026-06-10 10:00:00+00'): string {
        $this->asAcademy($this->academy);
        $id = $this->createSession($this->academy, $student, $this->teacher, ['scheduled_at_utc' => $at, 'duration_minutes' => 60, 'status' => 'SCHEDULED']);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $id;
    };
    /** The 3rd of July: June's statements sealed. */
    $this->sealJune = function (): void {
        $this->asAcademy($this->academy);
        app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
        Carbon::setTestNow('2026-07-03 12:00:00');
    };
    $this->juneStatement = function (): object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->where('period_year', 2026)->where('period_month', 6)->first();
    };
    $this->julyStatement = function (): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->where('period_year', 2026)->where('period_month', 7)->first();
    };
    $this->recalcOwed = function (): int {
        $this->asAcademy($this->academy);

        return app(Payroll::class)->repriceQuote(($this->juneStatement)(), DB::table('teachers')->where('id', $this->teacher)->first())['delta_minor'];
    };
});

afterEach(fn () => Carbon::setTestNow());

function cacCentreOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['centre', 'accounting']);
        app(Ledger::class)->ensureReady($academyId);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

it('leaves everything as it was when an undo is refused: the lesson stays on its package', function () {
    $student = ($this->blockStudent)('Saleem');
    $opened = ($this->block)($student);
    $lesson = ($this->attend)($student);
    ($this->sealJune)();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertStatus(422);

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $lesson)->value('status'))->toBe('ATTENDED')
        ->and(DB::table('lesson_package_credits')->where('session_id', $lesson)->count())->toBe(1)
        ->and((int) DB::table('lesson_packages')->where('id', $opened['package_id'])->value('minutes_consumed'))->toBe(60);
});

it('undoes a sealed lesson in a centre: the paid statement stays, the pay comes off the open one', function () {
    cacCentreOn($this->academy);
    $student = ($this->blockStudent)('Saleem');
    $opened = ($this->block)($student);
    $lesson = ($this->attend)($student);
    ($this->sealJune)();
    $june = ($this->juneStatement)();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertOk()
        ->assertJsonPath('status', 'SCHEDULED')
        ->assertJsonPath('carried.amount_minor', 5000)
        ->assertJsonPath('carried.currency', 'EGP');

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $lesson)->value('status'))->toBe('SCHEDULED')
        ->and(DB::table('lesson_package_credits')->where('session_id', $lesson)->count())->toBe(0)
        ->and((int) DB::table('lesson_packages')->where('id', $opened['package_id'])->value('minutes_consumed'))->toBe(0);

    // What was paid is not rewritten.
    expect(DB::table('payout_line_items')->where('payout_id', $june->id)->where('session_id', $lesson)->count())->toBe(1)
        ->and((int) ($this->juneStatement)()->total_minor)->toBe((int) $june->total_minor);
    $deduction = DB::table('payout_adjustments')->where('repriced_payout_id', $june->id)->first();
    expect($deduction->type)->toBe('DEDUCTION')->and((int) $deduction->amount_minor)->toBe(5000)
        ->and($deduction->payout_id)->toBe(($this->julyStatement)()->id);
    // ...and recalculating June does not owe it a second time.
    expect(($this->recalcOwed)())->toBe(0);
});

it('pays a lesson marked again after a sealed undo once, and undoes that without a second deduction', function () {
    cacCentreOn($this->academy);
    $student = ($this->blockStudent)('Saleem');
    ($this->block)($student);
    $lesson = ($this->attend)($student);
    ($this->sealJune)();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertOk();
    $this->postJson("/api/sessions/{$lesson}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $july = ($this->julyStatement)();
    expect(DB::table('payout_line_items')->where('payout_id', $july->id)->where('session_id', $lesson)->value('amount_minor'))->toBe(5000)
        ->and(DB::table('lesson_package_credits')->where('session_id', $lesson)->count())->toBe(1)
        ->and(($this->recalcOwed)())->toBe(0);

    Sanctum::actingAs($this->owner);
    // Its pay is on the open statement now, so this is an ordinary reversal.
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertOk()->assertJsonPath('carried', null);

    $this->asAcademy($this->academy);
    expect(DB::table('payout_line_items')->where('payout_id', $july->id)->where('session_id', $lesson)->count())->toBe(0)
        ->and(DB::table('payout_adjustments')->where('payout_id', $july->id)->count())->toBe(1)
        ->and(($this->recalcOwed)())->toBe(0);
});

it('takes a deleted family\'s unpaid charges with it, keeping what was paid', function () {
    cacCentreOn($this->academy);
    $linda = ($this->blockStudent)('Linda');
    $used = ($this->block)($linda);
    ($this->attend)($linda);
    $omar = ($this->blockStudent)('Omar');
    $untouched = ($this->block)($omar, 120, 40000);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', [
        'guardian_id' => $this->guardian, 'amount_minor' => 30000, 'currency' => 'EGP', 'method' => 'CASH',
        'received_on' => '2026-06-15', 'invoice_id' => $used['invoice_id'],
    ])->assertCreated();

    // Said before the button: 800 − 300 + 400 still unpaid.
    $this->getJson("/api/guardians/{$this->guardian}/removal-dues")->assertOk()
        ->assertJsonPath('dues.0.amount_minor', 90000)->assertJsonPath('dues.0.currency', 'EGP');

    $this->deleteJson("/api/guardians/{$this->guardian}", ['with_children' => true])->assertOk();

    $this->asAcademy($this->academy);
    $bill = DB::table('invoices')->where('id', $used['invoice_id'])->first();
    $line = DB::table('invoice_line_items')->where('invoice_id', $used['invoice_id'])->first();
    expect((int) $bill->total_minor)->toBe(30000)->and((int) $bill->amount_paid_minor)->toBe(30000)
        ->and((int) $line->amount_minor)->toBe(30000)->and((int) $line->cancelled_minor)->toBe(50000)
        ->and(DB::table('invoices')->where('id', $untouched['invoice_id'])->value('status'))->toBe('VOID');
    expect(app(Ledger::class)->balance($this->academy, ['guardian_id' => $this->guardian])[0]['due_minor'] ?? 0)->toBe(0);

    Sanctum::actingAs($this->owner);
    expect($this->getJson('/api/packages?scope=due')->assertOk()->json('packages'))->toBe([]);
});

it('takes one deleted child\'s charges and leaves the sibling\'s', function () {
    cacCentreOn($this->academy);
    $linda = ($this->blockStudent)('Linda');
    $hers = ($this->block)($linda);
    ($this->attend)($linda);
    $omar = ($this->blockStudent)('Omar');
    $his = ($this->block)($omar);
    ($this->attend)($omar, '2026-06-11 10:00:00+00');

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/students/{$linda}")->assertOk();

    $this->asAcademy($this->academy);
    expect((int) DB::table('invoices')->where('id', $hers['invoice_id'])->value('total_minor'))->toBe(0)
        ->and((int) DB::table('invoices')->where('id', $his['invoice_id'])->value('total_minor'))->toBe(80000);
});

it('leaves a deleted family\'s bills alone in an academy that is not a centre', function () {
    $linda = ($this->blockStudent)('Linda');
    $opened = ($this->block)($linda);
    ($this->attend)($linda);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/guardians/{$this->guardian}/removal-dues")->assertOk()->assertJsonPath('dues', []);
    $this->deleteJson("/api/guardians/{$this->guardian}", ['with_children' => true])->assertOk();

    $this->asAcademy($this->academy);
    expect((int) DB::table('invoices')->where('id', $opened['invoice_id'])->value('total_minor'))->toBe(80000);
});

it('clears what a family deleted before this left behind', function () {
    cacCentreOn($this->academy);
    $linda = ($this->blockStudent)('Linda');
    $opened = ($this->block)($linda);
    ($this->attend)($linda);
    // Deleted the old way: the row goes, the bill stays.
    $this->asAcademy($this->academy);
    DB::table('students')->where('id', $linda)->update(['deleted_at' => now()]);

    $this->artisan('subscriptions:clear-deleted-dues', ['--academy' => $this->academy])->assertSuccessful();
    $this->asAcademy($this->academy);
    expect((int) DB::table('invoices')->where('id', $opened['invoice_id'])->value('total_minor'))->toBe(80000);

    $this->artisan('subscriptions:clear-deleted-dues', ['--academy' => $this->academy, '--apply' => true])->assertSuccessful();
    $this->asAcademy($this->academy);
    expect((int) DB::table('invoices')->where('id', $opened['invoice_id'])->value('total_minor'))->toBe(0);
});

it('puts back a lesson a refused undo took off its package, but not one taken off by hand', function () {
    cacCentreOn($this->academy);
    $saleem = ($this->blockStudent)('Saleem');
    $opened = ($this->block)($saleem);
    $halfUndone = ($this->attend)($saleem);
    $byHand = ($this->attend)($saleem, '2026-06-11 10:00:00+00');

    // What the bug left: the package gave the minutes back, and the lesson stayed attended.
    $this->asAcademy($this->academy);
    app(LessonPackages::class)->release(DB::table('sessions')->where('id', $halfUndone)->first());
    $credit = DB::table('lesson_package_credits')->where('session_id', $byHand)->value('id');
    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/packages/{$opened['package_id']}/lessons/{$credit}", ['rebill' => false])->assertOk();

    $this->artisan('lessons:restore-half-undone', ['--academy' => $this->academy])->assertSuccessful();
    $this->asAcademy($this->academy);
    expect(DB::table('lesson_package_credits')->where('session_id', $halfUndone)->count())->toBe(0);

    $this->artisan('lessons:restore-half-undone', ['--academy' => $this->academy, '--apply' => true])->assertSuccessful();
    $this->asAcademy($this->academy);
    expect(DB::table('lesson_package_credits')->where('session_id', $halfUndone)->count())->toBe(1)
        ->and(DB::table('lesson_package_credits')->where('session_id', $byHand)->count())->toBe(0)
        ->and((int) DB::table('lesson_packages')->where('id', $opened['package_id'])->value('minutes_consumed'))->toBe(60);
});
