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
use Illuminate\Support\Str;
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

it('corrects a join date while nothing was held since: an earlier date bills the month it now covers, a held lesson locks it', function () {
    // May's Mondays + Wednesdays: 4 6 11 13 18 20 25 27.
    $groupId = moneyGroup($this, ['start_date' => '2026-05-01']);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Dina']], 'joined_on' => '2026-06-01'])->assertCreated();
    expect(groupLines($this, $groupId)->pluck('group_period')->all())->toBe(['2026-06-01']);

    // Entered a month late: she has been coming since May's first lesson.
    $res = $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Dina']}", ['joined_on' => '2026-05-04'])->assertOk();
    expect(collect($res->json('group.members'))->firstWhere('student_id', $this->kids['Dina'])['joined_on'])->toBe('2026-05-04');
    $lines = groupLines($this, $groupId);
    expect($lines->pluck('group_period')->all())->toBe(['2026-05-01', '2026-06-01']);
    expect($lines->pluck('amount_minor')->map(fn ($a) => (int) $a)->all())->toBe([45000, 45000]);

    // Once the group has held a lesson since, the date stays — and a price still saves on its own.
    heldLesson($this, $groupId, '2026-06-15');
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Dina']}", ['joined_on' => '2026-06-17'])
        ->assertStatus(422)->assertJsonValidationErrors('joined_on');
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Dina']}", ['price_minor' => 30000, 'joined_on' => '2026-06-17'])->assertStatus(422);
    expect(asTenant($this->academy, fn () => DB::table('class_group_members')->where('group_id', $groupId)->value('price_minor')))->toBeNull();
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Dina']}", ['price_minor' => 30000])->assertOk();
    expect(groupLines($this, $groupId))->toHaveCount(2);
});

/** Accounting on (receipts know what is paid), and the two-children family set to pay first. */
function payFirstFamily($test): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$test->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($test->academy, 'MANAGEMENT', [], ['accounting']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
    Sanctum::actingAs($test->owner);
    $test->patchJson("/api/accounting/family/{$test->parent}/renewal-policy", ['policy' => 'PAY_FIRST'])->assertOk();
}

it('pay first: no new month while the last is unpaid, and paying raises it — a free family is billed as before', function () {
    payFirstFamily($this);
    // From 1 May: May and June are owed on joining.
    $groupId = moneyGroup($this, ['start_date' => '2026-05-01', 'student_ids' => [$this->kids['Adam'], $this->kids['Celine']]]);

    $periods = fn (string $kid) => groupLines($this, $groupId)->where('student_id', $this->kids[$kid])->pluck('group_period')->values()->all();
    expect($periods('Adam'))->toBe(['2026-05-01'])
        ->and($periods('Celine'))->toBe(['2026-05-01', '2026-06-01']);

    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson("/api/groups/{$groupId}/accounts?month=2026-06")->assertOk()->json('rows'))->firstWhere('student_id', $this->kids['Adam']);
    expect($row['awaiting_payment_since'])->toBe('2026-06-01');
    // The nightly run holds it too.
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect($periods('Adam'))->toBe(['2026-05-01']);

    // May is paid: June is raised at once, and nothing is held any more.
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'method' => 'CASH'])->assertCreated();
    expect($periods('Adam'))->toBe(['2026-05-01', '2026-06-01']);
    $row = collect($this->getJson("/api/groups/{$groupId}/accounts?month=2026-06")->json('rows'))->firstWhere('student_id', $this->kids['Adam']);
    expect($row['awaiting_payment_since'])->toBeNull();
});

it('pay first, by hours: no second month until the first is paid', function () {
    payFirstFamily($this);
    $groupId = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 120, 'student_ids' => [$this->kids['Adam'], $this->kids['Celine']]]);

    heldLesson($this, $groupId, '2026-06-01');
    heldLesson($this, $groupId, '2026-06-03');
    $cycles = fn (string $kid) => groupLines($this, $groupId)->where('student_id', $this->kids[$kid])->pluck('group_cycle')->map(fn ($c) => (int) $c)->values()->all();
    // Both used their two hours: the free family's next month is up, the paying-first one waits.
    expect($cycles('Celine'))->toBe([1, 2])->and($cycles('Adam'))->toBe([1]);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 30000, 'method' => 'CASH'])->assertCreated();
    expect($cycles('Adam'))->toBe([1, 2]);
});

it('undoes a student added to the wrong group: the membership and its unpaid charge go — not once attendance is saved', function () {
    $right = moneyGroup($this, ['name' => 'English A2']);
    $wrong = moneyGroup($this);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$wrong}/members", ['student_ids' => [$this->kids['Adam']], 'joined_on' => '2026-06-01'])->assertCreated();
    expect(groupLines($this, $wrong))->toHaveCount(1);
    $row = collect($this->getJson("/api/group-members?student_id={$this->kids['Adam']}&status=ALL")->assertOk()->json('members'))->first();
    expect($row['deletable'])->toBeTrue();

    $this->postJson("/api/groups/{$wrong}/members/{$this->kids['Adam']}/undo")->assertOk()->assertJsonPath('credited_minor', 0);
    expect(groupLines($this, $wrong))->toHaveCount(0);
    expect(asTenant($this->academy, fn () => DB::table('class_group_members')->where('group_id', $wrong)->count()))->toBe(0);
    // The invoice it sat on is back to what it was.
    expect((int) asTenant($this->academy, fn () => DB::table('invoices')->where('guardian_id', $this->parent)->where('kind', 'AUTO')->sum('total_minor')))->toBe(0);

    // In the right group, a saved sheet makes it history: end it, never delete it.
    $this->postJson("/api/groups/{$right}/members", ['student_ids' => [$this->kids['Adam']], 'joined_on' => '2026-06-01'])->assertCreated();
    heldLesson($this, $right, '2026-06-15');
    expect(collect($this->getJson("/api/group-members?student_id={$this->kids['Adam']}")->json('members'))->first()['deletable'])->toBeFalse();
    $this->postJson("/api/groups/{$right}/members/{$this->kids['Adam']}/undo")->assertStatus(422)->assertJsonValidationErrors('membership');
    expect(groupLines($this, $right))->toHaveCount(1);
});

