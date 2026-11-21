<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Teacher performance (GET /api/teacher-performance): the monthly evaluation. Four parts per
 * teacher — the supervisor's lesson visits, reports after lessons and trials, entering on time,
 * conduct — and one weighted total. The fixture hits every bucket once, so each expected number
 * can be worked out by hand from the comments.
 *
 * Now = 2026-09-26 13:00 UTC; the month is September in Cairo (UTC+3).
 */
beforeEach(function () {
    Carbon::setTestNow('2026-09-26 13:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR');
    $this->frontDesk = $this->makeUser($this->academy, 'CUSTOMER_SERVICE');
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER');

    // Mona has had a link since 1 Sep; Karim never had one; Salma teaches nothing this month;
    // Old left the academy and taught nothing in the month.
    $this->mona = $this->createTeacher($this->academy, [
        'full_name' => 'Mona', 'user_id' => $this->teacherUser->id,
        'meeting_url' => 'https://zoom.us/j/1', 'join_tracking_since' => '2026-09-01 00:00:00+00',
    ]);
    $this->karim = $this->createTeacher($this->academy, ['full_name' => 'Karim']);
    $this->salma = $this->createTeacher($this->academy, ['full_name' => 'Salma']);
    $this->createTeacher($this->academy, ['full_name' => 'Old', 'deleted_at' => '2026-08-01 00:00:00+00']);
    $student = $this->createStudent($this->academy, overrides: ['full_name' => 'Omar']);

    $lesson = fn (string $teacher, string $at, string $status, array $more = []) => $this->createSession(
        $this->academy, $student, $teacher, ['scheduled_at_utc' => $at, 'status' => $status] + $more,
    );

    // L1: entered 3 min after the start (on time), report 10 min after the end (on time).
    $this->l1 = $lesson($this->mona, '2026-09-24 10:00:00+00', 'ATTENDED');
    tpPress($this->academy, $this->l1, $this->mona, '2026-09-24 10:03:00+00');
    tpReport($this->academy, $this->l1, '2026-09-24 10:40:00+00');
    // L2: entered 12 min late, report 150 min after the end (late against the 120 default).
    $this->l2 = $lesson($this->mona, '2026-09-24 12:00:00+00', 'ATTENDED');
    tpPress($this->academy, $this->l2, $this->mona, '2026-09-24 12:12:00+00');
    tpPress($this->academy, $this->l2, $this->mona, '2026-09-24 12:20:00+00');
    tpReport($this->academy, $this->l2, '2026-09-24 15:00:00+00');
    // L3: the student was absent; Mona never pressed Enter (missed); no report owed.
    $this->l3 = $lesson($this->mona, '2026-09-25 10:00:00+00', 'ABSENT_UNEXCUSED');
    // L4: Mona cancelled — waiting for the supervisor to call it an absence or an apology.
    $this->l4 = $lesson($this->mona, '2026-09-25 12:00:00+00', 'CANCELLED_BY_TEACHER');
    // L5: entered 5 min EARLY (on time); the popup saved an EMPTY report row — still missing.
    $this->l5 = $lesson($this->mona, '2026-09-25 14:00:00+00', 'ATTENDED');
    tpPress($this->academy, $this->l5, $this->mona, '2026-09-25 13:55:00+00');
    tpReport($this->academy, $this->l5, '2026-09-25 14:35:00+00', ['report_text' => '<p>&nbsp; </p>']);
    // L6: still on (12:45–13:15) — pending on both clocks, counts for nothing yet.
    $this->l6 = $lesson($this->mona, '2026-09-26 12:45:00+00', 'SCHEDULED');
    // Never counted in September: 31 Aug 23:00 in Cairo, a moved-away original, a deleted lesson
    // and a future one.
    $lesson($this->mona, '2026-08-31 20:00:00+00', 'ATTENDED');
    $lesson($this->mona, '2026-09-24 16:00:00+00', 'RESCHEDULED');
    $lesson($this->mona, '2026-09-23 10:00:00+00', 'ATTENDED', ['hidden_at' => '2026-09-23 12:00:00+00']);
    $lesson($this->mona, '2026-09-27 10:00:00+00', 'SCHEDULED');

    // Karim: a trial lesson reported 15 min after the end; no link, so entry is not measured.
    $this->m1 = $lesson($this->karim, '2026-09-25 09:00:00+00', 'ATTENDED');
    tpReport($this->academy, $this->m1, '2026-09-25 09:45:00+00', ['report_text' => 'Read well', 'is_free_trial' => true]);

    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function tpPress(string $academyId, string $sessionId, string $teacherId, string $at): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('session_joins')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'session_id' => $sessionId,
        'teacher_id' => $teacherId, 'joined_at' => $at, 'created_at' => $at,
    ]);
}

