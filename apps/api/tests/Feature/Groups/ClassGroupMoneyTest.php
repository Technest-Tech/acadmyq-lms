<?php

declare(strict_types=1);

use App\Jobs\BillGroupMonthsJob;
use App\Jobs\RollSessionWindowJob;
use App\Services\GroupBilling;
use App\Services\Invoicing;
use App\Services\ModuleBilling;
use App\Services\Payroll;
use App\Services\SessionGenerator;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * Group classes — the money (docs/groups §Money). The rules pinned here:
 *   - members are billed on the parent's ordinary monthly invoice, never twice for one month,
 *     lesson or enrolment; a late joiner's first month is pro-rated by lessons;
 *   - the teacher earns ONE line per held lesson, never one per student;
 *   - money follows the sheet, and a closed invoice / finalized statement refuses to move;
 *   - prices are hidden from whoever may not see money, and nothing bills with the switch off.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo. June's Mondays + Wednesdays: 1 3 8 10 15 17 22 24 29.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-money@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-money@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-money@test.local']);
    // 60 an hour, paid by the lesson.
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->teacherUser->getKey(), 'session_rate_minor' => 6000, 'currency' => 'EGP']);

    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Parent of two']);
    $this->kids = [];
    foreach (['Adam', 'Bassel'] as $name) {
        $this->kids[$name] = $this->createStudent($this->academy, $this->parent, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    $this->kids['Celine'] = $this->createStudent($this->academy, null, ['full_name' => 'Celine', 'status' => 'REGULAR']);
    $this->kids['Dina'] = $this->createStudent($this->academy, null, ['full_name' => 'Dina', 'status' => 'REGULAR']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

if (! function_exists('asTenant')) {
    /** Read under the academy's own tenant context, then drop it again (the helpers are global). */
    function asTenant(string $academyId, callable $fn): mixed
    {
        DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
        DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
        try {
            return $fn();
        } finally {
            DB::statement("select set_config('app.current_academy_id', '', true)");
            DB::statement("select set_config('app.current_role', '', true)");
        }
    }
}

if (! function_exists('lessonOn')) {
    function lessonOn($test, string $groupId, string $date): object
    {
        return asTenant($test->academy, fn () => DB::table('class_group_lessons')
            ->where('group_id', $groupId)->where('occurrence_local_date', $date)->first());
    }
}

function moneyGroup($test, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', array_merge([
        'name' => 'English A1',
        'teacher_id' => $test->teacher,
        'start_date' => '2026-06-01',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ],
        'billing_mode' => 'MONTHLY',
        'price_minor' => 45000,
        'currency' => 'EGP',
    ], $over))->assertCreated()->json('group.id');
}

/** @return Collection<int, object> */
function groupLines($test, string $groupId)
{
    return asTenant($test->academy, fn () => DB::table('invoice_line_items as li')
        ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
        ->where('li.class_group_id', $groupId)
        ->orderBy('li.student_id')->orderBy('li.group_period')
        ->get(['li.*', 'i.guardian_id', 'i.student_id as payer_student_id', 'i.period_month', 'i.status as invoice_status', 'i.total_minor']));
}

/** @return Collection<int, object> */
function groupPayLines($test, string $groupId)
{
    return asTenant($test->academy, fn () => DB::table('payout_line_items as pl')
        ->leftJoin('class_group_lessons as l', 'l.id', '=', 'pl.class_group_lesson_id')
        ->join('payouts as p', 'p.id', '=', 'pl.payout_id')
        ->where(fn ($q) => $q->where('l.group_id', $groupId)->orWhere('pl.class_group_id', $groupId))
        ->get(['pl.*', 'p.teacher_id', 'p.total_minor', 'p.finalized_at']));
}

function heldLesson($test, string $groupId, string $date, array $entries = []): object
{
    $lesson = lessonOn($test, $groupId, $date);
    Sanctum::actingAs($test->owner);
    $test->postJson("/api/group-lessons/{$lesson->id}/attendance", ['entries' => $entries])->assertOk();

    return lessonOn($test, $groupId, $date);
}

// ── MONTHLY ──────────────────────────────────────────────────────────────────