it('does not bill a group without a price, and bills it the moment it gets one', function () {
    $groupId = moneyGroup($this, ['price_minor' => null, 'student_ids' => [$this->kids['Adam']]]);
    expect(groupLines($this, $groupId))->toHaveCount(0);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/groups/{$groupId}", ['price_minor' => 40000])->assertOk();

    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(40000);
});

// ── MONTHLY by hours ─────────────────────────────────────────────────────────

it('by hours: the first month on joining, the next once the group has held its hours — absent or not', function () {
    // 2 hours a month; the group meets Mon + Wed for an hour from 1 June.
    $groupId = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 120, 'student_ids' => [$this->kids['Adam']]]);

    $lines = groupLines($this, $groupId);
    expect($lines)->toHaveCount(1);
    expect($lines->first()->description)->toBe('English A1 — month 1 (2 h)');
    expect((int) $lines->first()->group_cycle)->toBe(1);
    expect((int) $lines->first()->group_minutes)->toBe(120);
    expect((int) $lines->first()->amount_minor)->toBe(30000);

    // One hour used — absent, but the class happened. Nothing new.
    heldLesson($this, $groupId, '2026-06-01', [['student_id' => $this->kids['Adam'], 'status' => 'ABSENT']]);
    expect(groupLines($this, $groupId))->toHaveCount(1);

    Sanctum::actingAs($this->owner);
    $member = collect($this->getJson("/api/groups/{$groupId}")->assertOk()->json('group.members'))->first();
    expect($member['hour_month'])->toBe(['months' => 1, 'bought_minutes' => 120, 'used_minutes' => 60]);

    // The second hour uses the month up: the next one is raised by that lesson, up front.
    heldLesson($this, $groupId, '2026-06-03');
    $lines = groupLines($this, $groupId);
    expect($lines)->toHaveCount(2);
    expect($lines->last()->description)->toBe('English A1 — month 2 (2 h)');
    expect(Carbon::parse($lines->last()->group_period)->format('Y-m-d'))->toBe('2026-06-03');

    // However often the nightly job runs, nothing more until more hours are held.
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect(groupLines($this, $groupId))->toHaveCount(2);
    expect(groupLines($this, $groupId)->where('description', 'English A1 — June 2026'))->toHaveCount(0);
});

it('by hours: a join date moved back across held lessons counts them — the month runs out and the next is raised; past pay and sheets do not move (Lingo 2026-11-22)', function () {
    // 4 hours a month, Mon + Wed for an hour from 1 June. Adam was entered from the 3rd, but has
    // been in the class since the 1st.
    $groupId = moneyGroup($this, ['price_minor' => 48000, 'month_minutes' => 240, 'student_ids' => [$this->kids['Bassel']]]);
    heldLesson($this, $groupId, '2026-06-01');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Adam']], 'joined_on' => '2026-06-03'])->assertCreated();
    foreach (['2026-06-03', '2026-06-08', '2026-06-10'] as $d) {
        heldLesson($this, $groupId, $d);
    }
    $adamLines = fn () => groupLines($this, $groupId)->where('student_id', $this->kids['Adam'])->values();
    expect($adamLines())->toHaveCount(1); // 3 of his 4 hours used
    $pay = fn () => groupPayLines($this, $groupId)->sortBy('description')->map(fn ($l) => [(string) $l->class_group_lesson_id, (int) $l->amount_minor])->values()->all();
    $payBefore = $pay();
    $firstSheet = fn () => asTenant($this->academy, fn () => DB::table('class_group_attendance')->where('lesson_id', lessonOn($this, $groupId, '2026-06-01')->id)->pluck('student_id')->map(fn ($id) => (string) $id)->sort()->values()->all());
    $sheetBefore = $firstSheet();

    // Back to the 1st: across a held lesson, and allowed now.
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['joined_on' => '2026-06-01'])->assertOk();
    $lines = $adamLines();
    expect($lines)->toHaveCount(2)
        ->and($lines->last()->description)->toBe('English A1 — month 2 (4 h)')
        ->and(Carbon::parse($lines->last()->group_period)->format('Y-m-d'))->toBe('2026-06-10');
    expect($pay())->toBe($payBefore)->and($firstSheet())->toBe($sheetBefore);

    // Forward again across lessons he is on the sheet of: refused, nothing moves.
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['joined_on' => '2026-06-09'])
        ->assertStatus(422)->assertJsonValidationErrors('joined_on');
    expect(asTenant($this->academy, fn () => Carbon::parse(DB::table('class_group_members')->where('group_id', $groupId)->where('student_id', $this->kids['Adam'])->value('joined_on'))->format('Y-m-d')))->toBe('2026-06-01');
});

it('never moves a join date back over days the student already counted in an earlier membership of the group', function () {
    $groupId = moneyGroup($this, ['price_minor' => 48000, 'month_minutes' => 240, 'student_ids' => [$this->kids['Adam']]]);
    heldLesson($this, $groupId, '2026-06-01');
    Sanctum::actingAs($this->owner);
    // Left on the 3rd, back from the 8th; the 3rd was held while he was out.
    asTenant($this->academy, fn () => DB::table('class_group_members')->where('group_id', $groupId)->where('student_id', $this->kids['Adam'])
        ->update(['status' => 'LEFT', 'left_on' => '2026-06-03', 'left_reason' => 'Paused']));
    heldLesson($this, $groupId, '2026-06-03');
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Adam']], 'joined_on' => '2026-06-08'])->assertCreated();

    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['joined_on' => '2026-06-01'])
        ->assertStatus(422)->assertJsonValidationErrors('joined_on');
    // Back to the day he left is fine: nothing overlaps.
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['joined_on' => '2026-06-03'])->assertOk();
});

