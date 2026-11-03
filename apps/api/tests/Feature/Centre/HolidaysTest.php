<?php

declare(strict_types=1);

use App\Jobs\RollSessionWindowJob;
use App\Services\ModuleBilling;
use App\Services\SessionGenerator;
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
 * A centre's holidays and the substitute teacher (docs/centre-profile, Phase 2 §3). Pinned here:
 *   - behind the centre switch: a Quran academy gets 402, and its generation output does not change;
 *   - declaring a holiday cancels the pending lessons inside it from today on, nothing before today;
 *   - deleting it restores exactly those, leaving another holiday's days closed;
 *   - the generators skip closed dates and fill them in once the holiday is gone;
 *   - a substitute takes the lesson and its pay; the nightly roll leaves them on it; a statement
 *     paid out from the treasury pins the teacher.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo. June's Mondays + Wednesdays: 1 3 8 10 15 17 22 24 29.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-hol@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-hol@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Mr Karim', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, null, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function holInContext(string $academyId, callable $fn): mixed
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

function holCentreOn(string $academyId): void
{
    holInContext($academyId, fn () => app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['centre']));
}

/** Mondays and Wednesdays at 17:00 Cairo from 1 June, one member. */
function holGroup($test, array $over = []): string
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
        'student_ids' => [$test->student],
    ], $over))->assertCreated()->json('group.id');
}

/** A private timetable on Mondays 17:00 Cairo, materialised by the nightly roll. */
function holSchedule($test): string
{
    $scheduleId = (function (): string {
        $id = $this->createSchedule($this->academy, $this->student, $this->teacher);
        $this->addSlot($this->academy, $id, 1, '17:00:00', 60);
        $this->clearTenantContext();

        return $id;
    })->call($test);
    holRoll($test->academy);

    return $scheduleId;
}

function holRoll(string $academyId): void
{
    (new RollSessionWindowJob(onlyAcademyId: $academyId))->handle(app(SessionGenerator::class));
}

function holLesson($test, string $groupId, string $date): ?object
{
    return holInContext($test->academy, fn () => DB::table('class_group_lessons')
        ->where('group_id', $groupId)->where('occurrence_local_date', $date)->first());
}

function holSession($test, string $scheduleId, string $date): ?object
{
    return holInContext($test->academy, fn () => DB::table('sessions')
        ->where('schedule_id', $scheduleId)->where('occurrence_local_date', $date)->first());
}

function holPostHoliday($test, string $name, string $from, string $to)
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/holidays', ['name' => $name, 'starts_on' => $from, 'ends_on' => $to]);
}

// ── The switch ───────────────────────────────────────────────────────────────

it('is not there for an academy without the centre switch', function () {
    $groupId = holGroup($this);
    $lesson = holLesson($this, $groupId, '2026-06-22');

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/holidays')->assertStatus(402);
    $this->postJson('/api/holidays', ['name' => 'Eid', 'starts_on' => '2026-06-22', 'ends_on' => '2026-06-24'])->assertStatus(402);
    $this->postJson("/api/group-lessons/{$lesson->id}/substitute", ['teacher_id' => $this->other])->assertStatus(402);
});

it('leaves a Quran academy\'s generation output as it was while a centre next door is on holiday', function () {
    $groupId = holGroup($this);
    $scheduleId = holSchedule($this);

    $snapshot = fn () => holInContext($this->academy, fn () => [
        'lessons' => DB::table('class_group_lessons')->where('group_id', $groupId)->orderBy('occurrence_local_date')
            ->get(['id', 'occurrence_local_date', 'scheduled_at_utc', 'status', 'teacher_id', 'updated_at'])->map(fn ($r) => (array) $r)->all(),
        'sessions' => DB::table('sessions')->where('schedule_id', $scheduleId)->orderBy('occurrence_local_date')
            ->get(['id', 'occurrence_local_date', 'scheduled_at_utc', 'status', 'teacher_id', 'updated_at'])->map(fn ($r) => (array) $r)->all(),
    ]);
    $before = $snapshot();
    expect($before['lessons'])->not->toBeEmpty()->and($before['sessions'])->not->toBeEmpty();

    // The centre next door closes for the same days.
    $centre = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $centreOwner = $this->makeUser($centre, 'ACADEMY_OWNER', ['email' => 'owner-hol-centre@test.local']);
    $this->clearTenantContext();
    holCentreOn($centre);
    Sanctum::actingAs($centreOwner);
    $this->postJson('/api/holidays', ['name' => 'Eid', 'starts_on' => '2026-06-01', 'ends_on' => '2026-07-31'])->assertCreated();

    holRoll($this->academy);
    expect($snapshot())->toBe($before);
});

