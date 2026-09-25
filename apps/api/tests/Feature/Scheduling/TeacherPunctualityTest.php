<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Teacher meeting links: the owner sets a teacher's link, the teacher presses Enter on a lesson
 * (POST /sessions/{id}/join) while it is on, and the teacher's profile measures when they entered
 * (GET /teachers/{id}/punctuality).
 */
beforeEach(function () {
    Carbon::setTestNow('2026-09-26 13:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['full_name' => 'Owner Omar']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['full_name' => 'Mona Teacher']);
    $this->teacher = $this->createTeacher($this->academy, [
        'full_name' => 'Mona Teacher',
        'user_id' => $this->teacherUser->id,
        'meeting_url' => 'https://zoom.us/j/111',
        'join_tracking_since' => '2026-09-01 00:00:00+00',
    ]);
    $this->student = $this->createStudent($this->academy, overrides: ['full_name' => 'Omar Pupil']);

    // Starts in 5 minutes.
    $this->soon = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-09-26 13:05:00+00', 'status' => 'SCHEDULED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

function enterLesson(string $sessionId): TestResponse
{
    return test()->postJson("/api/sessions/{$sessionId}/join");
}

/** Insert an Enter press directly, at an explicit instant. */
function pressedEnterAt(string $academyId, string $sessionId, string $teacherId, string $at): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('session_joins')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'session_id' => $sessionId,
        'teacher_id' => $teacherId, 'joined_at' => $at, 'created_at' => $at,
    ]);
    test()->clearTenantContext();
}

// ── The link ─────────────────────────────────────────────────────────────────

it('lets the owner set, change and clear a link, and starts the clock only once', function () {
    $fresh = $this->createTeacher($this->academy, ['full_name' => 'New Teacher']);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/teachers/{$fresh}", ['meeting_url' => 'not a link'])->assertStatus(422);
    $this->patchJson("/api/teachers/{$fresh}", ['meeting_url' => 'javascript:alert(1)'])->assertStatus(422);

    $this->patchJson("/api/teachers/{$fresh}", ['meeting_url' => ' https://meet.google.com/abc-defg-hij '])
        ->assertOk()->assertJsonPath('changed', ['meeting_url']);

    $this->enterAcademyAsSuperAdmin($this->academy);
    $row = DB::table('teachers')->where('id', $fresh)->first();
    $this->clearTenantContext();
    expect($row->meeting_url)->toBe('https://meet.google.com/abc-defg-hij');
    expect(Carbon::parse($row->join_tracking_since)->utc()->toIso8601String())->toBe('2026-09-26T13:00:00+00:00');

    // A new link later, then no link: the clock keeps its first start.
    Carbon::setTestNow('2026-09-27 09:00:00');
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$fresh}", ['meeting_url' => 'https://zoom.us/j/999'])->assertOk();
    $this->patchJson("/api/teachers/{$fresh}", ['meeting_url' => ''])->assertOk();

    $this->enterAcademyAsSuperAdmin($this->academy);
    $row = DB::table('teachers')->where('id', $fresh)->first();
    expect($row->meeting_url)->toBeNull();
    expect(Carbon::parse($row->join_tracking_since)->utc()->toIso8601String())->toBe('2026-09-26T13:00:00+00:00');
    expect(DB::table('audit_log')->where('action', 'teacher.update')->where('entity_id', $fresh)->count())->toBe(3);
});

it('returns the link on the teacher rows, with the teacher\'s first press', function () {
    pressedEnterAt($this->academy, $this->soon, $this->teacher, '2026-09-26 12:57:00+00');
    pressedEnterAt($this->academy, $this->soon, $this->teacher, '2026-09-26 12:59:00+00');
    Sanctum::actingAs($this->teacherUser);

    $row = collect($this->getJson('/api/sessions/day?from=2026-09-26T00:00:00Z&to=2026-09-27T00:00:00Z')->assertOk()->json('sessions'))
        ->firstWhere('id', $this->soon);

    expect($row)->toMatchArray([
        'meeting_url' => 'https://zoom.us/j/111',
        'teacher_joined_at' => '2026-09-26T12:57:00+00:00',
    ]);
});