it('by hours: no next month once nothing is left to come', function () {
    // Two lessons in all (1 and 3 June) — exactly one month of two hours.
    $groupId = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 120, 'end_date' => '2026-06-03', 'student_ids' => [$this->kids['Adam']]]);

    heldLesson($this, $groupId, '2026-06-01');
    heldLesson($this, $groupId, '2026-06-03');

    expect(groupLines($this, $groupId))->toHaveCount(1);
});

it('by hours: switching a calendar group over starts on the 1st of next month, never paying June twice', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    expect(groupLines($this, $groupId)->pluck('description')->all())->toBe(['English A1 — June 2026']);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/groups/{$groupId}", ['month_minutes' => 120])->assertOk()
        ->assertJsonPath('group.pricing.month_minutes', 120);
    expect(Carbon::parse(asTenant($this->academy, fn () => DB::table('class_groups')->where('id', $groupId)->value('billing_rule_from')))->format('Y-m-d'))
        ->toBe('2026-07-01');
    heldLesson($this, $groupId, '2026-06-01');
    expect(groupLines($this, $groupId))->toHaveCount(1); // June stays the calendar month already paid

    Carbon::setTestNow('2026-07-01 03:00:00');
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));

    expect(groupLines($this, $groupId)->pluck('description')->all())->toBe(['English A1 — June 2026', 'English A1 — month 1 (2 h)']);
});

it('by hours: a member moved to another hours group takes their unused hours with them', function () {
    $from = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 120, 'student_ids' => [$this->kids['Adam']]]);
    $to = moneyGroup($this, ['name' => 'English A2', 'price_minor' => 30000, 'month_minutes' => 120]);
    heldLesson($this, $from, '2026-06-01'); // one of the two hours used

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$from}/members/{$this->kids['Adam']}/move", ['to_group_id' => $to, 'on' => '2026-06-03'])->assertOk();
    // The hour left over is spent in the new group first: no new month yet.
    expect(groupLines($this, $to))->toHaveCount(0);

    heldLesson($this, $to, '2026-06-03');
    $lines = groupLines($this, $to);
    expect($lines)->toHaveCount(1);
    expect($lines->first()->description)->toBe('English A2 — month 1 (2 h)');
    // …and the old group never bills them again.
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect(groupLines($this, $from))->toHaveCount(1);
});

it('by hours: only a monthly group keeps its hours', function () {
    Sanctum::actingAs($this->owner);
    $groupId = moneyGroup($this, ['billing_mode' => 'PER_LESSON', 'price_minor' => 8000, 'month_minutes' => 120]);

    $this->getJson("/api/groups/{$groupId}")->assertOk()->assertJsonPath('group.pricing.month_minutes', null);
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

it('no pay mode on the group, at a centre: a teacher paid per student earns their rate for each student who came', function () {
    asTenant($this->academy, fn () => app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['centre']));
    asTenant($this->academy, fn () => DB::table('teachers')->where('id', $this->teacher)->update(['pay_type' => 'PER_STUDENT']));
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);

    // 60 an hour per student, an hour's lesson, three came.
    heldLesson($this, $groupId, '2026-06-15');
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(18000);

    heldLesson($this, $groupId, '2026-06-15', [['student_id' => $this->kids['Adam'], 'status' => 'ABSENT']]);
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(12000);
});

it('no pay mode on the group, at any other academy: a teacher paid per student earns one rate for the lesson, as always', function () {
    asTenant($this->academy, fn () => DB::table('teachers')->where('id', $this->teacher)->update(['pay_type' => 'PER_STUDENT']));
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);

    heldLesson($this, $groupId, '2026-06-15');
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(6000);
});

it('no pay mode on the group: an hourly teacher earns the hour whatever the class size', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);

    heldLesson($this, $groupId, '2026-06-15');
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(6000);
});

it('a fixed amount per lesson, and nothing once the sheet is undone', function () {
    $groupId = moneyGroup($this, ['teacher_pay_mode' => 'PER_LESSON', 'teacher_pay_minor' => 9000, 'student_ids' => [$this->kids['Adam']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-15');
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(9000);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance/revert")->assertOk();
    expect(groupPayLines($this, $groupId))->toHaveCount(0);
});

it('corrects a sealed statement in place when a sheet is saved or undone after the seal', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $first = heldLesson($this, $groupId, '2026-06-15');
    $payoutId = groupPayLines($this, $groupId)->first()->payout_id;
    $sealedAt = '2026-07-03 02:30:00+02';
    asTenant($this->academy, fn () => DB::table('payouts')->where('id', $payoutId)->update(['finalized_at' => $sealedAt]));
    $statement = fn () => asTenant($this->academy, fn () => DB::table('payouts')->where('id', $payoutId)->first());
    $sealed = $statement()->finalized_at;

    // A lesson of the sealed month marked now: lingo's "the 29th won't save".
    Carbon::setTestNow('2026-07-05 12:00:00');
    heldLesson($this, $groupId, '2026-06-17');
    expect(groupPayLines($this, $groupId))->toHaveCount(2)
        ->and((int) $statement()->total_minor)->toBe(12000)
        ->and($statement()->finalized_at)->toBe($sealed);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$first->id}/attendance/revert")->assertOk();
    expect(lessonOn($this, $groupId, '2026-06-15')->status)->toBe('SCHEDULED')
        ->and(groupPayLines($this, $groupId))->toHaveCount(1)
        ->and((int) $statement()->total_minor)->toBe(6000)
        ->and($statement()->finalized_at)->toBe($sealed);
});

it('leaves a statement paid from the treasury as paid: a new lesson goes on the next one, an undo is refused', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $first = heldLesson($this, $groupId, '2026-06-15');
    $payoutId = groupPayLines($this, $groupId)->first()->payout_id;
    asTenant($this->academy, function () use ($payoutId): void {
        DB::table('payouts')->where('id', $payoutId)->update(['finalized_at' => now()]);
        $account = (string) Str::uuid();
        DB::table('cash_accounts')->insert(['id' => $account, 'academy_id' => $this->academy, 'name' => 'Drawer', 'kind' => 'CASH', 'currency' => 'EGP', 'opening_on' => '2026-01-01']);
        $category = (string) Str::uuid();
        DB::table('expense_categories')->insert(['id' => $category, 'academy_id' => $this->academy, 'name' => 'Salaries']);
        DB::table('expenses')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'number' => 'E-1', 'spent_on' => '2026-06-15', 'category_id' => $category,
            'amount_minor' => 100, 'currency' => 'EGP', 'cash_account_id' => $account, 'payout_id' => $payoutId,
        ]);
    });
    Carbon::setTestNow('2026-07-05 12:00:00');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$first->id}/attendance/revert")->assertStatus(422);
    expect(lessonOn($this, $groupId, '2026-06-15')->status)->toBe('HELD');

    heldLesson($this, $groupId, '2026-06-17');
    $lines = groupPayLines($this, $groupId);
    expect($lines)->toHaveCount(2);
    $later = $lines->firstWhere('payout_id', '!=', $payoutId);
    expect((int) $later->amount_minor)->toBe(6000)
        ->and($later->finalized_at)->toBeNull()
        ->and(Carbon::parse($later->session_date)->format('Y-m-d'))->toBe('2026-06-17');
});

