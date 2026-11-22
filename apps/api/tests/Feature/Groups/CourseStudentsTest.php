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
 * Course-only students (`course_students`, Ana Muslim 2026-11-21). Pinned here:
 *   - the switch is opt-in: without it the new routes answer 402, and nothing else changes;
 *   - a course that is still running refuses; one that FINISHED (end date passed) or was ARCHIVED
 *     turns its course-only students into former students — GRADUATED and soft-deleted, the same as
 *     the single-student deactivate, every record and what they owe kept, and reactivate brings them
 *     back;
 *   - a student with private lessons, another running group, or already gone is left as they are;
 *   - the students list finds everyone who was ever in a group (`filter[group_id]`), former ones too;
 *   - a Quran academy may create an active student with no private plan (the form's third card).
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-course@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-course@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Sheikh Omar', 'user_id' => $this->teacherUser->getKey()]);
    $this->guardian = $this->createGuardian($this->academy);
    $this->students = [];
    foreach (['Adam', 'Bassel', 'Celine', 'Dina'] as $name) {
        $this->students[$name] = $this->createStudent($this->academy, $this->guardian, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function csInContext(string $academyId, callable $fn): mixed
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

function csSwitchOn(string $academyId): void
{
    csInContext($academyId, fn () => DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['course_students']])]));
}

/** A weekly Saturday course from 1 May. */
function csGroup($test, array $students, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', array_merge([
        'name' => 'Tajweed course', 'teacher_id' => $test->teacher, 'start_date' => '2026-05-01',
        'mode' => 'ONLINE', 'student_ids' => $students,
        'slots' => [['weekday' => 6, 'start_time_local' => '18:00', 'duration_minutes' => 60]],
    ], $over))->assertCreated()->json('group.id');
}

function csStudent(string $academyId, string $id): object
{
    return csInContext($academyId, fn () => DB::table('students')->where('id', $id)->first());
}

it('answers 402 without the switch, and the switch is off for a new client', function () {
    $groupId = csGroup($this, [$this->students['Adam']]);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/groups/{$groupId}/former-students")->assertStatus(402);
    $this->postJson("/api/groups/{$groupId}/archive")->assertOk();
    $this->postJson("/api/groups/{$groupId}/former-students")->assertStatus(402);

    expect(csStudent($this->academy, $this->students['Adam'])->deleted_at)->toBeNull();
    $me = $this->getJson('/api/auth/me')->json();
    expect(json_encode($me))->not->toContain('course_students');
});

it('refuses while the course is still running', function () {
    csSwitchOn($this->academy);
    $groupId = csGroup($this, [$this->students['Adam']]);

    Sanctum::actingAs($this->owner);
    $preview = $this->getJson("/api/groups/{$groupId}/former-students")->assertOk();
    expect($preview->json('course_over'))->toBeFalse()
        ->and($preview->json('students.0.outcome'))->toBe('GRADUATE');

    $this->postJson("/api/groups/{$groupId}/former-students")->assertStatus(422);
    expect(csStudent($this->academy, $this->students['Adam'])->deleted_at)->toBeNull();
});

it('turns an archived course\'s course-only students into former students and leaves the rest', function () {
    csSwitchOn($this->academy);
    ['Adam' => $adam, 'Bassel' => $bassel, 'Celine' => $celine, 'Dina' => $dina] = $this->students;
    $groupId = csGroup($this, [$adam, $bassel, $celine, $dina]);
    // Celine goes on in another course; Bassel has private lessons; Dina left the academy already.
    $otherId = csGroup($this, [$celine], ['name' => 'Hifz circle']);
    $this->createSchedule($this->academy, $bassel, $this->teacher);
    $this->clearTenantContext();
    [$invoiceId] = $this->createInvoice($this->academy, $this->guardian);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$dina}/deactivate")->assertOk();
    $this->postJson("/api/groups/{$groupId}/archive")->assertOk();

    $outcomes = collect($this->getJson("/api/groups/{$groupId}/former-students")->assertOk()->json('students'))
        ->mapWithKeys(fn ($r) => [$r['full_name'] => $r['outcome']])->all();
    expect($outcomes)->toBe(['Adam' => 'GRADUATE', 'Bassel' => 'PRIVATE', 'Celine' => 'OTHER_GROUP', 'Dina' => 'ALREADY_FORMER']);

    $res = $this->postJson("/api/groups/{$groupId}/former-students")->assertOk();
    expect($res->json('graduated'))->toBe(1)->and($res->json('kept'))->toBe(3);

    // Adam: graduated, out of the active list, the membership closed, the record kept.
    $a = csStudent($this->academy, $adam);
    expect($a->status)->toBe('GRADUATED')->and($a->deleted_at)->not->toBeNull();
    $membership = csInContext($this->academy, fn () => DB::table('class_group_members')->where('group_id', $groupId)->where('student_id', $adam)->first());
    expect($membership->status)->toBe('LEFT');

    // The rest exactly as they were.
    expect(csStudent($this->academy, $bassel)->deleted_at)->toBeNull()
        ->and(csStudent($this->academy, $bassel)->status)->toBe('REGULAR')
        ->and(csStudent($this->academy, $celine)->deleted_at)->toBeNull()
        ->and(csStudent($this->academy, $dina)->status)->toBe('WITHDRAWN');
    $celineOther = csInContext($this->academy, fn () => DB::table('class_group_members')->where('group_id', $otherId)->where('student_id', $celine)->value('status'));
    expect($celineOther)->toBe('ACTIVE');

    // What the family owes is not touched.
    $bill = csInContext($this->academy, fn () => DB::table('invoices')->where('id', $invoiceId)->first());
    expect($bill)->not->toBeNull()->and($bill->status)->toBe('OPEN');

    // The same audit entry as the single-student button, naming the course.
    $audit = csInContext($this->academy, fn () => DB::table('audit_log')->where('action', 'student.deactivate')->where('entity_id', $adam)->first());
    expect(json_decode((string) $audit->after, true)['course_group_id'] ?? null)->toBe($groupId);

    // Run again: nothing left to move.
    expect($this->postJson("/api/groups/{$groupId}/former-students")->assertOk()->json('graduated'))->toBe(0);

    // The course's former students are found later, and reactivate brings one back.
    $rows = $this->getJson("/api/students?filter[group_id]={$groupId}&filter[status]=inactive")->assertOk()->json('rows');
    expect(collect($rows)->pluck('full_name')->sort()->values()->all())->toBe(['Adam', 'Dina']);
    $this->postJson("/api/students/{$adam}/reactivate")->assertOk();
    expect(csStudent($this->academy, $adam)->deleted_at)->toBeNull();
});