it('bills each member the month up front, on the parent’s ordinary invoice', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);
    $lines = groupLines($this, $groupId);

    expect($lines)->toHaveCount(3);
    expect($lines->pluck('amount_minor')->map(fn ($a) => (int) $a)->unique()->all())->toBe([45000]);
    expect($lines->pluck('group_charge')->unique()->all())->toBe(['MONTHLY']);
    expect($lines->first()->description)->toBe('English A1 — June 2026');

    // The two siblings share ONE invoice — their parent's — and its total carries both.
    $siblings = $lines->whereNotNull('guardian_id')->where('guardian_id', $this->parent);
    expect($siblings)->toHaveCount(2);
    expect($siblings->pluck('invoice_id')->unique())->toHaveCount(1);
    expect((int) $siblings->first()->total_minor)->toBe(90000);
});

it('never bills a month twice, however often the nightly job runs', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);

    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));

    expect(groupLines($this, $groupId))->toHaveCount(1);
});

it('bills the new month on the first run of that month', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);

    Carbon::setTestNow('2026-07-01 03:00:00');
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));

    expect(groupLines($this, $groupId)->pluck('description')->all())->toBe(['English A1 — June 2026', 'English A1 — July 2026']);
});

it('pro-rates a late joiner’s first month by the lessons left', function () {
    $groupId = moneyGroup($this);

    Sanctum::actingAs($this->owner);
    // Joins today (Wed 17th): 17, 22, 24, 29 are left of June's 9 lessons.
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Dina']], 'joined_on' => '2026-06-17'])->assertCreated();

    $line = groupLines($this, $groupId)->first();
    expect((int) $line->amount_minor)->toBe(20000); // 45000 × 4/9
    expect($line->description)->toBe('English A1 — June 2026 (4/9)');
});

it('charges a member their own price when they have one', function () {
    $groupId = moneyGroup($this, ['start_date' => '2026-07-01']);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Bassel']], 'joined_on' => '2026-07-01'])->assertCreated();
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Bassel']}", ['price_minor' => 30000])->assertOk();

    Carbon::setTestNow('2026-07-02 03:00:00');
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));

    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(30000);
});

it('does not bill a moved student twice for the same month', function () {
    $from = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $to = moneyGroup($this, ['name' => 'English A2', 'student_ids' => []]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$from}/members/{$this->kids['Adam']}/move", ['to_group_id' => $to, 'on' => '2026-06-17'])->assertOk();

    expect(groupLines($this, $from))->toHaveCount(1);
    expect(groupLines($this, $to))->toHaveCount(0);
});

it('does not bill a group without a price, and bills it the moment it gets one', function () {
    $groupId = moneyGroup($this, ['price_minor' => null, 'student_ids' => [$this->kids['Adam']]]);
    expect(groupLines($this, $groupId))->toHaveCount(0);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/groups/{$groupId}", ['price_minor' => 40000])->assertOk();

    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(40000);
});

// ── PER_LESSON & COURSE ──────────────────────────────────────────────────────