it('lets a centre date a member before its running group started, without billing what the group never ran', function () {
    Carbon::setTestNow('2026-06-20 12:00:00');
    asTenant($this->academy, function (): void {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['centre']);
    });
    $groupId = moneyGroup($this, ['start_date' => '2026-06-10', 'student_ids' => [$this->kids['Adam']]]);
    $before = groupLines($this, $groupId)->count();

    Sanctum::actingAs($this->owner);
    // Before the group's start, in a month it did not run in: the date stands, nothing new is owed.
    $res = $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['joined_on' => '2026-05-20'])->assertOk();
    expect(collect($res->json('group.members'))->firstWhere('student_id', $this->kids['Adam'])['joined_on'])->toBe('2026-05-20')
        ->and(groupLines($this, $groupId))->toHaveCount($before);

    // A new member too, on a group already running.
    $res = $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Dina']], 'joined_on' => '2026-06-02'])->assertCreated();
    expect(asTenant($this->academy, fn () => Carbon::parse(DB::table('class_group_members')->where('group_id', $groupId)->where('student_id', $this->kids['Dina'])->value('joined_on'))->format('Y-m-d')))->toBe('2026-06-02');

    // A group yet to start keeps its floor.
    $future = moneyGroup($this, ['name' => 'Later', 'start_date' => '2026-08-01']);
    $this->postJson("/api/groups/{$future}/members", ['student_ids' => [$this->kids['Bassel']], 'joined_on' => '2026-06-20'])->assertCreated();
    expect(asTenant($this->academy, fn () => Carbon::parse(DB::table('class_group_members')->where('group_id', $future)->value('joined_on'))->format('Y-m-d')))->toBe('2026-08-01');
});

it('keeps the start date as the floor for an academy that is not a centre', function () {
    Carbon::setTestNow('2026-06-20 12:00:00');
    $groupId = moneyGroup($this, ['start_date' => '2026-06-10', 'student_ids' => [$this->kids['Adam']]]);

    Sanctum::actingAs($this->owner);
    $res = $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['joined_on' => '2026-06-02'])->assertOk();
    expect(collect($res->json('group.members'))->firstWhere('student_id', $this->kids['Adam'])['joined_on'])->toBe('2026-06-10');
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

it('keeps prices away from a role that may not price, and shows them to the supervisor', function () {
    $groupId = moneyGroup($this, ['teacher_pay_mode' => 'PER_LESSON', 'teacher_pay_minor' => 9000]);

    // The front desk reads the group, never its price or the teacher's pay.
    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-money@test.local']));
    $group = $this->getJson("/api/groups/{$groupId}")->assertOk()->json('group');
    expect($group['pricing'])->toBeNull();
    expect($group['teacher_pay'])->toBeNull();

    // The supervisor enrols people with their prices — groups included.
    Sanctum::actingAs($this->supervisor);
    $group = $this->getJson("/api/groups/{$groupId}")->assertOk()->json('group');
    expect($group['pricing']['price_minor'])->toBe(45000);
    expect($group['teacher_pay']['amount_minor'])->toBe(9000);
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

    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-group-money@test.local']));
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

it('by hours: a student alone in the class is counted the solo length, while the teacher is paid the real one', function () {
    // 2 hours a month, hour-long lessons; alone, a lesson counts as 90 minutes of the hours bought.
    $groupId = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 120, 'solo_billed_minutes' => 90, 'student_ids' => [$this->kids['Adam']]]);
    expect($this->getJson("/api/groups/{$groupId}")->assertOk()->json('group.pricing.solo_billed_minutes'))->toBe(90);

    heldLesson($this, $groupId, '2026-06-01');
    Sanctum::actingAs($this->owner);
    $member = collect($this->getJson("/api/groups/{$groupId}")->assertOk()->json('group.members'))->first();
    expect($member['hour_month'])->toBe(['months' => 1, 'bought_minutes' => 120, 'used_minutes' => 90]);
    // The teacher's line is the 60 minutes that happened: 60/h → 60.
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(6000);

    // A second student joins: from then on a lesson counts its real length again.
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Bassel']], 'joined_on' => '2026-06-03'])->assertCreated();
    heldLesson($this, $groupId, '2026-06-03');
    Sanctum::actingAs($this->owner);
    $adam = collect($this->getJson("/api/groups/{$groupId}")->assertOk()->json('group.members'))->firstWhere('full_name', 'Adam');
    // 90 + 60 = 150 > 120: the second month was raised by that lesson.
    expect($adam['hour_month'])->toBe(['months' => 2, 'bought_minutes' => 240, 'used_minutes' => 150]);
});

// ── One student off one lesson ───────────────────────────────────────────────

it('moves a join date when no held lesson lies between the two dates, even after one was held', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    heldLesson($this, $groupId, '2026-06-01');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Dina']], 'joined_on' => '2026-06-24'])->assertCreated();
    // Entered for the 24th, but she starts today: the lesson held on the 1st is before both dates.
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Dina']}", ['joined_on' => '2026-06-17'])->assertOk();
    expect(collect(lessonSheet($this, lessonOn($this, $groupId, '2026-06-17')->id))->pluck('student_id'))->toContain($this->kids['Dina']);

    // Back across a held lesson (Lingo 2026-11-22: "she was there from the start"): allowed — that
    // lesson's sheet now expects her, unmarked, for the office to mark.
    heldLesson($this, $groupId, '2026-06-15');
    $this->patchJson("/api/groups/{$groupId}/members/{$this->kids['Dina']}", ['joined_on' => '2026-06-15'])->assertOk();
    expect(collect(lessonSheet($this, lessonOn($this, $groupId, '2026-06-15')->id))->pluck('student_id'))->toContain($this->kids['Dina']);
});

