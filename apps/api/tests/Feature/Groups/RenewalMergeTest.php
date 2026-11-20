<?php

declare(strict_types=1);

use App\Jobs\BillGroupMonthsJob;
use App\Services\ClassGroups;
use App\Services\GroupBilling;
use App\Services\GroupLessonGenerator;
use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * `groups:merge-renewals` (Lingo, 2026-11-20). Renewing used to open a new group and archive the
 * old one. Pinned here, on a class split exactly the way that renewal split it:
 *   - the old group runs again with the new term's settings, and the new group is gone;
 *   - everyone moved is a member again without a break, so the lesson held on the term's last day
 *     counts — and whoever has thereby used up their month is raised the next one;
 *   - the new term's charges become the old group's next months, priced again under the family's
 *     discount (which names the old group), and the money paid on them stays put;
 *   - a dry run saves nothing; a second run finds nothing to fold.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo. June's Mondays + Wednesdays: 1 3 8 10 15 17 22 24 29.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-merge@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Parent of two']);
    $this->kids = [];
    foreach (['Adam', 'Bassel'] as $name) {
        $this->kids[$name] = $this->createStudent($this->academy, $this->parent, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    foreach (['Celine', 'Dina'] as $name) {
        $this->kids[$name] = $this->createStudent($this->academy, null, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    $this->clearTenantContext();

    rmCtx($this->academy, fn () => app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['accounting']));
});

afterEach(fn () => Carbon::setTestNow());

function rmCtx(string $academyId, callable $fn): mixed
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        return $fn();
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

/** A month is 4 hours for 480; Mondays and Wednesdays for an hour, from 1 June. */
function rmGroup($test, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', array_merge([
        'name' => 'English', 'teacher_id' => $test->teacher, 'start_date' => '2026-06-01',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ],
        'billing_mode' => 'MONTHLY', 'price_minor' => 48000, 'currency' => 'EGP', 'month_minutes' => 240,
    ], $over))->assertCreated()->json('group.id');
}

function rmHold($test, string $groupId, array $dates): void
{
    Sanctum::actingAs($test->owner);
    foreach ($dates as $date) {
        $lessonId = rmCtx($test->academy, fn () => DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', $date)->value('id'));
        $test->postJson("/api/group-lessons/{$lessonId}/attendance", ['entries' => []])->assertOk();
    }
}

/** @return list<array{student:string, cycle:int, amount:int, period:string}> */
function rmLines($test, string $groupId): array
{
    $names = array_flip($test->kids);

    return rmCtx($test->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $groupId)
        ->orderBy('student_id')->orderBy('group_cycle')->get()
        ->map(fn ($l) => ['student' => $names[(string) $l->student_id], 'cycle' => (int) $l->group_cycle, 'amount' => (int) $l->amount_minor,
            'period' => Carbon::parse($l->group_period)->format('Y-m-d')])
        ->sortBy(fn ($l) => $l['student'].$l['cycle'])->values()->all());
}

/** @return list<array{name:string, status:string, joined_on:string, left_on:?string, left_reason:?string, carried:int}> */
function rmMembers($test, string $groupId): array
{
    return rmCtx($test->academy, fn () => DB::table('class_group_members as m')->join('students as st', 'st.id', '=', 'm.student_id')
        ->where('m.group_id', $groupId)->orderBy('st.full_name')->orderBy('m.joined_on')
        ->get(['st.full_name', 'm.status', 'm.joined_on', 'm.left_on', 'm.left_reason', 'm.carried_minutes'])
        ->map(fn ($m) => [
            'name' => $m->full_name, 'status' => $m->status, 'joined_on' => Carbon::parse($m->joined_on)->format('Y-m-d'),
            'left_on' => $m->left_on !== null ? Carbon::parse($m->left_on)->format('Y-m-d') : null,
            'left_reason' => $m->left_reason, 'carried' => (int) $m->carried_minutes,
        ])->all());
}