// ── Declaring and removing ───────────────────────────────────────────────────

it('cancels the pending lessons inside the holiday from today on, and nothing before', function () {
    holCentreOn($this->academy);
    $groupId = holGroup($this);
    $scheduleId = holSchedule($this);

    // The lesson of the 15th is pending history (back-filled, never marked); today's is at 17:00.
    expect(holLesson($this, $groupId, '2026-06-15')->status)->toBe('SCHEDULED');

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/holidays/preview?starts_on=2026-06-15&ends_on=2026-06-24')
        ->assertOk()->assertJson(['group_lessons' => 3, 'sessions' => 1]);

    $res = holPostHoliday($this, 'Mid-year break', '2026-06-15', '2026-06-24')->assertCreated();
    expect($res->json('cancelled'))->toBe(['group_lessons' => 3, 'sessions' => 1])
        ->and($res->json('holiday.name'))->toBe('Mid-year break')
        ->and($res->json('holiday.cancelled'))->toBe(['group_lessons' => 3, 'sessions' => 1]);

    expect(holLesson($this, $groupId, '2026-06-15')->status)->toBe('SCHEDULED');
    foreach (['2026-06-17', '2026-06-22', '2026-06-24'] as $date) {
        $lesson = holLesson($this, $groupId, $date);
        expect($lesson->status)->toBe('CANCELLED')->and($lesson->cancel_reason)->toBe('HOLIDAY');
    }
    expect(holLesson($this, $groupId, '2026-06-29')->status)->toBe('SCHEDULED');

    $session = holSession($this, $scheduleId, '2026-06-22');
    expect($session->status)->toBe('CANCELLED_BY_TEACHER')->and($session->status_reason)->toBe('HOLIDAY')
        ->and((bool) $session->billed)->toBeFalse()->and((bool) $session->paid_to_teacher)->toBeFalse();
    expect(holSession($this, $scheduleId, '2026-06-29')->status)->toBe('SCHEDULED');

    // The board reads the marker; the list carries the counts.
    $this->getJson('/api/holidays')->assertOk()->assertJsonCount(1, 'holidays')
        ->assertJsonPath('holidays.0.cancelled.group_lessons', 3)
        ->assertJsonPath('holidays.0.cancelled.sessions', 1);
    $shown = $this->getJson("/api/groups/{$groupId}/lessons?from=2026-06-22&to=2026-06-22")->assertOk()->json('lessons.0');
    expect($shown['status'])->toBe('CANCELLED')->and($shown['cancel_reason'])->toBe('HOLIDAY')->and($shown['is_substitute'])->toBeFalse();
});

it('refuses a badly dated holiday and a reader without the settings capability', function () {
    holCentreOn($this->academy);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/holidays', ['name' => 'Eid', 'starts_on' => '2026-06-24', 'ends_on' => '2026-06-22'])
        ->assertStatus(422)->assertJsonValidationErrors('ends_on');
    $this->postJson('/api/holidays', ['name' => '  ', 'starts_on' => '2026-06-22', 'ends_on' => '2026-06-24'])
        ->assertStatus(422)->assertJsonValidationErrors('name');

    // A supervisor reads the list (the board shows the badge) but does not declare one.
    Sanctum::actingAs($this->supervisor);
    $this->getJson('/api/holidays')->assertOk();
    $this->postJson('/api/holidays', ['name' => 'Eid', 'starts_on' => '2026-06-22', 'ends_on' => '2026-06-24'])->assertForbidden();
});