if (! function_exists('lessonSheet')) {
    function lessonSheet($test, string $lessonId): array
    {
        Sanctum::actingAs($test->owner);

        return $test->getJson("/api/group-lessons/{$lessonId}")->assertOk()->json('roster');
    }
}

it('takes a student off one held lesson: no mark, no charge, no pay — a re-save keeps them off, reverting brings them back', function () {
    $groupId = moneyGroup($this, ['billing_mode' => 'PER_LESSON', 'price_minor' => 8000,
        'teacher_pay_mode' => 'PER_STUDENT', 'teacher_pay_minor' => 1500,
        'student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Celine']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-15', [['student_id' => $this->kids['Celine'], 'status' => 'ABSENT']]);
    expect(groupLines($this, $groupId))->toHaveCount(2);
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(3000);

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/group-lessons/{$lesson->id}/students/{$this->kids['Bassel']}/remove")->assertOk();
    expect(collect($res->json('roster'))->pluck('student_id')->all())->not->toContain($this->kids['Bassel']);
    expect($res->json('lesson.counts.expected'))->toBe(2);
    expect(groupLines($this, $groupId)->pluck('student_id')->all())->toBe([$this->kids['Adam']]);
    expect((int) groupPayLines($this, $groupId)->first()->amount_minor)->toBe(1500);
    expect(asTenant($this->academy, fn () => DB::table('class_group_attendance')->where('lesson_id', $lesson->id)->where('student_id', $this->kids['Bassel'])->exists()))->toBeFalse();

    // Editing the sheet again does not bring them back, and sending them is refused.
    heldLesson($this, $groupId, '2026-06-15');
    expect(collect(lessonSheet($this, $lesson->id))->pluck('student_id')->all())->not->toContain($this->kids['Bassel']);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", ['entries' => [['student_id' => $this->kids['Bassel'], 'status' => 'PRESENT']]])->assertStatus(422);
    // Already off: nothing to take off.
    $this->postJson("/api/group-lessons/{$lesson->id}/students/{$this->kids['Bassel']}/remove")->assertNotFound();
    // Other lessons still expect them.
    expect(collect(lessonSheet($this, lessonOn($this, $groupId, '2026-06-17')->id))->pluck('student_id'))->toContain($this->kids['Bassel']);

    // Reverting the sheet is the way back.
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance/revert")->assertOk();
    expect(collect(lessonSheet($this, $lesson->id))->pluck('student_id'))->toContain($this->kids['Bassel']);
});

it('takes a former member off a sheet they are still on', function () {
    $groupId = moneyGroup($this, ['billing_mode' => 'PER_LESSON', 'price_minor' => 8000,
        'student_ids' => [$this->kids['Adam'], $this->kids['Bassel']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-15');

    // Left the group from the 1st — the saved sheet still shows them, as a former member.
    asTenant($this->academy, fn () => DB::table('class_group_members')->where('group_id', $groupId)->where('student_id', $this->kids['Bassel'])
        ->update(['status' => 'LEFT', 'left_on' => '2026-06-01']));
    $row = collect(lessonSheet($this, $lesson->id))->firstWhere('student_id', $this->kids['Bassel']);
    expect($row['member'])->toBeFalse();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/students/{$this->kids['Bassel']}/remove")->assertOk();
    expect(collect(lessonSheet($this, $lesson->id))->pluck('student_id')->all())->toBe([$this->kids['Adam']]);
    expect(groupLines($this, $groupId)->pluck('student_id')->all())->toBe([$this->kids['Adam']]);
});

it('by hours: a lesson a student was taken off uses none of their hours', function () {
    $groupId = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 120, 'student_ids' => [$this->kids['Adam'], $this->kids['Bassel']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-01');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/students/{$this->kids['Adam']}/remove")->assertOk();
    heldLesson($this, $groupId, '2026-06-03');

    $members = collect($this->getJson("/api/groups/{$groupId}")->assertOk()->json('group.members'))->keyBy('student_id');
    expect($members[$this->kids['Adam']]['hour_month']['used_minutes'])->toBe(60);
    expect($members[$this->kids['Bassel']]['hour_month']['used_minutes'])->toBe(120);
    // Bassel used his two hours up (month 2 raised); Adam has one left.
    expect(groupLines($this, $groupId)->where('student_id', $this->kids['Adam']))->toHaveCount(1);
    expect(groupLines($this, $groupId)->where('student_id', $this->kids['Bassel']))->toHaveCount(2);
});

it('only a group manager takes a student off a lesson', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $lesson = heldLesson($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/group-lessons/{$lesson->id}/students/{$this->kids['Adam']}/remove")->assertForbidden();
});

// ── The two-month offer, taken at the desk per subject (lingo 2026-11-09) ─────────

function accountingOn($test): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$test->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($test->academy, 'MANAGEMENT', [], ['accounting']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

it('two-month offer at the desk: one subject’s month becomes this month and the next for the amount paid; the other subject is untouched', function () {
    accountingOn($this);
    $english = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $maths = moneyGroup($this, ['name' => 'Maths', 'student_ids' => [$this->kids['Adam']]]);
    $june = groupLines($this, $english)->first();

    Sanctum::actingAs($this->owner);
    $account = $this->getJson("/api/payer-account?guardian_id={$this->parent}")->assertOk()->json('lines');
    expect(collect($account)->firstWhere('id', $june->id)['group_months'])->toBeNull();
    $this->postJson('/api/receipts', [
        'guardian_id' => $this->parent, 'amount_minor' => 80000, 'currency' => 'EGP', 'method' => 'CASH', 'apply_rest' => false,
        'two_month_offers' => [['line_id' => $june->id, 'amount_minor' => 80000]],
    ])->assertCreated();

    $line = groupLines($this, $english)->first();
    expect((int) $line->amount_minor)->toBe(80000)
        ->and((int) $line->group_months)->toBe(2)
        ->and($line->description)->toContain('July 2026')
        ->and((int) asTenant($this->academy, fn () => DB::table('receipt_allocations')->where('invoice_line_id', $june->id)->sum('amount_minor')))->toBe(80000);
    // Maths is still its own month, unpaid.
    expect(groupLines($this, $maths)->pluck('amount_minor')->map(fn ($a) => (int) $a)->all())->toBe([45000]);

    // July: English is paid for, Maths is charged. August: English charged again as usual.
    Carbon::setTestNow('2026-07-01 03:00:00');
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect(groupLines($this, $english))->toHaveCount(1)->and(groupLines($this, $maths))->toHaveCount(2);
    Carbon::setTestNow('2026-08-01 03:00:00');
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect(groupLines($this, $english)->pluck('amount_minor')->map(fn ($a) => (int) $a)->all())->toBe([80000, 45000]);
});

it('two-month offer by hours: the charge buys twice the hours, the next one comes after them', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 120, 'student_ids' => [$this->kids['Adam']]]);
    $first = groupLines($this, $groupId)->first();
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', [
        'guardian_id' => $this->parent, 'amount_minor' => 50000, 'currency' => 'EGP', 'method' => 'CASH',
        'two_month_offers' => [['line_id' => $first->id, 'amount_minor' => 50000]],
    ])->assertCreated();
    expect((int) groupLines($this, $groupId)->first()->group_minutes)->toBe(240);

    foreach (['2026-06-01', '2026-06-03', '2026-06-08'] as $d) {
        heldLesson($this, $groupId, $d);
    }
    expect(groupLines($this, $groupId))->toHaveCount(1);
    heldLesson($this, $groupId, '2026-06-10');
    $lines = groupLines($this, $groupId);
    expect($lines)->toHaveCount(2)
        ->and((int) $lines->last()->amount_minor)->toBe(30000)
        ->and((int) $lines->last()->group_minutes)->toBe(120);
});

it('two-month offer: refused once next month is charged, or on a charge that is not a monthly group', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $june = groupLines($this, $groupId)->first();
    Carbon::setTestNow('2026-07-01 03:00:00');
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', [
        'guardian_id' => $this->parent, 'amount_minor' => 80000, 'currency' => 'EGP', 'method' => 'CASH',
        'two_month_offers' => [['line_id' => $june->id, 'amount_minor' => 80000]],
    ])->assertStatus(422)->assertJsonValidationErrors('two_month_offers');
    // Nothing half-done: no receipt, the line as it was.
    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(45000)
        ->and(asTenant($this->academy, fn () => DB::table('receipts')->count()))->toBe(0);
});

