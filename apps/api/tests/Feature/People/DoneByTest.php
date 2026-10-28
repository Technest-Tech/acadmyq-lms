<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * "Done by" — an academy run by several supervisors needs to see who did what on its lists, and
 * narrow a list to one person's work. Who created a row comes from the audit trail; who marked a
 * lesson comes from `sessions.outcome_set_by`.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-doneby@test.local', 'full_name' => 'Owner One']);
    $this->supA = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-a@test.local', 'full_name' => 'Supervisor A']);
    $this->supB = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-b@test.local', 'full_name' => 'Supervisor B']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-doneby@test.local', 'full_name' => 'Teacher T']);
    $this->guardian = $this->createGuardian($this->academy);
});

afterEach(fn () => Carbon::setTestNow());

it('names who added each student and filters the list by them', function () {
    Sanctum::actingAs($this->supA);
    $this->postJson('/api/students', ['full_name' => 'Added By A', 'guardian_id' => $this->guardian])->assertCreated();
    Sanctum::actingAs($this->supB);
    $this->postJson('/api/students', ['full_name' => 'Added By B', 'guardian_id' => $this->guardian])->assertCreated();

    Sanctum::actingAs($this->owner);
    $rows = collect($this->getJson('/api/students?pageSize=50')->assertOk()->json('rows'))->keyBy('full_name');
    expect($rows['Added By A']['added_by_name'])->toBe('Supervisor A')
        ->and($rows['Added By A']['added_by_user_id'])->toBe((string) $this->supA->id)
        ->and($rows['Added By B']['added_by_name'])->toBe('Supervisor B');

    $filtered = $this->getJson("/api/students?filter[added_by]={$this->supA->id}")->assertOk();
    expect($filtered->json('total'))->toBe(1)
        ->and($filtered->json('rows.0.full_name'))->toBe('Added By A');

    // A value that is not a user id narrows to nothing instead of failing the cast.
    expect($this->getJson('/api/students?filter[added_by]=nope')->assertOk()->json('total'))->toBe(0);
});

it('names who added each teacher and parent', function () {
    Sanctum::actingAs($this->supB);
    $this->postJson('/api/teachers', ['full_name' => 'New Teacher', 'session_rate_minor' => 0])->assertCreated();
    $this->postJson('/api/guardians', ['full_name' => 'New Parent', 'whatsapp_phone' => '+201001234567', 'currency' => 'EGP'])->assertCreated();

    Sanctum::actingAs($this->owner);
    $teacher = collect($this->getJson('/api/teachers')->assertOk()->json('rows'))->firstWhere('full_name', 'New Teacher');
    expect($teacher['added_by_name'])->toBe('Supervisor B');
    expect($this->getJson("/api/teachers?filter[added_by]={$this->supA->id}")->json('total'))->toBe(0);

    $parent = collect($this->getJson('/api/guardians?pageSize=50')->assertOk()->json('rows'))->firstWhere('full_name', 'New Parent');
    expect($parent['added_by_name'])->toBe('Supervisor B');

    // A row made outside the audited forms (fixtures, old data) simply has no "done by".
    $fixture = collect($this->getJson('/api/guardians?pageSize=50')->json('rows'))->firstWhere('id', $this->guardian);
    expect($fixture['added_by_name'])->toBeNull();
});

it('names who marked each lesson, and whether it was the teacher', function () {
    $teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id, 'full_name' => 'Teacher T']);
    $student = $this->createStudent($this->academy, $this->guardian);
    $bySup = $this->createSession($this->academy, $student, $teacher, ['scheduled_at_utc' => '2026-06-11 08:00:00+00', 'status' => 'SCHEDULED']);
    $byTeacher = $this->createSession($this->academy, $student, $teacher, ['scheduled_at_utc' => '2026-06-11 09:00:00+00', 'status' => 'SCHEDULED']);
    $pending = $this->createSession($this->academy, $student, $teacher, ['scheduled_at_utc' => '2026-06-11 10:00:00+00', 'status' => 'SCHEDULED']);

    Sanctum::actingAs($this->supA);
    $this->postJson("/api/sessions/{$bySup}/attendance", ['status' => 'ATTENDED'])->assertOk();
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$byTeacher}/attendance", ['status' => 'ATTENDED'])->assertOk();

    Sanctum::actingAs($this->owner);
    $rows = collect($this->getJson('/api/sessions/day?from=2026-06-11T00:00:00Z&to=2026-06-12T00:00:00Z')
        ->assertOk()->json('sessions'))->keyBy('id');

    expect($rows[$bySup]['done_by_name'])->toBe('Supervisor A')
        ->and($rows[$bySup]['done_by_teacher'])->toBeFalse()
        ->and($rows[$byTeacher]['done_by_name'])->toBe('Teacher T')
        ->and($rows[$byTeacher]['done_by_teacher'])->toBeTrue()
        ->and($rows[$pending]['done_by_user_id'])->toBeNull();
});