/**
 * What renewing did before 2026-11-20, step for step: a new group that continues the old one, the
 * members ended in the old one ON its end date and added to the new one with the hours they had
 * left, and the old one archived RENEWED.
 *
 * @param  list<string>  $keep  student ids taken on to the new term
 */
function rmSplitLikeTheOldRenewal($test, string $oldId, array $keep, array $newTerm = []): string
{
    return rmCtx($test->academy, function () use ($test, $oldId, $keep, $newTerm): string {
        $groups = app(ClassGroups::class);
        $old = DB::table('class_groups')->where('id', $oldId)->first();
        $newId = (string) Str::uuid();
        $row = array_diff_key((array) $old, array_flip(['id', 'created_at', 'updated_at', 'archived_at', 'closed_reason']));
        DB::table('class_groups')->insert(array_merge($row, [
            'id' => $newId, 'start_date' => '2026-06-20', 'end_date' => '2026-08-15', 'continues_group_id' => $oldId, 'status' => 'ACTIVE',
        ], $newTerm));
        $groups->reconcileSlots($test->academy, $newId, $groups->slotsOf($oldId));
        app(GroupLessonGenerator::class)->regenerate($newId, backfill: true);
        $new = DB::table('class_groups')->where('id', $newId)->first();

        $leftOn = Carbon::parse($old->end_date)->format('Y-m-d'); // the old leave date: the end day itself
        foreach (DB::table('class_group_members')->where('group_id', $oldId)->where('status', 'ACTIVE')->pluck('student_id') as $studentId) {
            $groups->removeMember($old, (string) $studentId, $leftOn, 'Renewed into '.$new->name, (string) $test->owner->getKey(), 'ACADEMY_OWNER');
        }
        $groups->addMembers($new, $keep, '2026-06-20', false, (string) $test->owner->getKey(), 'ACADEMY_OWNER', movedFromGroup: $oldId);

        DB::table('class_groups')->where('id', $oldId)->update(['status' => 'ARCHIVED', 'archived_at' => now(), 'closed_reason' => 'RENEWED']);
        app(GroupLessonGenerator::class)->regenerate($oldId);

        return $newId;
    });
}