it('two-month offer (lingo 2026-11-15): a pro-rated first month + one FULL month, the family discount kept on the bill, the offer discount off the quote', function () {
    accountingOn($this);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'PERCENT', 'value' => 10, 'label' => 'خصم اخوات', 'scope' => 'GROUP', 'starts_on' => '2026-06-01'])->assertCreated();
    $groupId = moneyGroup($this);
    // Joins today (Wed 17th): June is 4 of 9 lessons = 200, 180 after the family's 10%.
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Adam']], 'joined_on' => '2026-06-17'])->assertCreated();
    $june = groupLines($this, $groupId)->first();
    expect((int) $june->list_amount_minor)->toBe(20000)->and((int) $june->amount_minor)->toBe(18000);

    // The screen gets the server's price: 200 + a full 450 = 650, less 20 + 45 of the family discount.
    $quote = collect($this->getJson("/api/payer-account?guardian_id={$this->parent}")->assertOk()->json('lines'))->firstWhere('id', $june->id)['two_month'];
    expect($quote)->toBe(['list_minor' => 65000, 'family_discount_minor' => 6500, 'family_label' => 'خصم اخوات', 'amount_minor' => 58500]);

    $this->postJson('/api/receipts', [
        'guardian_id' => $this->parent, 'amount_minor' => 48500, 'currency' => 'EGP', 'method' => 'CASH', 'apply_rest' => false,
        'two_month_offers' => [['line_id' => $june->id, 'discount_minor' => 10000]],
    ])->assertCreated();
    $line = groupLines($this, $groupId)->first();
    expect((int) $line->amount_minor)->toBe(48500)
        ->and((int) $line->group_months)->toBe(2)
        ->and((int) $line->list_amount_minor)->toBe(65000)
        ->and((int) $line->discount_minor)->toBe(16500)
        ->and($line->discount_label)->toBe('خصم اخوات + عرض شهرين');
});

it('two-month offer: a family discount added, ended or cancelled later never re-prices the agreed two months', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $june = groupLines($this, $groupId)->first();
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', [
        'guardian_id' => $this->parent, 'amount_minor' => 80000, 'currency' => 'EGP', 'method' => 'CASH',
        'two_month_offers' => [['line_id' => $june->id, 'discount_minor' => 10000]],
    ])->assertCreated();
    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(80000);

    $id = $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'PERCENT', 'value' => 10, 'label' => 'خصم اخوات', 'apply_to_existing' => true])->assertCreated()->json('id');
    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(80000);
    $this->postJson("/api/accounting/family/{$this->parent}/discounts/{$id}/apply-existing")->assertSuccessful();
    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(80000);
    $this->deleteJson("/api/accounting/family/{$this->parent}/discounts/{$id}")->assertSuccessful();
    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(80000);
});

