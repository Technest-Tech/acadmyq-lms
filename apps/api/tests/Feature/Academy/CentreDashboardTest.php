<?php

declare(strict_types=1);

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
 * GET /api/dashboard/centre — the learning centre's home-screen numbers. Behind the `centre`
 * switch, so a Quran academy never has it; for a centre, today's classes, the week's sheets and
 * the running groups add up the way the screen shows them.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-cdash@test.local']);
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-cdash@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $teacherUser->getKey()]);
    $this->students = [];
    foreach (['Adam', 'Bassel', 'Celine'] as $name) {
        $this->students[] = $this->createStudent($this->academy, null, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function centreDashInContext(string $academyId, callable $fn): mixed
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

function centreDashSwitchOn(string $academyId): void
{
    centreDashInContext($academyId, fn () => DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]));
}

it('is not there for an academy without the centre switch', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/dashboard/centre')->assertStatus(402);
});

it('adds up today, the week and the running groups for a centre', function () {
    centreDashSwitchOn($this->academy);

    // A group on Mondays and Wednesdays at 17:00 Cairo, three seats, three members.
    Sanctum::actingAs($this->owner);
    $groupId = $this->postJson('/api/groups', [
        'name' => 'English A1 — evening', 'level' => 'A1', 'capacity' => 3, 'teacher_id' => $this->teacher,
        'start_date' => '2026-06-01',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ],
    ])->assertCreated()->json('group.id');

    centreDashInContext($this->academy, function () use ($groupId) {
        foreach ($this->students as $studentId) {
            DB::table('class_group_members')->insert([
                'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'group_id' => $groupId,
                'student_id' => $studentId, 'joined_on' => '2026-06-01', 'status' => 'ACTIVE',
            ]);
        }
        // Monday's lesson was held: two present, one absent.
        $monday = DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '2026-06-15')->first();
        DB::table('class_group_lessons')->where('id', $monday->id)->update(['status' => 'HELD', 'outcome_set_at' => now()]);
        foreach ($this->students as $i => $studentId) {
            DB::table('class_group_attendance')->insert([
                'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'lesson_id' => $monday->id,
                'group_id' => $groupId, 'student_id' => $studentId, 'status' => $i === 2 ? 'ABSENT' : 'PRESENT',
            ]);
        }
    });

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/dashboard/centre')->assertOk();

    // Wednesday's lesson is later today (17:00), so it counts for today and is not yet unmarked.
    $res->assertJsonPath('today.date', '2026-06-17')
        ->assertJsonPath('today.group_lessons', 1)
        ->assertJsonPath('today.group_unmarked', 0)
        ->assertJsonPath('today.private_lessons', 0)
        ->assertJsonPath('week.held', 1)
        ->assertJsonPath('week.present', 2)
        ->assertJsonPath('week.absent', 1)
        ->assertJsonPath('week.attendance_rate', 0.667)
        ->assertJsonPath('groups.running', 1)
        ->assertJsonPath('groups.members', 3)
        ->assertJsonPath('groups.capacity', 3)
        ->assertJsonPath('groups.free_seats', 0)
        ->assertJsonPath('subscriptions.open', 0)
        ->assertJsonPath('subscriptions.ending_soon', 0);
});

it('counts a class whose time has passed with no sheet as unmarked', function () {
    centreDashSwitchOn($this->academy);
    Carbon::setTestNow('2026-06-17 16:00:00'); // 19:00 Cairo — Wednesday's 17:00 class is over.

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/groups', [
        'name' => 'English B1', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertCreated();

    $this->getJson('/api/dashboard/centre')->assertOk()
        ->assertJsonPath('today.group_lessons', 1)
        ->assertJsonPath('today.group_unmarked', 1)
        ->assertJsonPath('week.attendance_rate', null);
});