/** A report first filed at $at — `created_at` is the clock the page reads. */
function tpReport(string $academyId, string $sessionId, string $at, array $values = ['report_text' => 'Revised the lesson']): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('session_reports')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'session_id' => $sessionId,
        'values' => json_encode($values), 'filled_at' => $at, 'created_at' => $at, 'updated_at' => $at,
    ]);
}

function tpTeacher(array $json, string $id): array
{
    return collect($json['teachers'])->firstWhere('id', $id);
}

/** Five ratings against the default list. */
function tpRatings(array $ratings): array
{
    $ids = ['preparation', 'teaching', 'interaction', 'time', 'setup'];

    return array_map(fn (int $r, int $i) => ['criterion_id' => $ids[$i], 'rating' => $r], $ratings, array_keys($ratings));
}

it('scores every teacher for the month from what the system already records', function () {
    Sanctum::actingAs($this->owner);
    $json = $this->getJson('/api/teacher-performance?month=2026-09')->assertOk()->json();

    expect($json['month'])->toBe('2026-09');
    expect($json['settings']['weights'])->toBe(['quality' => 40, 'reports' => 20, 'entry' => 20, 'conduct' => 20]);
    expect($json['settings']['criteria'])->toHaveCount(5);
    expect($json['can'])->toBe(['manage' => true, 'settings' => true]);

    $mona = tpTeacher($json, $this->mona);
    expect($mona['lessons'])->toMatchArray([
        'total' => 6, 'taught' => 3, 'student_absent' => 1, 'teacher_cancelled' => 1, 'unmarked' => 0, 'trials' => 0,
    ]);
    // On time 2 (L1, L5), late 1 (L2), missed 1 (L3): (2 + ½) / 4.
    expect($mona['entry'])->toMatchArray(['measured' => 4, 'on_time' => 2, 'late' => 1, 'missed' => 1, 'pending' => 1, 'score' => 62.5]);
    // On time 1 (L1), late 1 (L2), missing 1 (L5, an empty row): (1 + ½) / 3.
    expect($mona['reports'])->toMatchArray(['due' => 3, 'on_time' => 1, 'late' => 1, 'missing' => 1, 'pending' => 1, 'score' => 50]);
    expect($mona['conduct'])->toMatchArray(['score' => 100, 'points' => 0, 'absences' => 0, 'unclassified' => 1]);
    expect($mona['quality'])->toMatchArray(['score' => null, 'visits' => 0, 'target' => 2]);
    // No visit yet, so the other three carry it: (50 + 62.5 + 100) / 3.
    expect($mona['total'])->toEqual(70.8);

    // No link: entry is not measured. One trial lesson, reported on time.
    $karim = tpTeacher($json, $this->karim);
    expect($karim['entry'])->toMatchArray(['measured' => 0, 'score' => null]);
    expect($karim['reports'])->toMatchArray(['due' => 1, 'on_time' => 1, 'trial_due' => 1, 'trial_on_time' => 1, 'score' => 100]);
    expect($karim['lessons']['trials'])->toBe(1);
    expect($karim['has_meeting_url'])->toBeFalse();
    expect($karim['total'])->toEqual(100);

    // On the staff but idle this month: listed, with nothing to score.
    $salma = tpTeacher($json, $this->salma);
    expect($salma['lessons']['total'])->toBe(0);
    expect($salma['conduct']['score'])->toBeNull();
    expect($salma['total'])->toBeNull();

    // A teacher who left and has nothing in the month is not listed.
    expect(collect($json['teachers'])->pluck('name')->all())->toBe(['Karim', 'Mona', 'Salma']);

    expect($json['summary'])->toMatchArray([
        'teachers' => 3, 'average' => 85.4, 'visits' => 0, 'visited' => 0, 'visits_due' => 2,
        'reports_missing' => 1, 'notes' => 0, 'unclassified' => 1,
    ]);
});