it('per lesson: charges who came, the absent only when the group says so, never the excused', function () {
    $groupId = moneyGroup($this, ['billing_mode' => 'PER_LESSON', 'price_minor' => 8000,
        'student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);
    expect(groupLines($this, $groupId))->toHaveCount(0); // nothing up front

    heldLesson($this, $groupId, '2026-06-15', [
        ['student_id' => $this->kids['Bassel'], 'status' => 'ABSENT'],
        ['student_id' => $this->kids['Celine'], 'status' => 'EXCUSED'],
    ]);
    expect(groupLines($this, $groupId)->pluck('student_id')->all())->toBe([$this->kids['Adam']]);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/groups/{$groupId}", ['charge_absent' => true])->assertOk();
    heldLesson($this, $groupId, '2026-06-10', [
        ['student_id' => $this->kids['Bassel'], 'status' => 'ABSENT'],
        ['student_id' => $this->kids['Celine'], 'status' => 'EXCUSED'],
    ]);
    $tenth = groupLines($this, $groupId)->where('group_period', '2026-06-10');
    expect($tenth->pluck('student_id')->sort()->values()->all())->toBe(collect([$this->kids['Adam'], $this->kids['Bassel']])->sort()->values()->all());
    expect($tenth->first()->description)->toBe('English A1 — lesson 2026-06-10');
});

it('per lesson: undoing a sheet takes its charges back — unless the invoice has closed', function () {
    $groupId = moneyGroup($this, ['billing_mode' => 'PER_LESSON', 'price_minor' => 8000, 'student_ids' => [$this->kids['Adam']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-15');
    expect(groupLines($this, $groupId))->toHaveCount(1);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance/revert")->assertOk();
    expect(groupLines($this, $groupId))->toHaveCount(0);

    heldLesson($this, $groupId, '2026-06-15');
    $line = groupLines($this, $groupId)->first();
    asTenant($this->academy, fn () => DB::table('invoices')->where('id', $line->invoice_id)->update(['status' => 'CLOSED']));

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance/revert")->assertStatus(422);
    // Rolled back whole: the sheet and its charge are both still there.
    expect(lessonOn($this, $groupId, '2026-06-15')->status)->toBe('HELD');
    expect(groupLines($this, $groupId))->toHaveCount(1);
});

it('course: one fee per enrolment, nothing monthly', function () {
    $groupId = moneyGroup($this, ['billing_mode' => 'COURSE', 'price_minor' => 150000, 'student_ids' => [$this->kids['Adam']]]);

    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));

    $lines = groupLines($this, $groupId);
    expect($lines)->toHaveCount(1);
    expect($lines->first()->group_charge)->toBe('COURSE');
    expect((int) $lines->first()->amount_minor)->toBe(150000);
    expect($lines->first()->description)->toBe('English A1 — course fee');
});

// ── The teacher ──────────────────────────────────────────────────────────────

it('pays the teacher ONE line per held lesson, however many students sat in it', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);
    heldLesson($this, $groupId, '2026-06-15');

    $pay = groupPayLines($this, $groupId);
    expect($pay)->toHaveCount(1);
    // Their own rule, as a private lesson of that length: 60/hr × 60 min.
    expect((int) $pay->first()->amount_minor)->toBe(6000);
    expect((string) $pay->first()->teacher_id)->toBe($this->teacher);
    expect($pay->first()->description)->toBe('English A1 — 3/3');

    // Re-saving the sheet never adds a second line.
    heldLesson($this, $groupId, '2026-06-15', [['student_id' => $this->kids['Adam'], 'status' => 'ABSENT']]);
    expect(groupPayLines($this, $groupId))->toHaveCount(1);
});

it('per student: the line follows how many came', function () {
    $groupId = moneyGroup($this, ['teacher_pay_mode' => 'PER_STUDENT', 'teacher_pay_minor' => 1500,
        'student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);

    heldLesson($this, $groupId, '2026-06-15');
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(4500);

    heldLesson($this, $groupId, '2026-06-15', [['student_id' => $this->kids['Adam'], 'status' => 'ABSENT']]);
    $line = groupPayLines($this, $groupId)->first();
    expect((int) $line->amount_minor)->toBe(3000);
    // The statement's total moved with it.
    expect((int) $line->total_minor)->toBe(3000);
});

it('a fixed amount per lesson, and nothing once the sheet is undone', function () {
    $groupId = moneyGroup($this, ['teacher_pay_mode' => 'PER_LESSON', 'teacher_pay_minor' => 9000, 'student_ids' => [$this->kids['Adam']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-15');
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(9000);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance/revert")->assertOk();
    expect(groupPayLines($this, $groupId))->toHaveCount(0);
});

it('refuses to undo a lesson whose teacher statement is finalized', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-15');
    $payoutId = groupPayLines($this, $groupId)->first()->payout_id;
    asTenant($this->academy, fn () => DB::table('payouts')->where('id', $payoutId)->update(['finalized_at' => now()]));

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance/revert")->assertStatus(422);
    expect(lessonOn($this, $groupId, '2026-06-15')->status)->toBe('HELD');
});

it('revenue share: the teacher earns their share of what the group billed in the month', function () {
    $groupId = moneyGroup($this, ['teacher_pay_mode' => 'REVENUE_SHARE', 'teacher_share_bp' => 5000,
        'student_ids' => [$this->kids['Adam'], $this->kids['Bassel']]]);

    $share = groupPayLines($this, $groupId)->whereNull('class_group_lesson_id');
    expect($share)->toHaveCount(1);
    expect((int) $share->first()->amount_minor)->toBe(45000); // 50 % of 2 × 45000
    expect($share->first()->description)->toBe('English A1 — 50% of June 2026');

    // A new member moves the share with the bill.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Celine']], 'joined_on' => '2026-06-01'])->assertCreated();
    expect((int) groupPayLines($this, $groupId)->whereNull('class_group_lesson_id')->first()->amount_minor)->toBe(67500);

    // The lessons still show on the statement — at 0.
    heldLesson($this, $groupId, '2026-06-15');
    expect((int) groupPayLines($this, $groupId)->whereNotNull('class_group_lesson_id')->first()->amount_minor)->toBe(0);
});

it('refuses a revenue share in a currency the teacher is not paid in', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/groups', [
        'name' => 'Dollar group',
        'teacher_id' => $this->teacher,
        'start_date' => '2026-06-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'price_minor' => 5000,
        'currency' => 'USD',
        'teacher_pay_mode' => 'REVENUE_SHARE',
        'teacher_share_bp' => 4000,
    ])->assertStatus(422)->assertJsonValidationErrors('teacher_pay_mode');
});

it('shows the group line on the teacher’s statement under the group’s name', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    heldLesson($this, $groupId, '2026-06-15');
    $payoutId = groupPayLines($this, $groupId)->first()->payout_id;

    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson("/api/payouts/{$payoutId}")->assertOk()->json('lineItems'))->first();

    expect($row['group_name'])->toBe('English A1');
    expect($row['duration_minutes'])->toBe(60);
    expect($row['report_status'])->toBe('FILLED');
});

