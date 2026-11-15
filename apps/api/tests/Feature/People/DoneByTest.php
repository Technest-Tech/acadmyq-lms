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

// ── Handing a supervisor's people to another ─────────────────────────────────

it('hands a supervisor\'s students, teachers and parents to another supervisor', function () {
    Sanctum::actingAs($this->supA);
    $this->postJson('/api/students', ['full_name' => 'Pupil of A', 'guardian_id' => $this->guardian])->assertCreated();
    $teacher = (string) $this->postJson('/api/teachers', ['full_name' => 'Teacher of A', 'session_rate_minor' => 0])->assertCreated()->json('teacherId');
    $this->postJson('/api/guardians', ['full_name' => 'Parent of A', 'whatsapp_phone' => '+201001234500', 'currency' => 'EGP'])->assertCreated();
    Sanctum::actingAs($this->supB);
    $this->postJson('/api/students', ['full_name' => 'Pupil of B', 'guardian_id' => $this->guardian])->assertCreated();

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/team/actors/{$this->supA->id}/handover")->assertOk()
        ->assertJson(['counts' => ['student' => 1, 'teacher' => 1, 'guardian' => 1]]);

    $this->postJson("/api/team/actors/{$this->supA->id}/handover", [
        'to_user_id' => (string) $this->supB->id, 'types' => ['student', 'teacher', 'guardian'],
    ])->assertOk()->assertJson(['moved' => ['student' => 1, 'teacher' => 1, 'guardian' => 1]]);

    // Every list now names B, and B's filter finds them; A answers for nothing any more.
    $students = collect($this->getJson('/api/students?pageSize=50')->assertOk()->json('rows'))->keyBy('full_name');
    expect($students['Pupil of A']['added_by_name'])->toBe('Supervisor B');
    expect($this->getJson("/api/students?filter[added_by]={$this->supB->id}")->json('total'))->toBe(2)
        ->and($this->getJson("/api/students?filter[added_by]={$this->supA->id}")->json('total'))->toBe(0);
    $teachers = collect($this->getJson('/api/teachers?pageSize=50')->assertOk()->json('rows'))->keyBy('full_name');
    expect($teachers['Teacher of A']['added_by_name'])->toBe('Supervisor B');
    $parents = collect($this->getJson('/api/guardians?pageSize=50')->assertOk()->json('rows'))->keyBy('full_name');
    expect($parents['Parent of A']['added_by_name'])->toBe('Supervisor B');
    $this->getJson("/api/team/actors/{$this->supA->id}/handover")->assertOk()
        ->assertJson(['counts' => ['student' => 0, 'teacher' => 0, 'guardian' => 0]]);

    $this->asAcademy($this->academy);
    // History is kept: the audit log still says A added them; the handover is one entry of its own.
    expect(Illuminate\Support\Facades\DB::table('audit_log')->where('action', 'teacher.create')->where('entity_id', $teacher)->value('actor_user_id'))->toBe((string) $this->supA->id)
        ->and(Illuminate\Support\Facades\DB::table('audit_log')->where('action', 'supervisor.handover')->where('entity_id', (string) $this->supA->id)->exists())->toBeTrue();
});

it('moves the handed-over students\' lessons into the new supervisor\'s "My lessons"', function () {
    Sanctum::actingAs($this->supA);
    $pupil = (string) $this->postJson('/api/students', ['full_name' => 'Pupil of A', 'guardian_id' => $this->guardian])->assertCreated()->json('studentId');
    $teacher = $this->createTeacher($this->academy);
    $lesson = $this->createSession($this->academy, $pupil, $teacher, ['scheduled_at_utc' => '2026-06-11 06:00:00+00', 'status' => 'SCHEDULED']);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->supB->id, 'types' => ['student']])->assertOk();

    $ids = fn (string $url) => collect($this->getJson($url)->assertOk()->json('sessions'))->pluck('id')->all();
    Sanctum::actingAs($this->supB);
    expect($ids('/api/sessions/day?from=2026-06-11T00:00:00Z&to=2026-06-12T00:00:00Z&mine=1'))->toBe([$lesson])
        ->and($ids('/api/sessions/overdue?mine=1'))->toBe([$lesson]);
    expect(collect($this->getJson('/api/sessions/overdue')->json('sessions'))->firstWhere('id', $lesson)['added_by_name'])->toBe('Supervisor B');
    Sanctum::actingAs($this->supA);
    expect($ids('/api/sessions/overdue?mine=1'))->toBe([]);
});

