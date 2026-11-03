<?php

declare(strict_types=1);

use App\Services\Invoicing;
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

/**
 * Alrayan, 2026-11-03: October's lessons were corrected after the 3rd and every difference landed on
 * November. An old statement is now edited and deleted where it is, and stays sealed. Only one paid
 * out of the treasury keeps its figures.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-20 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-seal@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-seal@test.local']);
    // 5000 an hour, so a 60-minute lesson pays exactly 5000.
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id, 'session_rate_minor' => 5000, 'currency' => 'EGP']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->student, 'plan_label' => 'Test',
        'price_minor' => 8000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION', 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);

    $this->attended = function (string $at, int $minutes = 60): string {
        $id = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => $at, 'duration_minutes' => $minutes, 'status' => 'SCHEDULED']);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $id;
    };
    $this->sealJune = function (): void {
        $this->asAcademy($this->academy);
        app(Invoicing::class)->closePeriodInvoices($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
        app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
        Carbon::setTestNow('2026-07-05 12:00:00');
        Sanctum::actingAs($this->owner);
    };
    $this->statement = function (int $month): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->where('period_year', 2026)->where('period_month', $month)->first();
    };
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
});

afterEach(fn () => Carbon::setTestNow());

it('adds and removes a reward on the old statement itself, and it stays sealed on the same date', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);

    Sanctum::actingAs($this->owner);
    $id = $this->postJson("/api/payouts/{$june->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])->assertSuccessful()->json('id');

    $after = ($this->statement)(6);
    expect((int) $after->total_minor)->toBe(7000);
    expect($after->finalized_at)->toBe($june->finalized_at);
    expect(($this->statement)(7))->toBeNull();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/payouts/{$june->id}/adjustments/{$id}")->assertOk();
    expect((int) ($this->statement)(6)->total_minor)->toBe(5000);
    expect(($this->statement)(6)->finalized_at)->toBe($june->finalized_at);
});

it('removes a lesson from the old statement, with nothing on next month', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $wrong = ($this->attended)('2026-06-12 10:00:00+00');
    ($this->sealJune)();

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/payouts/lessons/{$wrong}/removal-preview")->assertOk()->assertJsonPath('payout_sealed', false);
    $this->deleteJson("/api/payouts/lessons/{$wrong}")->assertOk();

    $june = ($this->statement)(6);
    expect((int) $june->total_minor)->toBe(5000);
    expect($june->finalized_at)->not->toBeNull();
    expect(DB::table('payout_line_items')->where('session_id', $wrong)->exists())->toBeFalse();
    expect(($this->statement)(7))->toBeNull();
});

it('corrects a lesson\'s length on the old statement', function () {
    $lesson = ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/payouts/lessons/{$lesson}/duration-preview?duration_minutes=30")->assertOk()->assertJsonPath('payout.finalized', false);
    $this->patchJson("/api/payouts/lessons/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    expect((int) ($this->statement)(6)->total_minor)->toBe(2500);
    expect((int) DB::table('payout_line_items')->where('session_id', $lesson)->value('amount_minor'))->toBe(2500);
    expect(($this->statement)(7))->toBeNull();
});

it('adds a missing lesson to its own old month', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/payouts/lessons', [
        'teacher_id' => $this->teacher, 'student_id' => $this->student, 'local_datetime' => '2026-06-15T13:00', 'duration_minutes' => 60,
    ])->assertCreated()->assertJsonPath('statement_month', 6)->assertJsonPath('carried', false);

    expect((int) ($this->statement)(6)->total_minor)->toBe(10000);
    expect(($this->statement)(6)->finalized_at)->not->toBeNull();
    expect(($this->statement)(7))->toBeNull();
});

it('recalculates the old statement in place and takes back what was carried from it before', function () {
    $lesson = ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);

    // As it was until today: the length changed and the difference went on July.
    $this->asAcademy($this->academy);
    DB::table('sessions')->where('id', $lesson)->update(['duration_minutes' => 30]);
    app(Payroll::class)->carryLessonDifference($june->id, -2500, 'Lesson length corrected', $this->owner->id, 'ACADEMY_OWNER');
    expect((int) ($this->statement)(7)->deductions_minor)->toBe(2500);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$june->id}/reprice")->assertOk()->assertJsonPath('delta_minor', -2500);

    expect((int) ($this->statement)(6)->total_minor)->toBe(2500);
    expect((int) ($this->statement)(7)->deductions_minor)->toBe(0);
    expect((int) ($this->statement)(7)->total_minor)->toBe(0);
    expect(($this->statement)(6)->finalized_at)->toBe($june->finalized_at);
});

it('leaves nothing half done when a correction fails', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);

    $this->asAcademy($this->academy);
    try {
        app(Payroll::class)->correcting($june->id, function () use ($june): void {
            DB::table('payouts')->where('id', $june->id)->update(['total_minor' => 1]);
            throw new RuntimeException('boom');
        });
    } catch (RuntimeException) {
    }

    $after = ($this->statement)(6);
    expect((int) $after->total_minor)->toBe(5000);
    expect($after->finalized_at)->toBe($june->finalized_at);
});

it('deletes a statement, open or sealed; its lessons stay taught and can be counted again', function () {
    $lesson = ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/payouts/{$june->id}")->assertOk();

    expect(($this->statement)(6))->toBeNull();
    expect(DB::table('payout_line_items')->where('session_id', $lesson)->exists())->toBeFalse();
    expect(DB::table('sessions')->where('id', $lesson)->value('status'))->toBe('ATTENDED');
    $audit = DB::table('audit_log')->where('action', 'payout.deleted')->where('entity_id', $june->id)->first();
    expect(json_decode((string) $audit->before, true)['total_minor'])->toBe(5000);
    expect(json_decode((string) $audit->before, true)['lines'][0]['session_id'])->toBe($lesson);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/payouts/lessons', [
        'teacher_id' => $this->teacher, 'student_id' => $this->student, 'local_datetime' => '2026-06-10T13:00', 'duration_minutes' => 60,
    ])->assertCreated()->assertJsonPath('statement_month', 6);
    expect((int) ($this->statement)(6)->total_minor)->toBe(5000);
});

it('takes back what was carried from a statement when it is deleted', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);
    $this->asAcademy($this->academy);
    app(Payroll::class)->carryLessonDifference($june->id, -1000, 'Corrected', $this->owner->id, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/payouts/{$june->id}")->assertOk();

    expect((int) ($this->statement)(7)->deductions_minor)->toBe(0);
});

it('refuses editing or deleting a statement paid from the treasury, and says what to do', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);
    ($this->paidFromTreasury)($june->id);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/payouts/{$june->id}")->assertOk()->assertJsonPath('payout.paid_out_minor', 100);
    $this->postJson("/api/payouts/{$june->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])
        ->assertStatus(422)->assertSee('void that payment first');
    $this->deleteJson("/api/payouts/{$june->id}")->assertStatus(422);

    expect(($this->statement)(6))->not->toBeNull();
    expect((int) ($this->statement)(6)->total_minor)->toBe(5000);
});

it('still lets a corrected statement go once its treasury payment is voided', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);
    ($this->paidFromTreasury)($june->id);

    $this->asAcademy($this->academy);
    DB::table('expenses')->where('payout_id', $june->id)->update(['voided_at' => now(), 'void_reason' => 'wrong']);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/payouts/{$june->id}")->assertOk();

    expect(($this->statement)(6))->toBeNull();
    expect(DB::table('expenses')->where('number', 'E-1')->whereNotNull('voided_at')->exists())->toBeTrue();
});

it('keeps the database guard: nothing but a correction can touch a sealed statement', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);

    $this->asAcademy($this->academy);
    expect(fn () => DB::transaction(fn () => DB::table('payouts')->where('id', $june->id)->update(['finalized_at' => null])))->toThrow(QueryException::class);
    expect(fn () => DB::transaction(fn () => DB::table('payouts')->where('id', $june->id)->update(['total_minor' => 1])))->toThrow(QueryException::class);
    expect(fn () => DB::transaction(fn () => DB::table('payout_line_items')->where('payout_id', $june->id)->delete()))->toThrow(QueryException::class);
});

it('is the owner\'s to do: a teacher can neither delete nor edit a statement', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->statement)(6);

    Sanctum::actingAs($this->teacherUser);
    $this->deleteJson("/api/payouts/{$june->id}")->assertForbidden();
    $this->postJson("/api/payouts/{$june->id}/adjustments", ['type' => 'REWARD', 'amount_minor' => 2000, 'reason' => 'Bonus'])->assertForbidden();

    expect(($this->statement)(6))->not->toBeNull();
});