// ── Integrity, visibility, switches ──────────────────────────────────────────

it('leaves invoices and statements that still close and finalize', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    heldLesson($this, $groupId, '2026-06-15');

    $invoiceId = groupLines($this, $groupId)->first()->invoice_id;
    $payoutId = groupPayLines($this, $groupId)->first()->payout_id;

    asTenant($this->academy, function () use ($invoiceId, $payoutId) {
        app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');
        app(Payroll::class)->finalizePayout($payoutId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');
        expect(DB::table('invoices')->where('id', $invoiceId)->value('status'))->toBe('CLOSED');
        expect(DB::table('payouts')->where('id', $payoutId)->value('finalized_at'))->not->toBeNull();
    });
});

it('keeps prices away from a supervisor', function () {
    $groupId = moneyGroup($this, ['teacher_pay_mode' => 'PER_LESSON', 'teacher_pay_minor' => 9000]);

    Sanctum::actingAs($this->supervisor);
    $group = $this->getJson("/api/groups/{$groupId}")->assertOk()->json('group');
    expect($group['pricing'])->toBeNull();
    expect($group['teacher_pay'])->toBeNull();

    $this->patchJson("/api/groups/{$groupId}", ['price_minor' => 1])->assertForbidden();
    $this->patchJson("/api/groups/{$groupId}", ['name' => 'Renamed by supervisor'])->assertOk();

    Sanctum::actingAs($this->owner);
    $group = $this->getJson("/api/groups/{$groupId}")->json('group');
    expect($group['pricing']['price_minor'])->toBe(45000);
    expect($group['teacher_pay']['amount_minor'])->toBe(9000);
});

it('bills nothing when invoicing is switched off, and pays nothing when payroll is', function () {
    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['invoicing', 'payroll']);
    $this->clearTenantContext();

    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    heldLesson($this, $groupId, '2026-06-15');

    expect(groupLines($this, $groupId))->toHaveCount(0);
    expect(groupPayLines($this, $groupId))->toHaveCount(0);
});

it('refuses to delete a group that has billed anyone', function () {
    $groupId = moneyGroup($this, ['start_date' => '2026-06-20', 'student_ids' => [$this->kids['Adam']]]);
    expect(groupLines($this, $groupId))->toHaveCount(1);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/groups/{$groupId}")->assertStatus(422);
});

it('reads the month in money: charged, outstanding, teacher cost', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam'], $this->kids['Celine']]]);
    heldLesson($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $res = $this->getJson("/api/groups/{$groupId}/money?month=2026-06")->assertOk();

    expect($res->json('lines'))->toHaveCount(2);
    expect($res->json('totals.0'))->toMatchArray(['currency' => 'EGP', 'billed_minor' => 90000, 'paid_minor' => 0, 'outstanding_minor' => 90000]);
    expect($res->json('teacher_cost.0'))->toMatchArray(['currency' => 'EGP', 'amount_minor' => 6000, 'lessons' => 1]);

    Sanctum::actingAs($this->supervisor);
    $this->getJson("/api/groups/{$groupId}/money")->assertForbidden();
});

it('lets a group-only student be REGULAR', function () {
    $this->asAcademy($this->academy);
    DB::table('students')->where('id', $this->kids['Dina'])->update(['status' => 'TRIAL']);
    $this->clearTenantContext();
    moneyGroup($this, ['student_ids' => [$this->kids['Dina']]]);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/students/{$this->kids['Dina']}", ['status' => 'REGULAR'])->assertOk();
});