it('adds the supervisor\'s visits and notes to the total', function () {
    Sanctum::actingAs($this->supervisor);

    // Two visits: 20/25 = 80 and 25/25 = 100 → quality 90.
    $visit = $this->postJson("/api/teacher-performance/teachers/{$this->mona}/visits", [
        'session_id' => $this->l1, 'ratings' => tpRatings([5, 4, 4, 3, 4]),
        'strengths' => 'Calm and clear', 'improvements' => '  ',
    ])->assertCreated()->json('visit');
    expect($visit)->toMatchArray(['score' => 80, 'visited_on' => '2026-09-24', 'session_id' => $this->l1, 'improvements' => null]);
    expect($visit['items'][0])->toEqual(['criterion_id' => 'preparation', 'name' => 'التحضير للحصة', 'rating' => 5]);
    $this->postJson("/api/teacher-performance/teachers/{$this->mona}/visits", [
        'visited_on' => '2026-09-20', 'ratings' => tpRatings([5, 5, 5, 5, 5]),
    ])->assertCreated();

    // The cancelled lesson was an absence (10) and a rule was not kept (5) → conduct 85.
    $note = $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", [
        'kind' => 'ABSENCE', 'session_id' => $this->l4, 'note' => 'No notice',
    ])->assertCreated()->json('note');
    expect($note)->toMatchArray(['kind' => 'ABSENCE', 'points' => 10, 'occurred_on' => '2026-09-25', 'lesson_student' => 'Omar']);
    $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", [
        'kind' => 'VIOLATION', 'occurred_on' => '2026-09-22', 'rule' => 'Camera on',
    ])->assertCreated();

    $mona = tpTeacher($this->getJson('/api/teacher-performance?month=2026-09')->assertOk()->json(), $this->mona);
    expect($mona['quality'])->toMatchArray(['score' => 90, 'visits' => 2]);
    expect($mona['conduct'])->toMatchArray(['score' => 85, 'points' => 15, 'absences' => 1, 'violations' => 1, 'unclassified' => 0]);
    // 90×40% + 50×20% + 62.5×20% + 85×20%.
    expect($mona['total'])->toEqual(75.5);
});

it('refuses a note or a visit that does not add up', function () {
    Sanctum::actingAs($this->supervisor);
    $notes = "/api/teacher-performance/teachers/{$this->mona}/notes";
    $visits = "/api/teacher-performance/teachers/{$this->mona}/visits";

    $this->postJson($notes, ['kind' => 'VIOLATION', 'occurred_on' => '2026-09-22'])->assertJsonValidationErrors('rule');
    $this->postJson($notes, ['kind' => 'APOLOGY', 'occurred_on' => '2026-09-27'])->assertJsonValidationErrors('occurred_on');
    $this->postJson($notes, ['kind' => 'LATE', 'occurred_on' => '2026-09-22'])->assertJsonValidationErrors('kind');
    // Another teacher's lesson.
    $this->postJson($notes, ['kind' => 'ABSENCE', 'session_id' => $this->m1])->assertJsonValidationErrors('session_id');
    // A lesson is classified once.
    $this->postJson($notes, ['kind' => 'ABSENCE', 'session_id' => $this->l4])->assertCreated();
    $this->postJson($notes, ['kind' => 'APOLOGY', 'session_id' => $this->l4])->assertJsonValidationErrors('session_id');

    $this->postJson($visits, ['ratings' => [['criterion_id' => 'nope', 'rating' => 3]]])->assertJsonValidationErrors('ratings');
    $this->postJson($visits, ['ratings' => tpRatings([6])])->assertJsonValidationErrors('ratings.0.rating');
    $this->postJson($visits, ['ratings' => []])->assertJsonValidationErrors('ratings');
    $this->postJson('/api/teacher-performance/teachers/not-a-uuid/visits', ['ratings' => tpRatings([3])])->assertNotFound();
});