it('restores exactly what it cancelled when deleted, leaving another holiday\'s days closed', function () {
    holCentreOn($this->academy);
    $groupId = holGroup($this);
    $scheduleId = holSchedule($this);

    // Something cancelled by hand on a holiday date must stay cancelled.
    Sanctum::actingAs($this->owner);
    $byHand = holLesson($this, $groupId, '2026-06-24');
    $this->postJson("/api/group-lessons/{$byHand->id}/cancel", ['reason' => 'Teacher ill'])->assertOk();

    $first = holPostHoliday($this, 'Break', '2026-06-15', '2026-06-24')->assertCreated()->json('holiday.id');
    $second = holPostHoliday($this, 'Eid', '2026-06-22', '2026-06-30')->assertCreated();
    // The second finds its overlap already cancelled; it only takes the 29th and its session.
    expect($second->json('cancelled'))->toBe(['group_lessons' => 1, 'sessions' => 1]);

    $this->deleteJson("/api/holidays/{$first}")->assertOk()->assertJson(['restored' => ['group_lessons' => 1, 'sessions' => 0]]);

    expect(holLesson($this, $groupId, '2026-06-17')->status)->toBe('SCHEDULED')
        ->and(holLesson($this, $groupId, '2026-06-17')->cancel_reason)->toBeNull()
        ->and(holLesson($this, $groupId, '2026-06-22')->status)->toBe('CANCELLED')    // still inside Eid
        ->and(holLesson($this, $groupId, '2026-06-24')->cancel_reason)->toBe('Teacher ill')
        ->and(holSession($this, $scheduleId, '2026-06-22')->status)->toBe('CANCELLED_BY_TEACHER');

    $this->deleteJson('/api/holidays/'.$second->json('holiday.id'))->assertOk()->assertJson(['restored' => ['group_lessons' => 2, 'sessions' => 2]]);
    expect(holLesson($this, $groupId, '2026-06-22')->status)->toBe('SCHEDULED')
        ->and(holLesson($this, $groupId, '2026-06-29')->status)->toBe('SCHEDULED')
        ->and(holLesson($this, $groupId, '2026-06-24')->status)->toBe('CANCELLED')
        ->and(holSession($this, $scheduleId, '2026-06-22')->status)->toBe('SCHEDULED')
        ->and(holSession($this, $scheduleId, '2026-06-22')->status_reason)->toBeNull()
        ->and(holSession($this, $scheduleId, '2026-06-29')->status)->toBe('SCHEDULED');
    $this->getJson('/api/holidays')->assertOk()->assertJsonCount(0, 'holidays');
});

// ── Generation ───────────────────────────────────────────────────────────────

it('skips closed dates when generating, and fills them in once the holiday is gone', function () {
    holCentreOn($this->academy);
    $holidayId = holPostHoliday($this, 'Eid', '2026-06-22', '2026-06-24')->assertCreated()->json('holiday.id');

    // A group and a timetable created while the centre is closed those days.
    $groupId = holGroup($this);
    $scheduleId = holSchedule($this);
    expect(holLesson($this, $groupId, '2026-06-22'))->toBeNull()
        ->and(holLesson($this, $groupId, '2026-06-24'))->toBeNull()
        ->and(holLesson($this, $groupId, '2026-06-17'))->not->toBeNull()
        ->and(holLesson($this, $groupId, '2026-06-29'))->not->toBeNull()
        ->and(holSession($this, $scheduleId, '2026-06-22'))->toBeNull()
        ->and(holSession($this, $scheduleId, '2026-06-29'))->not->toBeNull();

    // The nightly roll creates nothing on them either, and takes nothing away elsewhere.
    $count = fn () => holInContext($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $groupId)->count());
    $n = $count();
    holRoll($this->academy);
    expect($count())->toBe($n)->and(holLesson($this, $groupId, '2026-06-22'))->toBeNull();

    // Gone: the days are open and the lessons appear, pending.
    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/holidays/{$holidayId}")->assertOk()->assertJson(['restored' => ['group_lessons' => 0, 'sessions' => 0]]);
    expect(holLesson($this, $groupId, '2026-06-22')->status)->toBe('SCHEDULED')
        ->and(holLesson($this, $groupId, '2026-06-24')->status)->toBe('SCHEDULED')
        ->and(holSession($this, $scheduleId, '2026-06-22')->status)->toBe('SCHEDULED');
});

// ── Substitute ───────────────────────────────────────────────────────────────

it('puts a substitute on one lesson, keeps them there through the roll, and takes them off again', function () {
    holCentreOn($this->academy);
    $groupId = holGroup($this);
    $lesson = holLesson($this, $groupId, '2026-06-22');

    Sanctum::actingAs($this->owner);
    $shown = $this->postJson("/api/group-lessons/{$lesson->id}/substitute", ['teacher_id' => $this->other])->assertOk()->json('lesson');
    expect($shown['teacher_id'])->toBe($this->other)
        ->and($shown['teacher_name'])->toBe('Mr Karim')
        ->and($shown['is_substitute'])->toBeTrue()
        ->and($shown['group_teacher_name'])->toBe('Miss Mona');

    // The next lesson is untouched, and the roll realigns it without touching the substitute.
    holRoll($this->academy);
    expect(holLesson($this, $groupId, '2026-06-22')->teacher_id)->toBe($this->other)
        ->and(holLesson($this, $groupId, '2026-06-24')->teacher_id)->toBe($this->teacher);

    // The calendar names both.
    $feed = collect($this->getJson('/api/calendar?from=2026-06-22&to=2026-06-22')->assertOk()->json('group_lessons'));
    expect($feed->firstWhere('id', $lesson->id)['is_substitute'])->toBeTrue()
        ->and($feed->firstWhere('id', $lesson->id)['teacher_name'])->toBe('Mr Karim')
        ->and($feed->firstWhere('id', $lesson->id)['group_teacher_name'])->toBe('Miss Mona');

    $back = $this->postJson("/api/group-lessons/{$lesson->id}/substitute", ['teacher_id' => null])->assertOk()->json('lesson');
    expect($back['teacher_id'])->toBe($this->teacher)->and($back['is_substitute'])->toBeFalse();
    expect(holLesson($this, $groupId, '2026-06-22')->original_teacher_id)->toBeNull();

    // Unknown teacher, and a cancelled lesson, are refused.
    $this->postJson("/api/group-lessons/{$lesson->id}/substitute", ['teacher_id' => (string) Str::uuid()])->assertStatus(422);
    $this->postJson("/api/group-lessons/{$lesson->id}/cancel", ['reason' => null])->assertOk();
    $this->postJson("/api/group-lessons/{$lesson->id}/substitute", ['teacher_id' => $this->other])->assertStatus(422);
});