it('folds a renewed class back into its group: members, the last day\'s lesson, charges under the family discount, and the money paid', function () {
    Sanctum::actingAs($this->owner);

    // English ends ON its fourth lesson (10 June); Maths two days after it (12 June).
    $english = rmGroup($this, ['end_date' => '2026-06-10']);
    $maths = rmGroup($this, ['name' => 'Maths', 'end_date' => '2026-06-12']);
    // The family has 10% off these two groups, by name.
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", [
        'kind' => 'PERCENT', 'value' => 10, 'label' => 'Siblings', 'scope' => 'GROUP', 'starts_on' => '2026-06-01',
        'targets' => [['class_group_id' => $english], ['class_group_id' => $maths]],
    ])->assertCreated();
    $this->postJson("/api/groups/{$english}/members", ['student_ids' => [$this->kids['Adam'], $this->kids['Bassel'], $this->kids['Dina']], 'joined_on' => '2026-06-01'])->assertCreated();
    $this->postJson("/api/groups/{$maths}/members", ['student_ids' => [$this->kids['Adam'], $this->kids['Celine']], 'joined_on' => '2026-06-01'])->assertCreated();
    rmHold($this, $english, ['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10']);
    rmHold($this, $maths, ['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10']);

    // Everyone used their four hours; nothing is to come, so no second month — the complaint.
    expect(rmLines($this, $english))->toBe([
        ['student' => 'Adam', 'cycle' => 1, 'amount' => 43200, 'period' => '2026-06-01'],
        ['student' => 'Bassel', 'cycle' => 1, 'amount' => 43200, 'period' => '2026-06-01'],
        ['student' => 'Dina', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-01'],
    ]);

    // The old renewal: Dina is not taken on in English; in Maths the new term gets 9 seats.
    $englishNew = rmSplitLikeTheOldRenewal($this, $english, [$this->kids['Adam'], $this->kids['Bassel']]);
    $mathsNew = rmSplitLikeTheOldRenewal($this, $maths, [$this->kids['Adam'], $this->kids['Celine']], ['capacity' => 9]);
    // …and Dina joins Maths in its new term.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$mathsNew}/members", ['student_ids' => [$this->kids['Dina']], 'joined_on' => '2026-06-20'])->assertCreated();

    // What that left behind. English: the lesson ON the last day fell out of everyone's hours, so
    // an hour was "carried" and nobody owes anything. Maths: charged, but without the discount.
    expect(rmLines($this, $englishNew))->toBe([])
        ->and(collect(rmMembers($this, $englishNew))->pluck('carried')->all())->toBe([60, 60])
        ->and(rmLines($this, $mathsNew))->toBe([
            ['student' => 'Adam', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-17'],
            ['student' => 'Celine', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-17'],
            ['student' => 'Dina', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-17'],
        ]);
    // The family pays everything it is shown: 432 + 432 (English) + 432 + 480 (Maths, old and new).
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 177600, 'method' => 'CASH'])->assertCreated();
    $adamsNewMathsLine = rmCtx($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $mathsNew)->where('student_id', $this->kids['Adam'])->value('id'));
    expect((int) rmCtx($this->academy, fn () => DB::table('receipt_allocations')->where('invoice_line_id', $adamsNewMathsLine)->sum('amount_minor')))->toBe(48000);

    // A lesson of the new term, to follow through the fold: it must stay the same row.
    $newTermLesson = rmCtx($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $mathsNew)->orderBy('scheduled_at_utc')->first());
    expect(Carbon::parse($newTermLesson->occurrence_local_date)->format('Y-m-d'))->toBe('2026-06-22');

    // ── A dry run changes nothing ────────────────────────────────────────────
    $this->artisan('groups:merge-renewals', ['--academy' => $this->academy])->assertSuccessful();
    expect(rmCtx($this->academy, fn () => DB::table('class_groups')->count()))->toBe(4)
        ->and(rmCtx($this->academy, fn () => DB::table('class_groups')->where('id', $english)->value('status')))->toBe('ARCHIVED')
        ->and(rmLines($this, $englishNew))->toBe([]);

    // ── For real ─────────────────────────────────────────────────────────────
    $this->artisan('groups:merge-renewals', ['--academy' => $this->academy, '--apply' => true])->assertSuccessful();

    $groups = rmCtx($this->academy, fn () => DB::table('class_groups')->orderBy('name')->get());
    expect($groups->pluck('id')->map(fn ($id) => (string) $id)->all())->toBe([$english, $maths])
        ->and($groups->pluck('status')->unique()->all())->toBe(['ACTIVE'])
        ->and($groups->pluck('closed_reason')->unique()->all())->toBe([null])
        ->and($groups->map(fn ($g) => Carbon::parse($g->end_date)->format('Y-m-d'))->unique()->all())->toBe(['2026-08-15'])
        ->and($groups->map(fn ($g) => Carbon::parse($g->start_date)->format('Y-m-d'))->unique()->all())->toBe(['2026-06-01'])
        ->and($groups->firstWhere('id', $maths)->capacity)->toBe(9);

    // English: Adam and Bassel never left; Dina, not renewed, left the day AFTER the last lesson.
    expect(rmMembers($this, $english))->toBe([
        ['name' => 'Adam', 'status' => 'ACTIVE', 'joined_on' => '2026-06-01', 'left_on' => null, 'left_reason' => null, 'carried' => 0],
        ['name' => 'Bassel', 'status' => 'ACTIVE', 'joined_on' => '2026-06-01', 'left_on' => null, 'left_reason' => null, 'carried' => 0],
        ['name' => 'Dina', 'status' => 'LEFT', 'joined_on' => '2026-06-01', 'left_on' => '2026-06-11', 'left_reason' => 'Not renewed', 'carried' => 0],
    ]);
    // …so the fourth lesson counts, the month is used up, and the next is raised — discounted.
    expect(rmLines($this, $english))->toBe([
        ['student' => 'Adam', 'cycle' => 1, 'amount' => 43200, 'period' => '2026-06-01'],
        ['student' => 'Adam', 'cycle' => 2, 'amount' => 43200, 'period' => '2026-06-10'],
        ['student' => 'Bassel', 'cycle' => 1, 'amount' => 43200, 'period' => '2026-06-01'],
        ['student' => 'Bassel', 'cycle' => 2, 'amount' => 43200, 'period' => '2026-06-10'],
        ['student' => 'Dina', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-01'],
    ]);
    Sanctum::actingAs($this->owner);
    $adam = collect($this->getJson("/api/groups/{$english}")->assertOk()->json('group.members'))->firstWhere('student_id', $this->kids['Adam']);
    expect($adam['hour_month'])->toBe(['months' => 2, 'bought_minutes' => 480, 'used_minutes' => 240]);

    // Maths: the new term's charges are month 2 of the old group — the SAME rows, Adam's now under
    // the family's 10%; Dina, who first came in the new term, moved over with her first month.
    expect(rmLines($this, $maths))->toBe([
        ['student' => 'Adam', 'cycle' => 1, 'amount' => 43200, 'period' => '2026-06-01'],
        ['student' => 'Adam', 'cycle' => 2, 'amount' => 43200, 'period' => '2026-06-17'],
        ['student' => 'Celine', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-01'],
        ['student' => 'Celine', 'cycle' => 2, 'amount' => 48000, 'period' => '2026-06-17'],
        ['student' => 'Dina', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-17'],
    ]);
    $moved = rmCtx($this->academy, fn () => DB::table('invoice_line_items')->where('id', $adamsNewMathsLine)->first());
    expect((string) $moved->class_group_id)->toBe($maths)
        ->and($moved->description)->toBe('Maths — month 2 (4 h)')
        ->and((int) $moved->list_amount_minor)->toBe(48000)->and((int) $moved->discount_minor)->toBe(4800)
        // Paid 480 on it; it is 432 now: 432 stays on it and the 48 is the family's again.
        ->and((int) rmCtx($this->academy, fn () => DB::table('receipt_allocations')->where('invoice_line_id', $adamsNewMathsLine)->sum('amount_minor')))->toBe(43200);
    expect(collect(rmMembers($this, $maths))->map(fn ($m) => [$m['name'], $m['status'], $m['joined_on']])->all())->toBe([
        ['Adam', 'ACTIVE', '2026-06-01'], ['Celine', 'ACTIVE', '2026-06-01'], ['Dina', 'ACTIVE', '2026-06-20'],
    ]);
    // The receipt is whole: nothing the family paid was lost.
    expect((int) rmCtx($this->academy, fn () => DB::table('receipts')->sum('amount_minor')))->toBe(177600);

    // The new term's lessons are the old group's now — the same rows, on its own weekly times, once each.
    $kept = rmCtx($this->academy, fn () => DB::table('class_group_lessons')->where('id', $newTermLesson->id)->first());
    expect((string) $kept->group_id)->toBe($maths)
        ->and((string) $kept->slot_id)->toBe((string) rmCtx($this->academy, fn () => DB::table('class_group_slots')->where('group_id', $maths)->where('weekday', 1)->value('id')))
        ->and(rmCtx($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $maths)->where('occurrence_local_date', '2026-06-22')->count()))->toBe(1)
        ->and(rmCtx($this->academy, fn () => DB::table('class_group_lessons')->whereNotIn('group_id', [$english, $maths])->count()))->toBe(0);

    // The lessons go on in the old groups; the discount still names them; the trail says what happened.
    expect(rmCtx($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $english)->where('status', 'SCHEDULED')->count()))->toBeGreaterThan(0)
        ->and(rmCtx($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $english)->where('status', 'HELD')->count()))->toBe(4)
        ->and(rmCtx($this->academy, fn () => DB::table('payer_discount_targets')->orderBy('class_group_id')->pluck('class_group_id')->map(fn ($id) => (string) $id)->sort()->values()->all()))
        ->toBe(collect([$english, $maths])->sort()->values()->all())
        ->and(rmCtx($this->academy, fn () => DB::table('audit_log')->where('action', 'class_group.renewal_merged')->count()))->toBe(2);

    // Nothing more to fold, and the nightly run raises nothing twice.
    $this->artisan('groups:merge-renewals', ['--academy' => $this->academy, '--apply' => true])->expectsOutputToContain('Nothing to fold')->assertSuccessful();
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect(rmLines($this, $english))->toHaveCount(5)->and(rmLines($this, $maths))->toHaveCount(5);
});