it('works once the end date has passed, without archiving', function () {
    csSwitchOn($this->academy);
    $groupId = csGroup($this, [$this->students['Adam']], ['end_date' => '2026-06-10']);

    Sanctum::actingAs($this->owner);
    expect($this->getJson("/api/groups/{$groupId}/former-students")->json('course_over'))->toBeTrue();
    expect($this->postJson("/api/groups/{$groupId}/former-students")->assertOk()->json('graduated'))->toBe(1);
    expect(csStudent($this->academy, $this->students['Adam'])->status)->toBe('GRADUATED');
});

it('keeps a student who has a trial booked, instead of cancelling it', function () {
    csSwitchOn($this->academy);
    $adam = $this->students['Adam'];
    $groupId = csGroup($this, [$adam]);
    csInContext($this->academy, fn () => DB::table('trials')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $adam,
        'teacher_id' => $this->teacher, 'timezone' => 'Africa/Cairo', 'scheduled_at_utc' => '2026-06-20 10:00:00+00',
        'duration_minutes' => 30, 'status' => 'SCHEDULED',
    ]));

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/archive")->assertOk();
    expect($this->getJson("/api/groups/{$groupId}/former-students")->json('students.0.outcome'))->toBe('PRIVATE');
    expect($this->postJson("/api/groups/{$groupId}/former-students")->assertOk()->json('graduated'))->toBe(0);

    expect(csStudent($this->academy, $adam)->deleted_at)->toBeNull()
        ->and(csInContext($this->academy, fn () => DB::table('trials')->where('student_id', $adam)->value('status')))->toBe('SCHEDULED');
});

it('is the office\'s: a teacher cannot do it', function () {
    csSwitchOn($this->academy);
    $groupId = csGroup($this, [$this->students['Adam']], ['end_date' => '2026-06-10']);

    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/groups/{$groupId}/former-students")->assertForbidden();
    expect(csStudent($this->academy, $this->students['Adam'])->deleted_at)->toBeNull();
});

it('filters the students list by any group a student was ever in', function () {
    $groupId = csGroup($this, [$this->students['Adam'], $this->students['Bassel']]);

    Sanctum::actingAs($this->owner);
    $names = fn (string $q) => collect($this->getJson("/api/students?{$q}")->assertOk()->json('rows'))->pluck('full_name')->sort()->values()->all();
    expect($names("filter[group_id]={$groupId}"))->toBe(['Adam', 'Bassel'])
        ->and($names('filter[group_id]=not-a-uuid'))->toBe([])
        ->and($names(''))->toBe(['Adam', 'Bassel', 'Celine', 'Dina']);
});

it('lets a Quran academy add an active student on a group alone, with no private plan', function () {
    csSwitchOn($this->academy);
    $groupId = csGroup($this, []);

    Sanctum::actingAs($this->owner);
    $id = $this->postJson('/api/students', [
        'full_name' => 'Yusuf', 'guardian_id' => $this->guardian, 'status' => 'REGULAR',
    ])->assertCreated()->json('studentId');
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$id], 'joined_on' => '2026-06-17'])->assertSuccessful();

    $hasPlan = csInContext($this->academy, fn () => DB::table('subscriptions')->where('student_id', $id)->exists());
    expect($hasPlan)->toBeFalse()->and(csStudent($this->academy, $id)->status)->toBe('REGULAR');
});