it('compares against 30 days ago, and shows no percentage when there was nothing to compare with', function () {
    centreDashSwitchOn($this->academy);
    Sanctum::actingAs($this->owner);

    // The three students were made "now": on the books then, there were none.
    $this->getJson('/api/dashboard/centre')->assertOk()
        ->assertJsonPath('students.total', 3)
        ->assertJsonPath('students.delta_pct', null)
        ->assertJsonPath('groups.delta_pct', null)
        ->assertJsonPath('subscriptions.delta_pct', null);

    // Two of them joined two months ago: 2 then, 3 now, so up 50%.
    centreDashInContext($this->academy, fn () => DB::table('students')
        ->whereIn('id', [$this->students[0], $this->students[1]])
        ->update(['created_at' => '2026-04-01 09:00:00+00']));

    $this->getJson('/api/dashboard/centre')->assertOk()->assertJsonPath('students.delta_pct', 50);
});

it('splits the students into slices that add up to the total', function () {
    centreDashSwitchOn($this->academy);

    centreDashInContext($this->academy, function () {
        // Adam is an old active student, Bassel is on trial, Celine has left; Dina joined this week.
        DB::table('students')->where('id', $this->students[0])->update(['created_at' => '2026-04-01 09:00:00+00']);
        DB::table('students')->where('id', $this->students[1])->update(['status' => 'TRIAL']);
        DB::table('students')->where('id', $this->students[2])->update(['status' => 'WITHDRAWN']);
    });
    $this->createStudent($this->academy, null, ['full_name' => 'Dina', 'status' => 'REGULAR']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/dashboard/centre')->assertOk()
        ->assertJsonPath('students.total', 4)
        ->assertJsonPath('students.active', 1)
        ->assertJsonPath('students.new_recent', 1)
        ->assertJsonPath('students.trial', 1)
        ->assertJsonPath('students.inactive', 1);
});

it('lists the newest groups and what just happened', function () {
    centreDashSwitchOn($this->academy);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/groups', [
        'name' => 'English B1', 'teacher_id' => $this->teacher, 'capacity' => 8, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertCreated();

    $res = $this->getJson('/api/dashboard/centre')->assertOk()
        ->assertJsonPath('latest_groups.0.name', 'English B1')
        ->assertJsonPath('latest_groups.0.capacity', 8)
        ->assertJsonPath('latest_groups.0.members', 0);

    expect(collect($res->json('activity'))->pluck('type')->all())->toContain('group', 'student');
    expect(count($res->json('activity')))->toBeLessThanOrEqual(4);
});

it('adds receipts up by month, with every month present and voided ones out', function () {
    centreDashSwitchOn($this->academy);

    centreDashInContext($this->academy, function () {
        foreach ([
            ['2026-06-02', 10_000, null],
            ['2026-06-10', 5_000, null],
            ['2026-06-11', 99_000, '2026-06-12 09:00:00+00'],
            ['2026-04-20', 7_000, null],
        ] as $i => [$on, $amount, $voidedAt]) {
            DB::table('receipts')->insert([
                'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'number' => 'R-'.$i, 'amount_minor' => $amount,
                'currency' => 'EGP', 'method' => 'CASH', 'received_on' => $on, 'payer_name' => 'Walk-in', 'voided_at' => $voidedAt,
                'void_reason' => $voidedAt !== null ? 'typo' : null, 'public_token' => (string) Str::uuid(),
            ]);
        }
    });

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/dashboard/centre/trend?months=3')->assertOk();

    $res->assertJsonPath('months', ['2026-04', '2026-05', '2026-06'])
        ->assertJsonPath('collected.0.currency', 'EGP')
        ->assertJsonPath('collected.0.by_month.0.amount_minor', 7_000)
        ->assertJsonPath('collected.0.by_month.1.amount_minor', 0)
        ->assertJsonPath('collected.0.by_month.2.amount_minor', 15_000);
    expect($res->json('lessons'))->toHaveCount(3);
});

it('keeps the money out of the trend for someone who cannot read invoices', function () {
    centreDashSwitchOn($this->academy);
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 't2-cdash@test.local']);
    $this->clearTenantContext();

    Sanctum::actingAs($teacher);
    $this->getJson('/api/dashboard/centre/trend')->assertOk()->assertJsonPath('collected', null);
});
