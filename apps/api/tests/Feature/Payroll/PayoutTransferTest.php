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
 * The office's "transferred" tick beside a month's salary: who got their money and who is still
 * waiting. A note, not a payment, so it moves no money and never stops a correction.
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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-transfer@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-transfer@test.local']);
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
    $this->june = function (): object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->where('period_year', 2026)->where('period_month', 6)->first();
    };
    $this->listed = function (string $transfer): array {
        Sanctum::actingAs($this->owner);

        return collect($this->getJson('/api/payouts?filter[transfer]='.$transfer)->assertOk()->json('rows'))->pluck('id')->all();
    };
    $this->paidFromTreasury = function (string $payoutId, int $amount): void {
        $this->asAcademy($this->academy);
        $account = (string) Str::uuid();
        DB::table('cash_accounts')->insert(['id' => $account, 'academy_id' => $this->academy, 'name' => 'Drawer', 'kind' => 'CASH', 'currency' => 'EGP', 'opening_on' => '2026-01-01']);
        $category = (string) Str::uuid();
        DB::table('expense_categories')->insert(['id' => $category, 'academy_id' => $this->academy, 'name' => 'Salaries']);
        DB::table('expenses')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'number' => 'E-1', 'spent_on' => '2026-07-01', 'category_id' => $category,
            'amount_minor' => $amount, 'currency' => 'EGP', 'cash_account_id' => $account, 'payout_id' => $payoutId,
        ]);
    };
});

afterEach(fn () => Carbon::setTestNow());

it('ticks a sealed statement without touching its money or its seal', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $before = ($this->june)();

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/payouts/{$before->id}/transfer", ['transferred' => true])
        ->assertOk()
        ->assertJsonPath('transferred_minor', 5000);

    $after = ($this->june)();
    expect((int) $after->total_minor)->toBe(5000)
        ->and($after->finalized_at)->toBe($before->finalized_at)
        ->and((string) $after->transferred_by)->toBe((string) $this->owner->id);

    // Bound with its offset, or a timestamptz lands 3 hours early: see the naive timestamp trap.
    expect(Carbon::parse($after->transferred_at)->utc()->toDateTimeString())->toBe('2026-07-05 12:00:00');
});

it('ticks an open statement too, since an academy pays when it pays', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $june = ($this->june)();

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertOk();

    expect(($this->june)()->transferred_at)->not->toBeNull()
        ->and(($this->june)()->finalized_at)->toBeNull();
});

it('splits the list into who was paid and who is still waiting, and undoes', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $june = ($this->june)();

    expect(($this->listed)('PENDING'))->toBe([$june->id])
        ->and(($this->listed)('DONE'))->toBe([]);

    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertOk();

    expect(($this->listed)('DONE'))->toBe([$june->id])
        ->and(($this->listed)('PENDING'))->toBe([]);

    $row = $this->getJson('/api/payouts')->assertOk()->json('rows.0');
    expect($row['transferred_minor'])->toBe(5000)
        ->and($row['transferred_by_name'])->not->toBeNull()
        ->and($row['paid_out_minor'])->toBe(0);

    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => false])
        ->assertOk()
        ->assertJsonPath('transferred_at', null);

    expect(($this->listed)('PENDING'))->toBe([$june->id]);
    expect(($this->june)()->transferred_by)->toBeNull();
});

it('keeps the first date and amount when ticked twice', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $june = ($this->june)();

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertOk();
    $first = ($this->june)()->transferred_at;

    Carbon::setTestNow('2026-06-25 12:00:00');
    ($this->attended)('2026-06-11 10:00:00+00');
    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertOk();

    expect(($this->june)()->transferred_at)->toBe($first)
        ->and((int) ($this->june)()->transferred_minor)->toBe(5000);
});

it('leaves a ticked statement correctable and remembers what was sent', function () {
    $lesson = ($this->attended)('2026-06-10 10:00:00+00');
    ($this->attended)('2026-06-11 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->june)();

    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertOk();
    $this->deleteJson("/api/payouts/lessons/{$lesson}")->assertOk();

    $after = ($this->june)();
    expect((int) $after->total_minor)->toBe(5000)
        ->and((int) $after->transferred_minor)->toBe(10000)
        ->and($after->transferred_at)->not->toBeNull();
});

it('counts a statement the treasury paid in full as sent, and a part payment as still waiting', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->sealJune)();
    $june = ($this->june)();

    ($this->paidFromTreasury)($june->id, 1000);
    expect(($this->listed)('PENDING'))->toBe([$june->id]);
    expect($this->getJson('/api/payouts')->assertOk()->json('rows.0.paid_out_minor'))->toBe(1000);

    $this->asAcademy($this->academy);
    DB::table('expenses')->where('payout_id', $june->id)->update(['amount_minor' => 5000]);

    expect(($this->listed)('DONE'))->toBe([$june->id])
        ->and(($this->listed)('PENDING'))->toBe([]);
});

it('does not list a statement owing nothing as waiting', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $june = ($this->june)();
    $this->asAcademy($this->academy);
    DB::table('payouts')->where('id', $june->id)->update(['total_minor' => 0]);

    expect(($this->listed)('PENDING'))->toBe([]);
});

it('refuses to delete a statement still marked as transferred', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $june = ($this->june)();

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertOk();
    $this->deleteJson("/api/payouts/{$june->id}")->assertStatus(422);

    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => false])->assertOk();
    $this->deleteJson("/api/payouts/{$june->id}")->assertOk();
});

it('is refused to a teacher, and to another academy', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $june = ($this->june)();

    Sanctum::actingAs($this->teacherUser);
    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertForbidden();

    $other = $this->createAcademy(overrides: ['plan_id' => DB::table('plans')->where('code', 'PRO')->value('id')]);
    $outsider = $this->makeUser($other, 'ACADEMY_OWNER', ['email' => 'owner-transfer-other@test.local']);
    Sanctum::actingAs($outsider);
    $this->patchJson("/api/payouts/{$june->id}/transfer", ['transferred' => true])->assertNotFound();

    expect(($this->june)()->transferred_at)->toBeNull();
});
