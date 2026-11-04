<?php

declare(strict_types=1);

use App\Jobs\BillGroupMonthsJob;
use App\Services\GroupBilling;
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
 * A family paused for a while (docs/groups/01-ACCOUNTING.md): the children's timetables stop and
 * their coming lessons leave the calendar, no group month is raised on them, nothing already
 * recorded moves, and resuming brings the timetables and the lessons back.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-suspend@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Parent of two']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->other = $this->createGuardian($this->academy, ['full_name' => 'Other parent']);
    $this->dina = $this->createStudent($this->academy, $this->other, ['full_name' => 'Dina', 'status' => 'REGULAR']);

    // Adam has a Monday 17:00 private lesson; Dina too (she must be untouched throughout).
    $this->asAcademy($this->academy);
    foreach ([[$this->adam, 'adam'], [$this->dina, 'dina']] as [$student, $key]) {
        $scheduleId = $this->createSchedule($this->academy, $student, $this->teacher);
        DB::table('schedule_slots')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'schedule_id' => $scheduleId, 'weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]);
        $this->{$key.'Schedule'} = $scheduleId;
    }
    [$from, $to] = SessionGenerator::defaultWindow();
    app(SessionGenerator::class)->generateForAcademy($this->academy, $from, $to);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function suspendTenant(string $academyId, callable $fn): mixed
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

function suspendSessions($test, string $studentId): int
{
    return suspendTenant($test->academy, fn () => DB::table('sessions')->where('student_id', $studentId)->where('status', 'SCHEDULED')->count());
}

it('pauses the family: timetables off, coming lessons gone, nothing else touched — and resumes them', function () {
    expect(suspendSessions($this, $this->adam))->toBeGreaterThan(0);
    $dinaBefore = suspendSessions($this, $this->dina);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/guardians/{$this->parent}/suspend")->assertOk()->assertJsonPath('paused_schedules', 1);
    expect($this->getJson("/api/guardians/{$this->parent}")->assertOk()->json('guardian.suspended_at'))->not->toBeNull();

    // Adam's timetable is off and flagged; his coming lessons are gone; Dina's are as they were.
    $schedule = suspendTenant($this->academy, fn () => DB::table('schedules')->where('id', $this->adamSchedule)->first());
    expect((bool) $schedule->is_active)->toBeFalse()->and((bool) $schedule->paused_by_suspension)->toBeTrue();
    expect(suspendSessions($this, $this->adam))->toBe(0);
    expect(suspendSessions($this, $this->dina))->toBe($dinaBefore);

    // Suspending twice is a no-op; a deactivated family cannot be paused.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/guardians/{$this->parent}/suspend")->assertOk()->assertJsonPath('already', true);

    // Resume: the timetable is active again, no longer flagged, and the lessons are back.
    $this->postJson("/api/guardians/{$this->parent}/resume")->assertOk()->assertJsonPath('resumed_schedules', 1);
    expect($this->getJson("/api/guardians/{$this->parent}")->assertOk()->json('guardian.suspended_at'))->toBeNull();
    $schedule = suspendTenant($this->academy, fn () => DB::table('schedules')->where('id', $this->adamSchedule)->first());
    expect((bool) $schedule->is_active)->toBeTrue()->and((bool) $schedule->paused_by_suspension)->toBeFalse();
    expect(suspendSessions($this, $this->adam))->toBeGreaterThan(0);
});