// ── The Enter button ─────────────────────────────────────────────────────────

it('logs every press with the server clock and hands back the link', function () {
    Sanctum::actingAs($this->teacherUser);

    enterLesson($this->soon)->assertCreated()->assertJson([
        'url' => 'https://zoom.us/j/111',
        'joined_at' => '2026-09-26T13:00:00+00:00',
        'first_joined_at' => '2026-09-26T13:00:00+00:00',
    ]);

    // Dropped and came back: a second press is logged; the first one still decides.
    Carbon::setTestNow('2026-09-26 13:12:00');
    enterLesson($this->soon)->assertCreated()->assertJson([
        'joined_at' => '2026-09-26T13:12:00+00:00',
        'first_joined_at' => '2026-09-26T13:00:00+00:00',
    ]);

    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('session_joins')->where('session_id', $this->soon)->where('user_id', $this->teacherUser->id)->count())->toBe(2);
});

it('only opens from ten minutes before the start until the end', function () {
    Sanctum::actingAs($this->teacherUser);

    Carbon::setTestNow('2026-09-26 12:54:00');
    enterLesson($this->soon)->assertStatus(422);

    Carbon::setTestNow('2026-09-26 12:55:00');
    enterLesson($this->soon)->assertCreated();

    // 30-minute lesson: open through 13:35, shut after.
    Carbon::setTestNow('2026-09-26 13:35:00');
    enterLesson($this->soon)->assertCreated();
    Carbon::setTestNow('2026-09-26 13:36:00');
    enterLesson($this->soon)->assertStatus(422);
});

it('refuses a cancelled lesson, and a teacher with no link', function () {
    $cancelled = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-09-26 13:00:00+00', 'status' => 'CANCELLED_BY_STUDENT',
    ]);
    Sanctum::actingAs($this->teacherUser);
    enterLesson($cancelled)->assertStatus(422);

    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('teachers')->where('id', $this->teacher)->update(['meeting_url' => null]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->teacherUser);
    enterLesson($this->soon)->assertStatus(422);
});

it('is the lesson\'s own teacher only', function () {
    $otherUser = $this->makeUser($this->academy, 'TEACHER');
    $this->createTeacher($this->academy, ['user_id' => $otherUser->id, 'meeting_url' => 'https://zoom.us/j/222']);

    Sanctum::actingAs($otherUser);
    enterLesson($this->soon)->assertForbidden();

    // The owner looking in is not the teacher arriving.
    Sanctum::actingAs($this->owner);
    enterLesson($this->soon)->assertForbidden();

    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('session_joins')->count())->toBe(0);
});

// ── The statistics ───────────────────────────────────────────────────────────

