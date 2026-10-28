<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * The group section's cross-group pages (GroupBoardController): every lesson, every member, the
 * month's money and the reports — across all the caller's groups, scoped like the rest.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo. Mondays + Wednesdays at 17:00 since 1 June.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-board@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-board@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-board@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->teacherUser->getKey(), 'session_rate_minor' => 6000]);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Mr Karim']);

    $this->kids = [];
    foreach (['Adam', 'Bassel', 'Celine'] as $name) {
        $this->kids[$name] = $this->createStudent($this->academy, null, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $slots = [
        ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
    ];
    $this->mine = $this->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01', 'slots' => $slots,
        'price_minor' => 45000, 'student_ids' => [$this->kids['Adam'], $this->kids['Bassel']],
    ])->assertCreated()->json('group.id');
    $this->theirs = $this->postJson('/api/groups', [
        'name' => 'Maths G9', 'teacher_id' => $this->other, 'start_date' => '2026-06-01', 'capacity' => 10,
        'slots' => [['weekday' => 1, 'start_time_local' => '19:00', 'duration_minutes' => 60]],
        'student_ids' => [$this->kids['Celine']],
    ])->assertCreated()->json('group.id');
});

afterEach(fn () => Carbon::setTestNow());

if (! function_exists('boardLesson')) {
    function boardLesson($test, string $groupId, string $date): object
    {
        DB::statement("select set_config('app.current_academy_id', ?, true)", [$test->academy]);
        DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
        $row = DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', $date)->first();
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");

        return $row;
    }
}

it('lists the day’s lessons across every group, and every sheet still owed', function () {
    // Mark Monday the 15th for English; leave everything else alone.
    $this->postJson('/api/group-lessons/'.boardLesson($this, $this->mine, '2026-06-15')->id.'/attendance')->assertOk();

    $day = $this->getJson('/api/group-lessons?view=day&date=2026-06-15')->assertOk();
    expect(collect($day->json('lessons'))->pluck('group.name')->all())->toBe(['English A1', 'Maths G9']);
    expect($day->json('lessons.0.status'))->toBe('HELD');

    $owed = collect($this->getJson('/api/group-lessons?view=owed')->assertOk()->json('lessons'));
    // English owes 1, 3, 8, 10 (the 15th was marked); Maths owes the 1st, 8th and 15th — oldest first.
    expect($owed)->toHaveCount(7);
    expect($owed->first()['occurrence_local_date'])->toBe('2026-06-01');
    expect($owed->pluck('id'))->not->toContain(boardLesson($this, $this->mine, '2026-06-15')->id);

    $week = collect($this->getJson('/api/group-lessons?view=week&date=2026-06-15')->json('lessons'));
    expect($week->pluck('occurrence_local_date')->unique()->values()->all())->toBe(['2026-06-15', '2026-06-17']);

    $this->getJson('/api/group-lessons/summary')->assertOk()->assertJson(['owed' => 7, 'today' => 1]);
});

it('shows a teacher only the lessons of their own groups', function () {
    Sanctum::actingAs($this->teacherUser);

    $owed = collect($this->getJson('/api/group-lessons?view=owed')->assertOk()->json('lessons'));
    expect($owed->pluck('group.name')->unique()->values()->all())->toBe(['English A1']);
    $this->getJson('/api/group-lessons/summary')->assertJson(['owed' => 5]);

    expect(collect($this->getJson('/api/group-members')->json('members'))->pluck('group_name')->unique()->values()->all())->toBe(['English A1']);
});