it('two-month offer: the account offers it only where it would go through (not on a month whose next is raised)', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    Carbon::setTestNow('2026-07-01 03:00:00');
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    [$june, $july] = [groupLines($this, $groupId)[0], groupLines($this, $groupId)[1]];

    Sanctum::actingAs($this->owner);
    $lines = collect($this->getJson("/api/payer-account?guardian_id={$this->parent}")->assertOk()->json('lines'))->keyBy('id');
    expect($lines[$june->id]['two_month'])->toBeNull()
        ->and($lines[$july->id]['two_month']['amount_minor'])->toBe(90000);
});

it('two-month offer from credit: a subject already paid this month takes the next month with no new money; the credit pays it', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $june = groupLines($this, $groupId)->first();
    Sanctum::actingAs($this->owner);
    // 450 for June + 450 kept as credit.
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 90000, 'currency' => 'EGP', 'method' => 'CASH'])->assertCreated();

    $account = $this->getJson("/api/payer-account?guardian_id={$this->parent}")->assertOk()->json();
    expect($account['lines'])->toBe([])
        ->and($account['offer_lines'][0]['id'])->toBe($june->id)
        ->and($account['offer_lines'][0]['two_month']['amount_minor'])->toBe(90000);

    $this->postJson('/api/two-month-offers', ['line_id' => $june->id, 'discount_minor' => 5000])->assertOk()
        ->assertJsonPath('amount_minor', 85000)
        ->assertJsonPath('balance.0.due_minor', 0)
        ->assertJsonPath('balance.0.credit_minor', 5000);
    $line = groupLines($this, $groupId)->first();
    expect((int) $line->group_months)->toBe(2)
        ->and((int) asTenant($this->academy, fn () => DB::table('receipt_allocations')->where('invoice_line_id', $june->id)->sum('amount_minor')))->toBe(85000);

    // A teacher (no invoice.mark_paid) can't.
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/two-month-offers', ['line_id' => $june->id])->assertForbidden();
});

it('a student paused for not paying and brought back to an hours group continues the lessons already paid (Lingo 2026-11-15)', function () {
    // Mon + Wed, 4 hours a month of 60-minute lessons.
    Carbon::setTestNow('2026-06-01 06:00:00');
    $groupId = moneyGroup($this, ['price_minor' => 30000, 'month_minutes' => 240, 'student_ids' => [$this->kids['Adam']]]);
    expect(groupLines($this, $groupId))->toHaveCount(1);
    Carbon::setTestNow('2026-06-04 09:00:00');
    heldLesson($this, $groupId, '2026-06-01');
    heldLesson($this, $groupId, '2026-06-03');

    // Taken off the group on the 4th (2 of the 4 paid lessons used), brought back on the 10th.
    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['left_on' => '2026-06-04', 'reason' => 'PAUSED'])->assertSuccessful();
    Carbon::setTestNow('2026-06-10 06:00:00');
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->kids['Adam']], 'joined_on' => '2026-06-10'])->assertCreated();
    // No new charge: two paid lessons are still his.
    expect(groupLines($this, $groupId))->toHaveCount(1);

    // The 8th (while away) doesn't count; the 10th and 15th use up what was paid, then month 2 is raised.
    Carbon::setTestNow('2026-06-15 20:00:00');
    heldLesson($this, $groupId, '2026-06-10');
    expect(groupLines($this, $groupId))->toHaveCount(1);
    heldLesson($this, $groupId, '2026-06-15');
    expect(groupLines($this, $groupId))->toHaveCount(2);
});

// ── Leaving a group with lessons paid and not taken (Lingo 2026-11-15) ───────────

it('leaving an hours group: says how many lessons are left and their worth, and gives them back as the family\'s credit', function () {
    accountingOn($this);
    Carbon::setTestNow('2026-06-01 06:00:00');
    // 4 hours a month at 400 = 100 a lesson.
    $groupId = moneyGroup($this, ['price_minor' => 40000, 'month_minutes' => 240, 'student_ids' => [$this->kids['Adam']]]);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 40000, 'currency' => 'EGP', 'method' => 'CASH'])->assertCreated();
    Carbon::setTestNow('2026-06-04 09:00:00');
    heldLesson($this, $groupId, '2026-06-01');
    heldLesson($this, $groupId, '2026-06-03');

    Sanctum::actingAs($this->owner);
    $quote = $this->getJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}/leave-quote?left_on=2026-06-04")->assertOk()->json('quote');
    expect($quote)->toMatchArray(['kind' => 'HOURS', 'attended' => 2, 'remaining' => 2, 'unused_minor' => 20000, 'paid_minor' => 40000, 'refundable_minor' => 20000]);

    $this->deleteJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['left_on' => '2026-06-04', 'reason' => 'STOPPED', 'settlement' => 'CREDIT'])
        ->assertOk()->assertJsonPath('settlement.mode', 'CREDIT')->assertJsonPath('settlement.amount_minor', 20000);
    $line = groupLines($this, $groupId)->first();
    expect((int) $line->amount_minor)->toBe(20000)->and((int) $line->group_minutes)->toBe(120);
    expect($this->getJson("/api/payer-account?guardian_id={$this->parent}")->json('balance.0.credit_minor'))->toBe(20000);
});