it('measures each lesson from its start by the first press', function () {
    // Yesterday (the 25th in Cairo), 30-minute lessons. Clock: 2026-09-26 13:00 UTC.
    $onTime = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-25 08:00:00+00', 'status' => 'ATTENDED']);
    $early = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-25 09:00:00+00', 'status' => 'ATTENDED']);
    $late = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-25 10:00:00+00', 'status' => 'ABSENT_UNEXCUSED']);
    $missed = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-25 11:00:00+00', 'status' => 'SCHEDULED']);
    // Left out: cancelled, and a lesson that has not started.
    $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-25 12:00:00+00', 'status' => 'CANCELLED_BY_TEACHER']);

    pressedEnterAt($this->academy, $onTime, $this->teacher, '2026-09-25 08:04:00+00');
    pressedEnterAt($this->academy, $early, $this->teacher, '2026-09-25 08:53:00+00');
    pressedEnterAt($this->academy, $late, $this->teacher, '2026-09-25 10:18:00+00');
    pressedEnterAt($this->academy, $late, $this->teacher, '2026-09-25 10:25:00+00');

    Sanctum::actingAs($this->owner);
    $res = $this->getJson("/api/teachers/{$this->teacher}/punctuality?from=2026-09-25&to=2026-09-26&late_minutes=5")->assertOk();

    expect($res->json('totals'))->toMatchArray([
        'lessons' => 4, 'measured' => 4, 'entered' => 3,
        'on_time' => 2, 'late' => 1, 'missed' => 1, 'pending' => 0,
        'on_time_rate' => 50.0,
        'entered_rate' => 75.0,
        'avg_delay_minutes' => 7.3,   // (4 + 0 + 18) / 3 — early counts as zero
        'avg_late_minutes' => 18.0,
    ]);
    expect($res->json('has_meeting_url'))->toBeTrue();

    $rows = collect($res->json('sessions'))->keyBy('id');
    expect($rows[$onTime])->toMatchArray(['bucket' => 'on_time', 'delay_minutes' => 4, 'local_date' => '2026-09-25']);
    expect($rows[$early])->toMatchArray(['bucket' => 'on_time', 'delay_minutes' => -7]);
    expect($rows[$late])->toMatchArray(['bucket' => 'late', 'delay_minutes' => 18, 'first_joined_at' => '2026-09-25T10:18:00+00:00']);
    expect($rows[$late]['joins'])->toHaveCount(2);
    expect($rows[$missed])->toMatchArray(['bucket' => 'missed', 'delay_minutes' => null, 'first_joined_at' => null]);
    // The lesson starting in five minutes has not started, so it is not measured at all.
    expect($rows->has($this->soon))->toBeFalse();

    // A looser threshold turns the late lesson on time.
    $loose = $this->getJson("/api/teachers/{$this->teacher}/punctuality?from=2026-09-25&to=2026-09-25&late_minutes=20")->assertOk();
    expect($loose->json('totals'))->toMatchArray(['on_time' => 3, 'late' => 0, 'missed' => 1]);
});

it('calls a lesson that is still on pending, not missed', function () {
    Carbon::setTestNow('2026-09-26 13:20:00'); // $this->soon started 15 minutes ago, not entered yet
    Sanctum::actingAs($this->owner);

    $res = $this->getJson("/api/teachers/{$this->teacher}/punctuality?from=2026-09-26&to=2026-09-26")->assertOk();

    expect($res->json('totals'))->toMatchArray(['lessons' => 1, 'pending' => 1, 'missed' => 0, 'measured' => 0, 'on_time_rate' => null]);
});

it('does not count lessons from before the teacher had a link', function () {
    $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-08-20 10:00:00+00', 'status' => 'ATTENDED']);
    $noLinkUser = $this->makeUser($this->academy, 'TEACHER');
    $noLink = $this->createTeacher($this->academy, ['user_id' => $noLinkUser->id]);
    $this->createSession($this->academy, $this->student, $noLink, ['scheduled_at_utc' => '2026-09-25 10:00:00+00', 'status' => 'ATTENDED']);
    Sanctum::actingAs($this->owner);

    // Tracking began 2026-09-01: August is out.
    $this->getJson("/api/teachers/{$this->teacher}/punctuality?from=2026-08-01&to=2026-08-31")->assertOk()
        ->assertJsonPath('totals.lessons', 0)
        ->assertJsonPath('tracking_since', '2026-09-01T00:00:00+00:00');

    // Never had a link: nothing is measured, and the page can say why.
    $this->getJson("/api/teachers/{$noLink}/punctuality?from=2026-09-01&to=2026-09-30")->assertOk()
        ->assertJsonPath('totals.lessons', 0)
        ->assertJsonPath('tracking_since', null)
        ->assertJsonPath('has_meeting_url', false);
});

it('is for people who can read teachers; a teacher is refused', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->getJson("/api/teachers/{$this->teacher}/punctuality?from=2026-09-01&to=2026-09-30")->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/teachers/{$this->teacher}/punctuality?from=2026-09-30&to=2026-09-01")->assertStatus(422);
    $this->getJson('/api/teachers/'.Str::uuid().'/punctuality?from=2026-09-01&to=2026-09-30')->assertNotFound();
});