it('opens one teacher\'s month: lessons, notes, visits and the trend', function () {
    Sanctum::actingAs($this->supervisor);
    $this->postJson("/api/teacher-performance/teachers/{$this->mona}/visits", ['session_id' => $this->l2, 'ratings' => tpRatings([4, 4, 4, 4, 4])])->assertCreated();
    $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", ['kind' => 'APOLOGY', 'session_id' => $this->l4])->assertCreated();

    $json = $this->getJson("/api/teacher-performance/teachers/{$this->mona}?month=2026-09")->assertOk()->json();

    expect($json['teacher'])->toMatchArray(['name' => 'Mona', 'has_meeting_url' => true]);
    expect($json['teacher']['quality']['score'])->toEqual(80);
    expect($json['teacher']['conduct'])->toMatchArray(['score' => 97, 'apologies' => 1]);

    $lessons = collect($json['lessons'])->keyBy('id');
    expect($lessons)->toHaveCount(6);
    expect($json['lessons'][0]['id'])->toBe($this->l6); // newest first
    expect($lessons[$this->l2])->toMatchArray([
        'join_bucket' => 'late', 'join_delay_minutes' => 12, 'presses' => 2,
        'report_bucket' => 'late', 'report_delay_minutes' => 150, 'local_date' => '2026-09-24',
    ]);
    expect($lessons[$this->l5])->toMatchArray(['join_bucket' => 'on_time', 'join_delay_minutes' => -5, 'report_bucket' => 'missing', 'reported_at' => null]);
    expect($lessons[$this->l4])->toMatchArray(['join_bucket' => 'not_tracked', 'report_bucket' => 'not_needed', 'noted' => true]);
    expect($lessons[$this->l3])->toMatchArray(['join_bucket' => 'missed', 'report_bucket' => 'not_needed', 'noted' => false]);
    expect($lessons[$this->l6])->toMatchArray(['join_bucket' => 'pending', 'report_bucket' => 'pending']);

    expect($json['notes'])->toHaveCount(1);
    expect($json['notes'][0])->toMatchArray(['kind' => 'APOLOGY', 'points' => 3, 'session_id' => $this->l4]);
    expect($json['visits'])->toHaveCount(1);
    expect($json['visits'][0])->toMatchArray(['score' => 80, 'lesson_student' => 'Omar']);

    // Six months ending in September. August holds one lesson: before the link (entry not
    // measured), never reported (0) and no notes (100) → 50.
    expect(array_column($json['trend'], 'month'))->toBe(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect($json['trend'][3]['total'])->toBeNull();
    expect($json['trend'][4])->toMatchArray(['total' => 50, 'reports' => 0, 'entry' => null, 'conduct' => 100, 'quality' => null]);
    expect($json['trend'][5]['total'])->toEqual($json['teacher']['total']);

    // A month with nothing in it is still a page, not an error.
    $empty = $this->getJson("/api/teacher-performance/teachers/{$this->mona}?month=2026-11")->assertOk()->json();
    expect($empty['lessons'])->toBe([]);
    expect($empty['teacher']['total'])->toBeNull();

    $this->getJson('/api/teacher-performance/teachers/not-a-uuid?month=2026-09')->assertNotFound();
    $this->getJson('/api/teacher-performance?month=2026-13')->assertJsonValidationErrors('month');
});

it('edits and deletes a note and a visit', function () {
    Sanctum::actingAs($this->supervisor);
    $note = $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", [
        'kind' => 'APOLOGY', 'occurred_on' => '2026-09-21',
    ])->assertCreated()->json('note');
    $visit = $this->postJson("/api/teacher-performance/teachers/{$this->mona}/visits", [
        'visited_on' => '2026-09-21', 'ratings' => tpRatings([3, 3, 3, 3, 3]),
    ])->assertCreated()->json('visit');

    // Becoming an absence re-prices it; the same kind keeps the points it was written with.
    $this->patchJson("/api/teacher-performance/notes/{$note['id']}", ['kind' => 'ABSENCE', 'occurred_on' => '2026-09-22', 'note' => 'Did not show'])
        ->assertOk()->assertJsonPath('note.points', 10)->assertJsonPath('note.occurred_on', '2026-09-22')->assertJsonPath('note.note', 'Did not show');
    $this->patchJson("/api/teacher-performance/visits/{$visit['id']}", ['visited_on' => '2026-09-21', 'ratings' => tpRatings([5, 5, 5, 5, 5])])
        ->assertOk()->assertJsonPath('visit.score', 100);

    $mona = tpTeacher($this->getJson('/api/teacher-performance?month=2026-09')->json(), $this->mona);
    expect($mona['quality']['score'])->toEqual(100);
    expect($mona['conduct']['score'])->toEqual(90);

    $this->deleteJson("/api/teacher-performance/notes/{$note['id']}")->assertOk();
    $this->deleteJson("/api/teacher-performance/visits/{$visit['id']}")->assertOk();
    $this->deleteJson("/api/teacher-performance/visits/{$visit['id']}")->assertNotFound();

    $mona = tpTeacher($this->getJson('/api/teacher-performance?month=2026-09')->json(), $this->mona);
    expect($mona['quality'])->toMatchArray(['score' => null, 'visits' => 0]);
    expect($mona['conduct'])->toMatchArray(['score' => 100, 'absences' => 0]);
});