it('pays the substitute for the lesson, moving the line when set after the sheet, and never off a paid statement', function () {
    holCentreOn($this->academy);
    $groupId = holGroup($this, ['teacher_pay_mode' => 'PER_LESSON', 'teacher_pay_minor' => 9000]);
    $lines = fn (string $lessonId) => holInContext($this->academy, fn () => DB::table('payout_line_items as pl')
        ->join('payouts as p', 'p.id', '=', 'pl.payout_id')
        ->where('pl.class_group_lesson_id', $lessonId)
        ->get(['pl.amount_minor', 'pl.payout_id', 'p.teacher_id', 'p.total_minor']));

    // Set before the sheet: the substitute is simply who is paid.
    $first = holLesson($this, $groupId, '2026-06-15');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$first->id}/substitute", ['teacher_id' => $this->other])->assertOk();
    $this->postJson("/api/group-lessons/{$first->id}/attendance", ['entries' => []])->assertOk();
    expect($lines($first->id))->toHaveCount(1)
        ->and($lines($first->id)->first()->teacher_id)->toBe($this->other)
        ->and((int) $lines($first->id)->first()->amount_minor)->toBe(9000);

    // Set after the sheet: the line moves from Mona's statement to Karim's.
    $second = holLesson($this, $groupId, '2026-06-17');
    Carbon::setTestNow('2026-06-17 16:00:00');
    $this->postJson("/api/group-lessons/{$second->id}/attendance", ['entries' => []])->assertOk();
    expect($lines($second->id)->first()->teacher_id)->toBe($this->teacher);
    $monaStatement = $lines($second->id)->first()->payout_id;

    $this->postJson("/api/group-lessons/{$second->id}/substitute", ['teacher_id' => $this->other])->assertOk();
    expect($lines($second->id))->toHaveCount(1)
        ->and($lines($second->id)->first()->teacher_id)->toBe($this->other)
        ->and((int) $lines($second->id)->first()->total_minor)->toBe(18000);
    expect((int) holInContext($this->academy, fn () => DB::table('payouts')->where('id', $monaStatement)->value('total_minor')))->toBe(0);

    // Karim's June statement is sealed and paid out from the treasury: the teacher is pinned.
    $karimStatement = $lines($second->id)->first()->payout_id;
    holInContext($this->academy, function () use ($karimStatement): void {
        DB::table('payouts')->where('id', $karimStatement)->update(['finalized_at' => now()]);
        $account = (string) Str::uuid();
        DB::table('cash_accounts')->insert(['id' => $account, 'academy_id' => $this->academy, 'name' => 'Drawer', 'kind' => 'CASH', 'currency' => 'EGP', 'opening_on' => '2026-01-01']);
        $category = (string) Str::uuid();
        DB::table('expense_categories')->insert(['id' => $category, 'academy_id' => $this->academy, 'name' => 'Salaries']);
        DB::table('expenses')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'number' => 'E-1', 'spent_on' => '2026-06-17', 'category_id' => $category,
            'amount_minor' => 18000, 'currency' => 'EGP', 'cash_account_id' => $account, 'payout_id' => $karimStatement,
        ]);
    });
    $this->postJson("/api/group-lessons/{$second->id}/substitute", ['teacher_id' => null])->assertStatus(422);
    expect(holLesson($this, $groupId, '2026-06-17')->teacher_id)->toBe($this->other)
        ->and($lines($second->id)->first()->teacher_id)->toBe($this->other);
});
