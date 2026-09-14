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
 * Supervision: the "Following" click on a lesson (POST /sessions/{id}/follow), the follow state
 * carried on every session row, and the statistics page (GET /supervision/stats) that measures
 * how promptly supervisors followed and how promptly outcomes were recorded.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-09-14 13:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['full_name' => 'Owner Omar']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['full_name' => 'Sara Supervisor']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['full_name' => 'Mona Teacher']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Mona Teacher', 'user_id' => $this->teacherUser->id]);
    $this->student = $this->createStudent($this->academy, overrides: ['full_name' => 'Omar Pupil']);

    // Started 5 minutes ago, still unmarked.
    $this->live = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-09-14 12:55:00+00', 'status' => 'SCHEDULED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

function follow(string $sessionId): TestResponse
{
    return test()->postJson("/api/sessions/{$sessionId}/follow");
}

/** Insert a "Following" click directly, at an explicit instant. */
function followedAt(string $academyId, string $sessionId, string $userId, string $at): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('session_follow_ups')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'session_id' => $sessionId,
        'user_id' => $userId, 'followed_at' => $at, 'created_at' => $at,
    ]);
    test()->clearTenantContext();
}

/** Record an outcome directly, at an explicit instant, by an explicit user. */
function markedAt(string $academyId, string $sessionId, string $status, string $userId, string $at): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('sessions')->where('id', $sessionId)->update([
        'status' => $status, 'outcome_set_at' => $at, 'outcome_set_by' => $userId,
    ]);
    test()->clearTenantContext();
}

// ── The button ───────────────────────────────────────────────────────────────

it('records the click with its instant, once, and reports who is following', function () {
    Sanctum::actingAs($this->supervisor);

    $first = follow($this->live)->assertCreated()->json('follow');
    expect($first['followed_at'])->toBe('2026-09-14T13:00:00+00:00')
        ->and($first['followed_by_name'])->toBe('Sara Supervisor')
        ->and($first['followed_by_user_id'])->toBe($this->supervisor->id);

    // Pressing again changes nothing.
    Carbon::setTestNow('2026-09-14 13:04:00');
    follow($this->live)->assertOk()->assertJsonPath('follow.followed_at', '2026-09-14T13:00:00+00:00');

    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('session_follow_ups')->where('session_id', $this->live)->count())->toBe(1);
    expect(DB::table('audit_log')->where('action', 'session.followed')->where('entity_id', $this->live)->count())->toBe(1);
});

it('lists every supervisor who followed, first click first', function () {
    Sanctum::actingAs($this->supervisor);
    follow($this->live)->assertCreated();

    Carbon::setTestNow('2026-09-14 13:03:00');
    Sanctum::actingAs($this->owner);
    $state = follow($this->live)->assertCreated()->json('follow');

    expect($state['followed_by_name'])->toBe('Sara Supervisor');
    expect(collect($state['follow_ups'])->pluck('name')->all())->toBe(['Sara Supervisor', 'Owner Omar']);
});

it('is for supervisors and owners, not teachers', function () {
    Sanctum::actingAs($this->teacherUser);
    follow($this->live)->assertForbidden();
});

it('refuses a lesson that already has an outcome, or has not started', function () {
    Sanctum::actingAs($this->supervisor);

    $marked = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-09-14 12:00:00+00', 'status' => 'ATTENDED',
    ]);
    follow($marked)->assertStatus(422);

    $later = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-09-14 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
    follow($later)->assertStatus(422);

    // Waiting at the door is fine: up to an hour before the start.
    $soon = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-09-14 13:50:00+00', 'status' => 'SCHEDULED',
    ]);
    follow($soon)->assertCreated();
});

it('shows the follow state on the day, pending, overdue and detail views', function () {
    followedAt($this->academy, $this->live, $this->supervisor->id, '2026-09-14 12:57:00+00');
    $unfollowed = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-09-14 12:00:00+00', 'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);

    $day = collect($this->getJson('/api/sessions/day?from=2026-09-14T00:00:00Z&to=2026-09-15T00:00:00Z')->assertOk()->json('sessions'));
    expect($day->firstWhere('id', $this->live))->toMatchArray(['followed_at' => '2026-09-14T12:57:00+00:00', 'followed_by_name' => 'Sara Supervisor']);
    expect($day->firstWhere('id', $unfollowed)['followed_at'])->toBeNull();

    $pending = collect($this->getJson('/api/sessions/pending-attendance')->assertOk()->json('sessions'));
    expect($pending->firstWhere('id', $this->live)['followed_by_name'])->toBe('Sara Supervisor');

    // Overdue = ended 4h+ ago; move the clock on so the live lesson qualifies.
    Carbon::setTestNow('2026-09-14 18:00:00');
    $overdue = collect($this->getJson('/api/sessions/overdue')->assertOk()->json('sessions'));
    expect($overdue->firstWhere('id', $this->live)['followed_by_name'])->toBe('Sara Supervisor');

    $this->getJson("/api/sessions/{$this->live}")->assertOk()
        ->assertJsonPath('session.followed_at', '2026-09-14T12:57:00+00:00')
        ->assertJsonPath('session.followed_by_name', 'Sara Supervisor');
});

// ── The statistics ───────────────────────────────────────────────────────────

