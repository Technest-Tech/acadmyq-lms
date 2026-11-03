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