it('raises no group month on a paused family, and bills it again once resumed', function () {
    Sanctum::actingAs($this->owner);
    $groupId = $this->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '18:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
        'student_ids' => [$this->adam, $this->dina],
    ])->assertCreated()->json('group.id');
    $lines = fn () => suspendTenant($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $groupId)->get()->groupBy(fn ($l) => (string) $l->student_id)->map->count()->all());
    expect($lines())->toEqual([$this->adam => 1, $this->dina => 1]);

    $this->postJson("/api/guardians/{$this->parent}/suspend")->assertOk()->assertJsonPath('paused_memberships', 1);
    // Adam's membership is closed today with reason SUSPENDED and remembered; Dina's is untouched.
    $members = fn () => suspendTenant($this->academy, fn () => DB::table('class_group_members')->where('group_id', $groupId)->orderBy('created_at')->get()->groupBy(fn ($m) => (string) $m->student_id));
    $adam = $members()[$this->adam];
    expect($adam)->toHaveCount(1)
        ->and($adam[0]->status)->toBe('LEFT')
        ->and($adam[0]->left_reason)->toBe('SUSPENDED')
        ->and((bool) $adam[0]->paused_by_suspension)->toBeTrue()
        ->and(substr((string) $adam[0]->left_on, 0, 10))->toBe('2026-06-17');
    expect($members()[$this->dina][0]->status)->toBe('ACTIVE');
    // The next sheet expects Dina only.
    $next = suspendTenant($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '2026-06-22')->first());
    expect(collect($this->getJson("/api/group-lessons/{$next->id}")->assertOk()->json('roster'))->pluck('student_id')->all())->toBe([$this->dina]);

    Carbon::setTestNow('2026-07-01 09:00:00');
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    // July: Dina yes, Adam no — and his June line is exactly where it was.
    expect($lines())->toEqual([$this->adam => 1, $this->dina => 2]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/guardians/{$this->parent}/resume")->assertOk()->assertJsonPath('resumed_memberships', 1);
    // A new membership from the day of the resume; the old one keeps its history and loses the flag.
    $adam = $members()[$this->adam];
    expect($adam)->toHaveCount(2)
        ->and((bool) $adam[0]->paused_by_suspension)->toBeFalse()
        ->and($adam[1]->status)->toBe('ACTIVE')
        ->and(substr((string) $adam[1]->joined_on, 0, 10))->toBe('2026-07-01');
    expect(collect($this->getJson("/api/group-lessons/{$next->id}")->assertOk()->json('roster'))->pluck('student_id')->all())->toBe([$this->dina]);
    $july = suspendTenant($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '2026-07-06')->first());
    expect(collect($this->getJson("/api/group-lessons/{$july->id}")->assertOk()->json('roster'))->pluck('student_id')->sort()->values()->all())->toBe(collect([$this->adam, $this->dina])->sort()->values()->all());

    // July is raised on Adam by the resume itself, in full (he is in it from its first lesson); the
    // nightly job then finds nothing more to add.
    expect($lines())->toEqual([$this->adam => 2, $this->dina => 2]);
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect($lines())->toEqual([$this->adam => 2, $this->dina => 2]);
});

it('does not bill the join month again when the family is back inside a month already paid, and skips a group that ended meanwhile', function () {
    Sanctum::actingAs($this->owner);
    $running = $this->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '18:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
        'student_ids' => [$this->adam],
    ])->assertCreated()->json('group.id');
    $ending = $this->postJson('/api/groups', [
        'name' => 'Summer club', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01', 'end_date' => '2026-06-20',
        'slots' => [['weekday' => 3, 'start_time_local' => '18:00', 'duration_minutes' => 60]],
        'billing_mode' => 'COURSE', 'price_minor' => 20000, 'currency' => 'EGP',
        'student_ids' => [$this->adam],
    ])->assertCreated()->json('group.id');
    $count = fn (string $groupId) => suspendTenant($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $groupId)->where('student_id', $this->adam)->count());
    expect($count($running))->toBe(1)->and($count($ending))->toBe(1);

    $this->postJson("/api/guardians/{$this->parent}/suspend")->assertOk()->assertJsonPath('paused_memberships', 2);

    // Back on the 25th: June was paid in the running group, so nothing new; the club has ended, so no seat there.
    Carbon::setTestNow('2026-06-25 09:00:00');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/guardians/{$this->parent}/resume")->assertOk()->assertJsonPath('resumed_memberships', 1);
    expect($count($running))->toBe(1)->and($count($ending))->toBe(1);
    $open = suspendTenant($this->academy, fn () => DB::table('class_group_members')->where('student_id', $this->adam)->where('status', 'ACTIVE')->pluck('group_id')->map(fn ($v) => (string) $v)->all());
    expect($open)->toBe([$running]);
    expect(suspendTenant($this->academy, fn () => DB::table('class_group_members')->where('paused_by_suspension', true)->count()))->toBe(0);

    // A second pause starts clean: one membership to pause, one to bring back.
    $this->postJson("/api/guardians/{$this->parent}/suspend")->assertOk()->assertJsonPath('paused_memberships', 1);
    $this->postJson("/api/guardians/{$this->parent}/resume")->assertOk()->assertJsonPath('resumed_memberships', 1);
    expect($count($running))->toBe(1);
});