it('moves only the kinds picked, and only live records', function () {
    Sanctum::actingAs($this->supA);
    $kept = (string) $this->postJson('/api/students', ['full_name' => 'Stays with A', 'guardian_id' => $this->guardian])->assertCreated()->json('studentId');
    $gone = (string) $this->postJson('/api/students', ['full_name' => 'Removed pupil', 'guardian_id' => $this->guardian])->assertCreated()->json('studentId');
    $this->postJson('/api/teachers', ['full_name' => 'Teacher of A', 'session_rate_minor' => 0])->assertCreated();
    $this->asAcademy($this->academy);
    Illuminate\Support\Facades\DB::table('students')->where('id', $gone)->update(['deleted_at' => now()]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->supB->id, 'types' => ['teacher']])
        ->assertOk()->assertJson(['moved' => ['student' => 0, 'teacher' => 1, 'guardian' => 0]]);

    $students = collect($this->getJson('/api/students?pageSize=50')->json('rows'))->keyBy('full_name');
    expect($students['Stays with A']['added_by_name'])->toBe('Supervisor A');
    $this->asAcademy($this->academy);
    expect(Illuminate\Support\Facades\DB::table('supervisor_assignments')->where('entity_id', $gone)->exists())->toBeFalse()
        ->and(Illuminate\Support\Facades\DB::table('supervisor_assignments')->where('entity_id', $kept)->exists())->toBeFalse();
});

it('hands over only to an active member of the team, and only for someone who runs the team', function () {
    Sanctum::actingAs($this->supA);
    $this->postJson('/api/teachers', ['full_name' => 'Teacher of A', 'session_rate_minor' => 0])->assertCreated();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->teacherUser->id, 'types' => ['teacher']])
        ->assertUnprocessable()->assertJsonValidationErrors(['to_user_id']);
    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->supA->id, 'types' => ['teacher']])
        ->assertUnprocessable()->assertJsonValidationErrors(['to_user_id']);
    $this->asAcademy($this->academy);
    Illuminate\Support\Facades\DB::table('users')->where('id', $this->supB->id)->update(['is_active' => false]);
    $this->clearTenantContext();
    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->supB->id, 'types' => ['teacher']])
        ->assertUnprocessable()->assertJsonValidationErrors(['to_user_id']);
    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->owner->id, 'types' => ['nonsense']])
        ->assertUnprocessable()->assertJsonValidationErrors(['types.0']);

    // A supervisor does not run the team.
    Sanctum::actingAs($this->supA);
    $this->getJson("/api/team/actors/{$this->supA->id}/handover")->assertForbidden();
    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->owner->id, 'types' => ['teacher']])->assertForbidden();
});

it('lists every supervisor who still has people, the gone ones first, and hands over from them', function () {
    Sanctum::actingAs($this->supA);
    $this->postJson('/api/students', ['full_name' => 'Pupil of A', 'guardian_id' => $this->guardian])->assertCreated();
    $this->postJson('/api/teachers', ['full_name' => 'Teacher of A', 'session_rate_minor' => 0])->assertCreated();
    Sanctum::actingAs($this->supB);
    $this->postJson('/api/students', ['full_name' => 'Pupil of B', 'guardian_id' => $this->guardian])->assertCreated();
    // A has left: her role was taken away, so she is no longer on the team at all.
    $this->asAcademy($this->academy);
    Illuminate\Support\Facades\DB::table('user_roles')->where('user_id', $this->supA->id)->delete();
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $owners = collect($this->getJson('/api/team/handover')->assertOk()->json('owners'));
    $a = $owners->firstWhere('user_id', (string) $this->supA->id);
    expect($owners->first()['user_id'])->toBe((string) $this->supA->id)
        ->and($a['state'])->toBe('gone')
        ->and($a['name'])->toBe('Supervisor A')
        ->and($a['counts'])->toBe(['student' => 1, 'teacher' => 1, 'guardian' => 0])
        ->and($owners->firstWhere('user_id', (string) $this->supB->id)['state'])->toBe('active');

    $this->postJson("/api/team/actors/{$this->supA->id}/handover", ['to_user_id' => (string) $this->supB->id, 'types' => ['student', 'teacher']])
        ->assertOk()->assertJson(['moved' => ['student' => 1, 'teacher' => 1, 'guardian' => 0]]);

    expect(collect($this->getJson('/api/team/handover')->json('owners'))->firstWhere('user_id', (string) $this->supA->id))->toBeNull();
    $students = collect($this->getJson('/api/students?pageSize=50')->json('rows'))->keyBy('full_name');
    expect($students['Pupil of A']['added_by_name'])->toBe('Supervisor B');
});

it('gives a supervisor to the records nobody on the team added', function () {
    // A fixture or an import: no creator in the audit log.
    $imported = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Imported pupil']);

    Sanctum::actingAs($this->owner);
    $nobody = collect($this->getJson('/api/team/handover')->assertOk()->json('owners'))->firstWhere('state', 'nobody');
    expect($nobody['user_id'])->toBeNull()->and($nobody['counts']['student'])->toBeGreaterThanOrEqual(1);

    $this->postJson('/api/team/actors/none/handover', ['to_user_id' => (string) $this->supB->id, 'types' => ['student']])->assertOk();

    $students = collect($this->getJson('/api/students?pageSize=50')->json('rows'))->keyBy('id');
    expect($students[$imported]['added_by_name'])->toBe('Supervisor B');
    // Only someone who runs the team sees the list.
    Sanctum::actingAs($this->supA);
    $this->getJson('/api/team/handover')->assertForbidden();
});