it('leaves alone a renewed group it cannot fold, and says why', function () {
    // A calendar-month group (no hours): two terms' charges for one month do not fold.
    $old = rmGroup($this, ['month_minutes' => null, 'end_date' => '2026-06-12', 'student_ids' => [$this->kids['Celine']]]);
    $new = rmSplitLikeTheOldRenewal($this, $old, [$this->kids['Celine']]);

    $this->artisan('groups:merge-renewals', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('is not billed by hours')->assertFailed();

    expect(rmCtx($this->academy, fn () => DB::table('class_groups')->where('id', $old)->value('status')))->toBe('ARCHIVED')
        ->and(rmCtx($this->academy, fn () => DB::table('class_groups')->where('id', $new)->exists()))->toBeTrue()
        ->and(collect(rmMembers($this, $new))->pluck('status')->all())->toBe(['ACTIVE']);
});

it('renewing keeps the group: the member whose month is used up is raised the next one, the one not renewed keeps the last lesson and owes nothing new', function () {
    rmCtx($this->academy, fn () => DB::table('module_subscriptions')->where('academy_id', $this->academy)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre', 'accounting']])]));
    $english = rmGroup($this, ['end_date' => '2026-06-10', 'student_ids' => [$this->kids['Celine'], $this->kids['Dina']]]);
    rmHold($this, $english, ['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10']);
    expect(rmLines($this, $english))->toHaveCount(2); // the course is over: nothing to come, nothing raised

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$english}/renew", ['end_date' => null, 'keep_members' => false, 'member_ids' => [$this->kids['Celine']]])
        ->assertOk()->assertJsonPath('group.id', $english)->assertJsonPath('group.status', 'ACTIVE')->assertJsonPath('group.end_date', null);

    expect(rmLines($this, $english))->toBe([
        ['student' => 'Celine', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-01'],
        ['student' => 'Celine', 'cycle' => 2, 'amount' => 48000, 'period' => '2026-06-10'],
        ['student' => 'Dina', 'cycle' => 1, 'amount' => 48000, 'period' => '2026-06-01'],
    ]);
    expect(rmMembers($this, $english))->toBe([
        ['name' => 'Celine', 'status' => 'ACTIVE', 'joined_on' => '2026-06-01', 'left_on' => null, 'left_reason' => null, 'carried' => 0],
        ['name' => 'Dina', 'status' => 'LEFT', 'joined_on' => '2026-06-01', 'left_on' => '2026-06-11', 'left_reason' => 'Not renewed', 'carried' => 0],
    ]);
    $dina = rmCtx($this->academy, fn () => app(GroupBilling::class)->hourMonthBalances(DB::table('class_groups')->where('id', $english)->first())[$this->kids['Dina']]);
    expect($dina)->toBe(['months' => 1, 'bought_minutes' => 240, 'used_minutes' => 240]); // all four lessons, the last day's too
    expect(rmCtx($this->academy, fn () => DB::table('class_groups')->count()))->toBe(1)
        ->and(rmCtx($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $english)->where('status', 'SCHEDULED')->count()))->toBeGreaterThan(0);
});
