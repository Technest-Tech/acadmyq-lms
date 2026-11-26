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
    /** The June statement paid out of the treasury: the one a correction does not rewrite. */
    $this->paidFromTreasury = function (string $payoutId): void {
        $this->asAcademy($this->academy);
        $account = (string) Str::uuid();
        DB::table('cash_accounts')->insert(['id' => $account, 'academy_id' => $this->academy, 'name' => 'Drawer', 'kind' => 'CASH', 'currency' => 'EGP', 'opening_on' => '2026-01-01']);
        $category = (string) Str::uuid();
        DB::table('expense_categories')->insert(['id' => $category, 'academy_id' => $this->academy, 'name' => 'Salaries']);
        DB::table('expenses')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'number' => 'E-1', 'spent_on' => '2026-07-01', 'category_id' => $category,
            'amount_minor' => 100, 'currency' => 'EGP', 'cash_account_id' => $account, 'payout_id' => $payoutId,
        ]);
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

it('undoes a sealed lesson in a centre on the sealed statement itself when nobody paid it from the treasury', function () {
    // lingo 2026-11-26: a lesson deleted after October sealed stayed on October's salary — inside the
    // 24th-to-20th window they pay — and came off November's instead: "محسوبه من ضمن الراتب".
    cacCentreOn($this->academy);
    $student = ($this->blockStudent)('Saleem');
    $opened = ($this->block)($student);
    $lesson = ($this->attend)($student);
    ($this->sealJune)();
    $june = ($this->juneStatement)();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertOk()
        ->assertJsonPath('status', 'SCHEDULED')
        ->assertJsonPath('carried', null);

    $this->asAcademy($this->academy);
    $after = ($this->juneStatement)();
    expect(DB::table('sessions')->where('id', $lesson)->value('status'))->toBe('SCHEDULED')
        ->and((int) DB::table('lesson_packages')->where('id', $opened['package_id'])->value('minutes_consumed'))->toBe(0)
        ->and(DB::table('payout_line_items')->where('session_id', $lesson)->count())->toBe(0)
        ->and((int) $after->total_minor)->toBe((int) $june->total_minor - 5000)
        // Still sealed, on its own date.
        ->and((string) $after->finalized_at)->toBe((string) $june->finalized_at)
        ->and(DB::table('payout_adjustments')->count())->toBe(0)
        ->and(($this->julyStatement)())->toBeNull();

    // The window the lesson was taught in no longer pays it.
    Sanctum::actingAs($this->owner);
    $rows = collect($this->getJson('/api/payouts/range?from=2026-06-01&to=2026-06-30')->assertOk()->json('teachers'))
        ->where('teacher_id', $this->teacher);
    expect((int) $rows->sum('lessons_minor'))->toBe(0)->and((int) $rows->sum('deductions_minor'))->toBe(0);

    // Marked again, it is paid once, on the open statement.
    $this->postJson("/api/sessions/{$lesson}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->asAcademy($this->academy);
    expect((int) DB::table('payout_line_items')->where('session_id', $lesson)->sum('amount_minor'))->toBe(5000)
        ->and(DB::table('payout_line_items')->where('payout_id', ($this->julyStatement)()->id)->where('session_id', $lesson)->exists())->toBeTrue();
});

it('undoes a sealed lesson in a centre paid from the treasury: that statement stays, the pay comes off the open one', function () {
    cacCentreOn($this->academy);
    $student = ($this->blockStudent)('Saleem');
    $opened = ($this->block)($student);
    $lesson = ($this->attend)($student);
    ($this->sealJune)();
    $june = ($this->juneStatement)();
    ($this->paidFromTreasury)((string) $june->id);

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
    ($this->paidFromTreasury)((string) ($this->juneStatement)()->id);

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

it('folds a removal carried before: the line comes off its own statement, the deduction off the later one', function () {
    cacCentreOn($this->academy);
    $kept = ($this->blockStudent)('Nour');
    ($this->block)($kept);
    $student = ($this->blockStudent)('Saleem');
    ($this->block)($student);
    ($this->attend)($kept, '2026-06-09 10:00:00+00');
    $lesson = ($this->attend)($student);
    ($this->sealJune)();
    $june = ($this->juneStatement)();
    // The state the old carry left: undone while June was "paid", then the payment voided.
    ($this->paidFromTreasury)((string) $june->id);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertOk()->assertJsonPath('carried.amount_minor', 5000);
    $this->asAcademy($this->academy);
    DB::table('expenses')->where('payout_id', $june->id)->update(['voided_at' => now(), 'void_reason' => 'test']);
    $july = ($this->julyStatement)();
    expect((int) $july->total_minor)->toBe(-5000);

    $this->clearTenantContext();
    $this->artisan('payroll:fold-carried-removals', ['--academy' => $this->academy])->assertSuccessful();
    $this->asAcademy($this->academy);
    expect(DB::table('payout_line_items')->where('session_id', $lesson)->count())->toBe(1); // listed only

    $this->clearTenantContext();
    $this->artisan('payroll:fold-carried-removals', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('1 folded, 0 left')->assertSuccessful();

    $this->asAcademy($this->academy);
    $after = ($this->juneStatement)();
    expect(DB::table('payout_line_items')->where('session_id', $lesson)->count())->toBe(0)
        ->and((int) $after->total_minor)->toBe((int) $june->total_minor - 5000)
        ->and((string) $after->finalized_at)->toBe((string) $june->finalized_at)
        ->and(DB::table('payout_adjustments')->count())->toBe(0)
        ->and((int) ($this->julyStatement)()->total_minor)->toBe(0)
        ->and(($this->recalcOwed)())->toBe(0);

    // Run again: nothing left to fold.
    $this->clearTenantContext();
    $this->artisan('payroll:fold-carried-removals', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('0 folded, 0 left')->assertSuccessful();
});

it('folds a removal whose student was renamed since, by date, only when one deduction fits', function () {
    // lingo: "حمزه محمود" became "حمزه محمود برايفت" after three of his lessons were undone.
    cacCentreOn($this->academy);
    $student = ($this->blockStudent)('Hamza');
    ($this->block)($student);
    $lesson = ($this->attend)($student);
    $other = ($this->blockStudent)('Omar');
    ($this->block)($other);
    $kept = ($this->attend)($other);
    ($this->sealJune)();
    $june = ($this->juneStatement)();
    ($this->paidFromTreasury)((string) $june->id);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertOk();
    // Omar's lesson the same day is undone and marked again: its deduction belongs to it.
    $this->postJson("/api/sessions/{$kept}/attendance/revert")->assertOk();
    $this->postJson("/api/sessions/{$kept}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->asAcademy($this->academy);
    DB::table('students')->where('id', $student)->update(['full_name' => 'Hamza Private']);
    DB::table('expenses')->where('payout_id', $june->id)->update(['voided_at' => now(), 'void_reason' => 'test']);

    $this->clearTenantContext();
    $this->artisan('payroll:fold-carried-removals', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('matched by date: «Hamza»')
        ->expectsOutputToContain('1 folded, 0 left')->assertSuccessful();

    $this->asAcademy($this->academy);
    expect(DB::table('payout_line_items')->where('session_id', $lesson)->count())->toBe(0)
        ->and(DB::table('payout_adjustments')->where('reason', 'like', '%Hamza%')->count())->toBe(0)
        // Omar's stays: his June line, his deduction, his July line.
        ->and(DB::table('payout_adjustments')->where('reason', 'like', '%Omar%')->count())->toBe(1)
        ->and(DB::table('payout_line_items')->where('session_id', $kept)->count())->toBe(2)
        ->and(($this->recalcOwed)())->toBe(0);
});

it('leaves a removal carried from a statement still paid from the treasury', function () {
    cacCentreOn($this->academy);
    $student = ($this->blockStudent)('Saleem');
    ($this->block)($student);
    $lesson = ($this->attend)($student);
    ($this->sealJune)();
    ($this->paidFromTreasury)((string) ($this->juneStatement)()->id);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$lesson}/attendance/revert")->assertOk();

    $this->clearTenantContext();
    $this->artisan('payroll:fold-carried-removals', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('0 folded, 1 left')->assertSuccessful();

    $this->asAcademy($this->academy);
    expect(DB::table('payout_line_items')->where('session_id', $lesson)->count())->toBe(1)
        ->and(DB::table('payout_adjustments')->count())->toBe(1);
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
