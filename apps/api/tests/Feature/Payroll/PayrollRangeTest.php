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

/*
|--------------------------------------------------------------------------
| GET /api/payouts/range — salaries between two dates
|--------------------------------------------------------------------------
|
| Payouts are month-bucketed, so a window can never be answered by reading
| `payouts.total_minor`. These tests pin that the window re-adds the parts: lessons sliced exactly
| on their academy-local date, adjustments anchored on the date they refer to, and nothing summed
| across currencies.
*/

beforeEach(function () {
    Carbon::setTestNow('2026-06-30 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);

    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-range@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-range@test.local']);
    // 5000 per hour, so a 60-minute lesson pays exactly 5000.
    $this->teacher = $this->createTeacher($this->academy, [
        'user_id' => $this->teacherUser->id,
        'session_rate_minor' => 5000,
        'currency' => 'EGP',
    ]);

    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => '1:1 EGP',
        'price_minor' => 10000,
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'sessions_per_month' => null,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    /** An ATTENDED 60-minute lesson on the given UTC instant, driven through the real attendance path. */
    $this->lessonOn = function (string $at, int $minutes = 60): string {
        $id = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => $at,
            'duration_minutes' => $minutes,
            'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $id;
    };

    $this->range = function (string $from, string $to) {
        Sanctum::actingAs($this->owner);

        return $this->getJson("/api/payouts/range?from={$from}&to={$to}");
    };
});

afterEach(fn () => Carbon::setTestNow());

it('sums only the lessons whose date falls inside the window', function () {
    ($this->lessonOn)('2026-06-05 10:00:00+00');
    ($this->lessonOn)('2026-06-15 10:00:00+00');
    ($this->lessonOn)('2026-06-25 10:00:00+00');

    // The middle lesson only: a window is not a month, and this is the whole point of the feature.
    ($this->range)('2026-06-10', '2026-06-20')
        ->assertOk()
        ->assertJsonPath('teachers.0.sessions', 1)
        ->assertJsonPath('teachers.0.lessons_minor', 5000)
        ->assertJsonPath('teachers.0.net_minor', 5000)
        ->assertJsonPath('currencies.0.net_minor', 5000)
        ->assertJsonPath('currencies.0.teachers', 1);
});

it('reports hours taught, not just money', function () {
    ($this->lessonOn)('2026-06-12 10:00:00+00', 90);
    ($this->lessonOn)('2026-06-13 10:00:00+00', 30);

    ($this->range)('2026-06-01', '2026-06-30')
        ->assertOk()
        ->assertJsonPath('teachers.0.minutes', 120)
        // 90 min + 30 min at 5000/hour = 7500 + 2500.
        ->assertJsonPath('teachers.0.lessons_minor', 10000);
});

it('spans a month boundary — the thing a month filter cannot do', function () {
    ($this->lessonOn)('2026-06-28 10:00:00+00');
    // Attendance cannot be recorded before a lesson has started, so step the clock past it. The
    // two lessons land in different monthly statements, which is exactly what a window has to
    // reach across.
    Carbon::setTestNow('2026-07-10 12:00:00');
    ($this->lessonOn)('2026-07-02 10:00:00+00');

    ($this->range)('2026-06-25', '2026-07-05')
        ->assertOk()
        ->assertJsonPath('teachers.0.sessions', 2)
        ->assertJsonPath('teachers.0.lessons_minor', 10000);
});

it('includes rewards and deductions recorded inside the window and nets them off', function () {
    $session = ($this->lessonOn)('2026-06-15 10:00:00+00');

    $this->asAcademy($this->academy);
    $payoutId = (string) DB::table('payout_line_items')->where('session_id', $session)->value('payout_id');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payoutId}/adjustments", [
        'type' => 'REWARD',
        'amount_minor' => 2000,
        'reason' => 'Cover lesson',
    ])->assertCreated();
    $this->postJson("/api/payouts/{$payoutId}/adjustments", [
        'type' => 'DEDUCTION',
        'amount_minor' => 500,
        'reason' => 'Late',
    ])->assertCreated();

    ($this->range)('2026-06-01', '2026-06-30')
        ->assertOk()
        ->assertJsonPath('teachers.0.rewards_minor', 2000)
        ->assertJsonPath('teachers.0.deductions_minor', 500)
        ->assertJsonPath('teachers.0.net_minor', 6500);
});

it('leaves out an adjustment recorded outside the window', function () {
    $session = ($this->lessonOn)('2026-06-15 10:00:00+00');

    $this->asAcademy($this->academy);
    $payoutId = (string) DB::table('payout_line_items')->where('session_id', $session)->value('payout_id');

    // Recorded on the 29th — outside a window that stops on the 20th.
    Carbon::setTestNow('2026-06-29 09:00:00');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payoutId}/adjustments", [
        'type' => 'DEDUCTION',
        'amount_minor' => 500,
        'reason' => 'Late',
    ])->assertCreated();

    ($this->range)('2026-06-10', '2026-06-20')
        ->assertOk()
        ->assertJsonPath('teachers.0.deductions_minor', 0)
        ->assertJsonPath('teachers.0.net_minor', 5000);
});

it('never sums two currencies into one figure', function () {
    ($this->lessonOn)('2026-06-15 10:00:00+00');

    // A second teacher paid in USD, with their own student.
    $otherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-usd@test.local']);
    $other = $this->createTeacher($this->academy, [
        'user_id' => $otherUser->id,
        'session_rate_minor' => 3000,
        'currency' => 'USD',
    ]);
    $session = $this->createSession($this->academy, $this->student, $other, [
        'scheduled_at_utc' => '2026-06-16 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $body = ($this->range)('2026-06-01', '2026-06-30')->assertOk()->json();

    expect($body['currencies'])->toHaveCount(2);
    $byCurrency = collect($body['currencies'])->keyBy('currency');
    expect((int) $byCurrency['EGP']['net_minor'])->toBe(5000)
        ->and((int) $byCurrency['USD']['net_minor'])->toBe(3000);
});

it('rejects a window that runs backwards, and requires both ends', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/payouts/range?from=2026-06-20&to=2026-06-10')->assertStatus(422);
    $this->getJson('/api/payouts/range?from=2026-06-20')->assertStatus(422);
});

it('forbids a teacher from reading the academy-wide salary window', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->getJson('/api/payouts/range?from=2026-06-01&to=2026-06-30')->assertStatus(403);
});

it('lists the monthly statements a window touches, on both sides of the boundary', function () {
    ($this->lessonOn)('2026-06-28 10:00:00+00');
    Carbon::setTestNow('2026-07-10 12:00:00');
    ($this->lessonOn)('2026-07-02 10:00:00+00');

    Sanctum::actingAs($this->owner);

    // A window is days, a statement is a month — overlap is the only honest relation.
    $both = $this->getJson('/api/payouts?filter[period_from]=2026-06&filter[period_to]=2026-07')
        ->assertOk()
        ->json();
    expect($both['total'])->toBe(2);

    $juneOnly = $this->getJson('/api/payouts?filter[period_from]=2026-06&filter[period_to]=2026-06')
        ->assertOk()
        ->json();
    expect($juneOnly['total'])->toBe(1)
        ->and((int) $juneOnly['rows'][0]['period_month'])->toBe(6);
});