it('measures follow and marking promptness per lesson and per person', function () {
    // Yesterday, Cairo time, four lessons of 30 minutes. Clock is 2026-09-14 13:00 UTC.
    $a = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-13 08:00:00+00', 'status' => 'SCHEDULED']);
    $b = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-13 09:00:00+00', 'status' => 'SCHEDULED']);
    $c = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-13 10:00:00+00', 'status' => 'SCHEDULED']);
    $d = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-13 11:00:00+00', 'status' => 'SCHEDULED']);

    // a: Sara followed 3 min after the start (on time); she marked it 20 min after the end (on time).
    followedAt($this->academy, $a, $this->supervisor->id, '2026-09-13 08:03:00+00');
    markedAt($this->academy, $a, 'ATTENDED', $this->supervisor->id, '2026-09-13 08:50:00+00');
    // b: Sara followed 25 min late; the teacher marked it 3 hours after the end (late).
    followedAt($this->academy, $b, $this->supervisor->id, '2026-09-13 09:25:00+00');
    markedAt($this->academy, $b, 'ABSENT_UNEXCUSED', $this->teacherUser->id, '2026-09-13 12:30:00+00');
    // c: nobody followed; the owner cancelled it the evening before — it never needed following.
    markedAt($this->academy, $c, 'CANCELLED_BY_STUDENT', $this->owner->id, '2026-09-12 18:00:00+00');
    // d: nobody followed, nobody marked.

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/supervision/stats?from=2026-09-13&to=2026-09-13&follow_minutes=10&mark_minutes=60')->assertOk();

    expect($res->json('totals'))->toMatchArray([
        'sessions' => 4,
        'needing_follow' => 3, 'followed' => 2, 'follow_on_time' => 1, 'follow_late' => 1, 'follow_pending' => 0, 'unfollowed' => 1,
        'marked' => 3, 'mark_on_time' => 2, 'mark_late' => 1, 'mark_pending' => 0, 'unmarked' => 1,
        'avg_follow_delay_minutes' => 14.0,   // (3 + 25) / 2
        'avg_mark_delay_minutes' => 66.7,     // (20 + 180 + 0) / 3
    ]);

    $people = collect($res->json('supervisors'));
    expect($people->pluck('name')->all())->toBe(['Owner Omar', 'Sara Supervisor', 'Mona Teacher']);
    expect($people->firstWhere('id', $this->supervisor->id))->toMatchArray([
        'role' => 'SUPERVISOR',
        'followed' => 2, 'follow_on_time' => 1, 'follow_late' => 1, 'follow_on_time_rate' => 50.0, 'avg_follow_delay_minutes' => 14.0,
        'marked' => 1, 'mark_on_time' => 1, 'mark_late' => 0, 'mark_on_time_rate' => 100.0, 'avg_mark_delay_minutes' => 20.0,
    ]);
    expect($people->firstWhere('id', $this->teacherUser->id))->toMatchArray([
        'role' => 'TEACHER', 'followed' => 0, 'marked' => 1, 'mark_on_time_rate' => 0.0, 'avg_mark_delay_minutes' => 180.0,
    ]);

    $rows = collect($res->json('sessions'))->keyBy('id');
    expect($rows[$a])->toMatchArray(['follow_bucket' => 'on_time', 'follow_delay_minutes' => 3, 'mark_bucket' => 'on_time', 'mark_delay_minutes' => 20, 'local_date' => '2026-09-13']);
    expect($rows[$a]['followed_by']['name'])->toBe('Sara Supervisor');
    expect($rows[$a]['marked_by']['name'])->toBe('Sara Supervisor');
    expect($rows[$b])->toMatchArray(['follow_bucket' => 'late', 'follow_delay_minutes' => 25, 'mark_bucket' => 'late', 'mark_delay_minutes' => 180]);
    expect($rows[$c])->toMatchArray(['needs_follow' => false, 'follow_bucket' => 'not_needed', 'mark_bucket' => 'on_time']);
    expect($rows[$d])->toMatchArray(['follow_bucket' => 'none', 'mark_bucket' => 'none', 'followed_at' => null, 'outcome_set_at' => null]);
});

it('calls a lesson pending, not late, while its deadline has not passed', function () {
    // Started 5 min ago (live), and one that ended 20 min ago, unmarked: neither is late yet.
    $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:10:00+00', 'status' => 'SCHEDULED']);
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/supervision/stats?from=2026-09-14&to=2026-09-14')->assertOk();

    expect($res->json('totals'))->toMatchArray([
        'sessions' => 2, 'follow_pending' => 1, 'unfollowed' => 1, 'mark_pending' => 2, 'unmarked' => 0,
    ]);
    expect(collect($res->json('sessions'))->firstWhere('id', $this->live))->toMatchArray(['follow_bucket' => 'pending', 'mark_bucket' => 'pending']);
});

it('bounds the window by the academy\'s own days and leaves out lessons yet to start', function () {
    // 2026-09-13 22:30 UTC is already the 14th in Cairo (UTC+3): counted for the 14th, not the 13th.
    $lateNight = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-13 22:30:00+00', 'status' => 'ATTENDED']);
    $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-14 16:00:00+00', 'status' => 'SCHEDULED']);
    $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-09-14 11:00:00+00', 'status' => 'RESCHEDULED']);
    Sanctum::actingAs($this->owner);

    $ids13 = collect($this->getJson('/api/supervision/stats?from=2026-09-13&to=2026-09-13')->assertOk()->json('sessions'))->pluck('id');
    $ids14 = collect($this->getJson('/api/supervision/stats?from=2026-09-14&to=2026-09-14')->assertOk()->json('sessions'))->pluck('id');

    expect($ids13)->not->toContain($lateNight);
    expect($ids14->all())->toEqualCanonicalizing([$lateNight, $this->live]);
});

it('is Super Admin, owner and supervisor reading; a teacher is refused', function () {
    Sanctum::actingAs($this->supervisor);
    $this->getJson('/api/supervision/stats?from=2026-09-14&to=2026-09-14')->assertOk();

    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/supervision/stats?from=2026-09-14&to=2026-09-14')->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/supervision/stats?from=2026-09-14&to=2026-09-13')->assertStatus(422);
});