it('lists every member with their attendance, an absence streak, and this month’s charge', function () {
    foreach (['2026-06-08', '2026-06-10', '2026-06-15'] as $date) {
        $this->postJson('/api/group-lessons/'.boardLesson($this, $this->mine, $date)->id.'/attendance', [
            'entries' => [['student_id' => $this->kids['Bassel'], 'status' => 'ABSENT']],
        ])->assertOk();
    }

    $members = collect($this->getJson('/api/group-members')->assertOk()->json('members'))->keyBy('full_name');
    expect($members)->toHaveCount(3);
    expect($members['Bassel']['absent_streak'])->toBe(3);
    expect($members['Bassel']['attendance']['rate'])->toEqual(0);
    expect($members['Adam']['attendance']['rate'])->toEqual(1);
    // English is priced (MONTHLY 450): June is charged and unpaid; Maths bills nothing.
    expect($members['Adam']['charge'])->toMatchArray(['currency' => 'EGP', 'billed_minor' => 45000, 'outstanding_minor' => 45000]);
    expect($members['Celine']['charge'])->toBeNull();

    $flagged = collect($this->getJson('/api/group-members?flag=absent_streak')->json('members'));
    expect($flagged->pluck('full_name')->all())->toBe(['Bassel']);
    expect(collect($this->getJson('/api/group-members?flag=unpaid')->json('members'))->pluck('full_name')->sort()->values()->all())->toBe(['Adam', 'Bassel']);

    // The front desk sees the people, never the money.
    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-members@test.local']));
    $res = $this->getJson('/api/group-members')->assertOk();
    expect($res->json('sees_money'))->toBeFalse();
    expect(collect($res->json('members'))->pluck('charge')->filter()->all())->toBe([]);
});

it('reads the month’s money group by group, with every unpaid charge', function () {
    $this->postJson('/api/group-lessons/'.boardLesson($this, $this->mine, '2026-06-15')->id.'/attendance')->assertOk();

    $res = $this->getJson('/api/group-payments?month=2026-06')->assertOk();
    $english = collect($res->json('groups'))->firstWhere('name', 'English A1');
    expect($english['money'][0])->toMatchArray(['currency' => 'EGP', 'billed_minor' => 90000, 'outstanding_minor' => 90000, 'charges' => 2, 'teacher_cost_minor' => 6000]);
    expect($res->json('totals.0'))->toMatchArray(['billed_minor' => 90000, 'paid_minor' => 0, 'teacher_cost_minor' => 6000]);
    expect(collect($res->json('unpaid'))->pluck('student_name')->sort()->values()->all())->toBe(['Adam', 'Bassel']);

    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-payments@test.local']));
    $this->getJson('/api/group-payments')->assertForbidden();
});

it('reports seats, lessons and attendance per group and per teacher', function () {
    $this->postJson('/api/group-lessons/'.boardLesson($this, $this->mine, '2026-06-15')->id.'/attendance', [
        'entries' => [['student_id' => $this->kids['Bassel'], 'status' => 'ABSENT']],
    ])->assertOk();
    $this->postJson('/api/group-lessons/'.boardLesson($this, $this->theirs, '2026-06-15')->id.'/cancel')->assertOk();

    $res = $this->getJson('/api/group-reports?from=2026-06-01&to=2026-06-30')->assertOk();
    $groups = collect($res->json('groups'))->keyBy('name');

    expect($groups['English A1']['lessons'])->toMatchArray(['held' => 1, 'owed' => 4, 'cancelled' => 0]);
    expect($groups['English A1']['attendance'])->toMatchArray(['marked' => 2, 'came' => 1, 'absent' => 1, 'rate' => 0.5]);
    expect($groups['English A1']['billed'][0]['amount_minor'])->toBe(90000);
    expect($groups['Maths G9'])->toMatchArray(['members' => 1, 'capacity' => 10, 'occupancy' => 0.1]);
    expect($groups['Maths G9']['lessons']['cancelled'])->toBe(1);

    $teachers = collect($res->json('teachers'))->keyBy('name');
    expect($teachers['Miss Mona']['lessons']['held'])->toBe(1);
    expect($teachers['Mr Karim']['lessons']['owed'])->toBe(2);
    expect($res->json('totals'))->toMatchArray(['groups' => 2, 'members' => 3]);
});

it('answers 404, not a database error, for an id that is not one', function () {
    $this->getJson('/api/groups/payments')->assertNotFound();
    $this->getJson('/api/group-lessons/not-a-lesson')->assertNotFound();
});