it('lists the team for the filter, without teachers, and keeps it from teachers', function () {
    Sanctum::actingAs($this->owner);
    $actors = collect($this->getJson('/api/team/actors')->assertOk()->json('actors'));

    expect($actors->pluck('name')->all())->toBe(['Owner One', 'Supervisor A', 'Supervisor B'])
        ->and($actors->firstWhere('name', 'Supervisor A')['role'])->toBe('SUPERVISOR')
        ->and(Str::isUuid($actors->first()['id']))->toBeTrue();

    Sanctum::actingAs($this->supA);
    $this->getJson('/api/team/actors')->assertOk();

    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/team/actors')->assertForbidden();
});

it('narrows the attendance list and the held-up lessons to the students the caller added', function () {
    $teacher = $this->createTeacher($this->academy);
    Sanctum::actingAs($this->supA);
    $mine = (string) $this->postJson('/api/students', ['full_name' => 'Added By A', 'guardian_id' => $this->guardian])->assertCreated()->json('studentId');
    Sanctum::actingAs($this->supB);
    $theirs = (string) $this->postJson('/api/students', ['full_name' => 'Added By B', 'guardian_id' => $this->guardian])->assertCreated()->json('studentId');
    // A student nobody on the team added (an import, a fixture) is nobody's.
    $imported = $this->createStudent($this->academy, $this->guardian);

    // 06:00 ended long before the 4-hour grace ran out at 12:00, so each is also held up.
    $mineLesson = $this->createSession($this->academy, $mine, $teacher, ['scheduled_at_utc' => '2026-06-11 06:00:00+00', 'status' => 'SCHEDULED']);
    $theirLesson = $this->createSession($this->academy, $theirs, $teacher, ['scheduled_at_utc' => '2026-06-11 06:00:00+00', 'status' => 'SCHEDULED']);
    $importedLesson = $this->createSession($this->academy, $imported, $teacher, ['scheduled_at_utc' => '2026-06-11 06:00:00+00', 'status' => 'SCHEDULED']);

    $window = 'from=2026-06-11T00:00:00Z&to=2026-06-12T00:00:00Z';
    Sanctum::actingAs($this->supA);

    $ids = fn (string $url) => collect($this->getJson($url)->assertOk()->json('sessions'))->pluck('id')->sort()->values()->all();
    $all = collect([$mineLesson, $theirLesson, $importedLesson])->sort()->values()->all();

    expect($ids("/api/sessions/day?{$window}&mine=1"))->toBe([$mineLesson])
        ->and($ids("/api/sessions/day?{$window}"))->toBe($all)
        ->and($ids('/api/sessions/overdue?mine=1'))->toBe([$mineLesson])
        ->and($this->getJson('/api/sessions/overdue?mine=1')->json('count'))->toBe(1)
        ->and($ids('/api/sessions/overdue'))->toBe($all);

    // The flag is always the CALLER's students — the other supervisor sees their own.
    Sanctum::actingAs($this->supB);
    expect($ids("/api/sessions/day?{$window}&mine=1"))->toBe([$theirLesson]);
});

it('names the supervisor who added the student on every held-up lesson', function () {
    $teacher = $this->createTeacher($this->academy);
    Sanctum::actingAs($this->supA);
    $byA = (string) $this->postJson('/api/students', ['full_name' => 'Added By A', 'guardian_id' => $this->guardian])->assertCreated()->json('studentId');
    $imported = $this->createStudent($this->academy, $this->guardian);

    // Both ended long before the 4-hour grace ran out at 12:00, so both are held up.
    $aLesson = $this->createSession($this->academy, $byA, $teacher, ['scheduled_at_utc' => '2026-06-11 06:00:00+00', 'status' => 'SCHEDULED']);
    $importedLesson = $this->createSession($this->academy, $imported, $teacher, ['scheduled_at_utc' => '2026-06-11 06:30:00+00', 'status' => 'SCHEDULED']);

    Sanctum::actingAs($this->owner);
    $rows = collect($this->getJson('/api/sessions/overdue')->assertOk()->json('sessions'))->keyBy('id');

    expect($rows[$aLesson]['added_by_name'])->toBe('Supervisor A')
        ->and($rows[$aLesson]['added_by_user_id'])->toBe((string) $this->supA->id)
        // A student nobody on the team added answers to nobody.
        ->and($rows[$importedLesson]['added_by_user_id'])->toBeNull();
});