it('lets the academy set its own weights, points and lists', function () {
    Sanctum::actingAs($this->supervisor);
    $note = $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", ['kind' => 'ABSENCE', 'session_id' => $this->l4])
        ->assertCreated()->json('note');

    $sheet = [
        'weights' => ['quality' => 0, 'reports' => 50, 'entry' => 50, 'conduct' => 0],
        'points' => ['ABSENCE' => 25, 'APOLOGY' => 0, 'VIOLATION' => 5],
        'visits_target' => 3, 'late_minutes' => 15, 'report_minutes' => 180,
        'criteria' => [['id' => 'teaching', 'name' => 'Teaching'], ['name' => 'Tajweed']],
        'rules' => ['Camera on', ' Camera on ', 'Follow the plan'],
    ];
    // The supervisor writes evaluations; the weights are the academy's call.
    $this->putJson('/api/teacher-performance/settings', $sheet)->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->putJson('/api/teacher-performance/settings', ['weights' => ['quality' => 50, 'reports' => 50, 'entry' => 50, 'conduct' => 0]] + $sheet)
        ->assertJsonValidationErrors('weights');
    $saved = $this->putJson('/api/teacher-performance/settings', $sheet)->assertOk()->json('settings');
    expect($saved['weights'])->toBe(['quality' => 0, 'reports' => 50, 'entry' => 50, 'conduct' => 0]);
    expect($saved['criteria'][0])->toBe(['id' => 'teaching', 'name' => 'Teaching']);
    expect($saved['criteria'][1]['name'])->toBe('Tajweed');
    expect(Str::isUuid($saved['criteria'][1]['id']))->toBeTrue();
    expect($saved['rules'])->toBe(['Camera on', 'Follow the plan']);
    expect($this->getJson('/api/teacher-performance/settings')->assertOk()->json('settings.visits_target'))->toBe(3);

    // Looser clocks: L2's 12-minute entry and 150-minute report are now on time.
    $mona = tpTeacher($this->getJson('/api/teacher-performance?month=2026-09')->json(), $this->mona);
    expect($mona['entry'])->toMatchArray(['on_time' => 3, 'late' => 0, 'score' => 75]);
    expect($mona['reports'])->toMatchArray(['on_time' => 2, 'late' => 0, 'score' => 66.7]);
    // Only reports and entry weigh now: (66.7 + 75) / 2.
    expect($mona['total'])->toEqual(70.9);
    // The absence keeps the 10 points it was written with; a new one costs 25.
    expect($mona['conduct']['points'])->toBe(10);
    $this->deleteJson("/api/teacher-performance/notes/{$note['id']}")->assertOk();
    $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", ['kind' => 'ABSENCE', 'session_id' => $this->l4])
        ->assertCreated()->assertJsonPath('note.points', 25);
});

it('is for the office only, and answers 402 when the switch is off', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/teacher-performance?month=2026-09')->assertForbidden();
    $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", ['kind' => 'APOLOGY'])->assertForbidden();

    Sanctum::actingAs($this->frontDesk);
    $this->getJson('/api/teacher-performance?month=2026-09')->assertForbidden();
    $this->postJson("/api/teacher-performance/teachers/{$this->mona}/visits", ['ratings' => tpRatings([3])])->assertForbidden();

    // The supervisor evaluates, so the supervisor reads the page.
    Sanctum::actingAs($this->supervisor);
    $json = $this->getJson('/api/teacher-performance?month=2026-09')->assertOk()->json();
    expect($json['can'])->toBe(['manage' => true, 'settings' => false]);

    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['teacher_quality']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/teacher-performance?month=2026-09')->assertStatus(402);
});

it('keeps one academy\'s notes away from another', function () {
    Sanctum::actingAs($this->supervisor);
    $note = $this->postJson("/api/teacher-performance/teachers/{$this->mona}/notes", ['kind' => 'APOLOGY'])->assertCreated()->json('note');

    $other = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $otherOwner = $this->makeUser($other, 'ACADEMY_OWNER');
    $this->clearTenantContext();

    Sanctum::actingAs($otherOwner);
    $this->patchJson("/api/teacher-performance/notes/{$note['id']}", ['kind' => 'ABSENCE'])->assertNotFound();
    $this->deleteJson("/api/teacher-performance/notes/{$note['id']}")->assertNotFound();
    $this->getJson("/api/teacher-performance/teachers/{$this->mona}?month=2026-09")->assertNotFound();
    expect($this->getJson('/api/teacher-performance?month=2026-09')->assertOk()->json('teachers'))->toBe([]);
});