it('leaving mid-month: the month\'s lessons from that day are paid back in cash from a treasury account', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    Sanctum::actingAs($this->owner);
    $drawer = $this->postJson('/api/treasury/accounts', ['name' => 'Drawer', 'kind' => 'CASH', 'methods' => ['CASH'], 'opening_on' => '2026-06-01'])->assertCreated()->json('id');
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'currency' => 'EGP', 'method' => 'CASH'])->assertCreated();

    // Today the 17th: 17, 22, 24, 29 are left of June's 9 lessons → 200 of the 450.
    $quote = $this->getJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}/leave-quote")->assertOk()->json();
    expect($quote['quote'])->toMatchArray(['kind' => 'MONTH', 'attended' => 5, 'remaining' => 4, 'unused_minor' => 20000, 'refundable_minor' => 20000])
        ->and($quote['accounts'][0]['id'])->toBe($drawer);
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['settlement' => 'REFUND', 'cash_account_id' => $drawer])
        ->assertOk()->assertJsonPath('settlement.refunded_minor', 20000);
    expect((int) groupLines($this, $groupId)->first()->amount_minor)->toBe(25000);
    $account = collect($this->getJson('/api/treasury')->json('accounts'))->firstWhere('id', $drawer);
    expect($account['balance_minor'])->toBe(25000);
    expect($this->getJson("/api/payer-account?guardian_id={$this->parent}")->json('balance'))->toBe([]);
});

it('leaving and keeping the charge as it was changes no money; a teacher may not settle', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam'], $this->kids['Bassel']]]);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 90000, 'currency' => 'EGP', 'method' => 'CASH'])->assertCreated();
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->kids['Adam']}", ['settlement' => 'KEEP'])->assertOk()->assertJsonPath('settlement.mode', 'KEEP');
    expect(groupLines($this, $groupId)->pluck('amount_minor')->map(fn ($a) => (int) $a)->all())->toBe([45000, 45000]);

    Sanctum::actingAs($this->teacherUser);
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->kids['Bassel']}", ['settlement' => 'CREDIT'])->assertForbidden();
});

// ── One trial lesson in a group (Lingo 2026-11-15) ────────────────────────────

it('books one trial lesson in an hours group at the group\'s lesson price: on that sheet only, never billed a month', function () {
    accountingOn($this);
    // 4 hours a month at 400 → a 60-minute lesson is 100.
    $groupId = moneyGroup($this, ['price_minor' => 40000, 'month_minutes' => 240, 'student_ids' => [$this->kids['Adam']]]);
    $lesson = lessonOn($this, $groupId, '2026-06-22');
    Sanctum::actingAs($this->owner);
    expect($this->getJson("/api/groups/{$groupId}/trial-price?lesson_id={$lesson->id}")->assertOk()->json('amount_minor'))->toBe(10000);

    $this->postJson("/api/groups/{$groupId}/trial", ['student_id' => $this->kids['Bassel'], 'lesson_id' => $lesson->id])->assertCreated()->assertJsonPath('trial.amount_minor', 10000);
    $bassel = groupLines($this, $groupId)->where('student_id', $this->kids['Bassel'])->values();
    expect($bassel)->toHaveCount(1)
        ->and($bassel[0]->group_charge)->toBe('LESSON')
        ->and((int) $bassel[0]->amount_minor)->toBe(10000);

    // On the 22nd's sheet, not the 24th's; the nightly run and the sheet never bill him a month.
    Carbon::setTestNow('2026-06-22 20:00:00');
    heldLesson($this, $groupId, '2026-06-22');
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect(groupLines($this, $groupId)->where('student_id', $this->kids['Bassel'])->count())->toBe(1);
    $sheet = fn (string $d) => collect($this->getJson('/api/group-lessons/'.lessonOn($this, $groupId, $d)->id)->assertOk()->json('roster'))->pluck('student_id')->all();
    expect($sheet('2026-06-22'))->toContain($this->kids['Bassel'])
        ->and($sheet('2026-06-24'))->not->toContain($this->kids['Bassel']);

    // Already in the group: no trial.
    $this->postJson("/api/groups/{$groupId}/trial", ['student_id' => $this->kids['Adam'], 'lesson_id' => $lesson->id])->assertStatus(422);
});

it('prices a trial lesson in a calendar-month group as the month\'s price over its lessons', function () {
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    $lesson = lessonOn($this, $groupId, '2026-06-22');
    Sanctum::actingAs($this->owner);
    // 450 over June's 9 lessons.
    expect($this->getJson("/api/groups/{$groupId}/trial-price?lesson_id={$lesson->id}")->assertOk()->json('amount_minor'))->toBe(5000);
});

// ── Money from an unknown payer (lingo 2026-11-09) ───────────────────────────

it('keeps money from an unknown payer apart until it is assigned, then it pays that family', function () {
    accountingOn($this);
    $groupId = moneyGroup($this, ['student_ids' => [$this->kids['Adam']]]);
    Sanctum::actingAs($this->owner);
    $id = $this->postJson('/api/receipts', ['unknown_payer' => true, 'amount_minor' => 45000, 'currency' => 'EGP', 'method' => 'CASH', 'reference' => 'Transfer 11:20'])
        ->assertCreated()->assertJsonPath('receipt.payer_unknown', true)->assertJsonPath('receipt.allocated_minor', 0)->json('receipt.id');
    // It pays nobody yet: Adam's June is still owed; it is listed under "unknown".
    expect((int) asTenant($this->academy, fn () => DB::table('receipt_allocations')->count()))->toBe(0);
    expect(collect($this->getJson('/api/receipts?status=unknown')->assertOk()->json('receipts'))->pluck('id')->all())->toBe([$id]);

    $line = groupLines($this, $groupId)->first();
    $this->postJson("/api/receipts/{$id}/assign", ['guardian_id' => $this->parent, 'line_ids' => [$line->id]])
        ->assertOk()->assertJsonPath('receipt.payer_unknown', false)->assertJsonPath('receipt.allocated_minor', 45000);
    expect($this->getJson('/api/receipts?status=unknown')->json('receipts'))->toBe([]);
    // Once only.
    $this->postJson("/api/receipts/{$id}/assign", ['guardian_id' => $this->parent])->assertStatus(422);
});
