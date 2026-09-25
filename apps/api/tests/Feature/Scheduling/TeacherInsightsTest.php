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
 * Teacher performance (GET /api/teacher-insights): Enter punctuality, report speed and attendance
 * for every teacher, judged per lesson in SQL. The fixture below hits every bucket once, so each
 * expected number can be worked out by hand from the comments.
 *
 * Now = 2026-09-26 13:00 UTC; the window is 20–26 Sep in Cairo (UTC+3).
 */
beforeEach(function () {
    Carbon::setTestNow('2026-09-26 13:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER');

    // Mona has had a link since 1 Sep; Karim never had one; Salma teaches nothing this week;
    // Old left the academy and taught nothing in the window.
    $this->mona = $this->createTeacher($this->academy, [
        'full_name' => 'Mona', 'user_id' => $this->teacherUser->id,
        'meeting_url' => 'https://zoom.us/j/1', 'join_tracking_since' => '2026-09-01 00:00:00+00',
    ]);
    $this->karim = $this->createTeacher($this->academy, ['full_name' => 'Karim']);
    $this->salma = $this->createTeacher($this->academy, ['full_name' => 'Salma']);
    $this->createTeacher($this->academy, ['full_name' => 'Old', 'deleted_at' => '2026-08-01 00:00:00+00']);
    $student = $this->createStudent($this->academy, overrides: ['full_name' => 'Omar']);

    $lesson = fn (string $teacher, string $at, string $status) => $this->createSession(
        $this->academy, $student, $teacher, ['scheduled_at_utc' => $at, 'status' => $status],
    );

    // L1: entered 3 min after the start (on time), report 10 min after the end (on time).
    $this->l1 = $lesson($this->mona, '2026-09-24 10:00:00+00', 'ATTENDED');
    tiPress($this->academy, $this->l1, $this->mona, '2026-09-24 10:03:00+00');
    tiReport($this->academy, $this->l1, '2026-09-24 10:40:00+00');
    // L2: entered 12 min late, report 150 min after the end (late against the 120 default).
    $this->l2 = $lesson($this->mona, '2026-09-24 12:00:00+00', 'ATTENDED');
    tiPress($this->academy, $this->l2, $this->mona, '2026-09-24 12:12:00+00');
    tiPress($this->academy, $this->l2, $this->mona, '2026-09-24 12:20:00+00');
    tiReport($this->academy, $this->l2, '2026-09-24 15:00:00+00');
    // L3: the student was absent; Mona never pressed Enter (missed); no report owed.
    $this->l3 = $lesson($this->mona, '2026-09-25 10:00:00+00', 'ABSENT_UNEXCUSED');
    // L4: Mona cancelled — her absence; not measured for Enter.
    $this->l4 = $lesson($this->mona, '2026-09-25 12:00:00+00', 'CANCELLED_BY_TEACHER');
    // L5: entered 5 min EARLY (on time, counts as 0 in the average); report never filed (missing).
    $this->l5 = $lesson($this->mona, '2026-09-25 14:00:00+00', 'ATTENDED');
    tiPress($this->academy, $this->l5, $this->mona, '2026-09-25 13:55:00+00');
    // L6: still on (12:45–13:15) — pending on both clocks, counts for nothing yet.
    $this->l6 = $lesson($this->mona, '2026-09-26 12:45:00+00', 'SCHEDULED');
    // Never counted: before the window, a moved-away original, and a future lesson.
    $lesson($this->mona, '2026-09-18 10:00:00+00', 'ATTENDED');
    $lesson($this->mona, '2026-09-24 16:00:00+00', 'RESCHEDULED');
    $lesson($this->mona, '2026-09-27 10:00:00+00', 'SCHEDULED');

    // Karim: one lesson, report 15 min after the end; no link, so Enter is not measured.
    $this->m1 = $lesson($this->karim, '2026-09-25 09:00:00+00', 'ATTENDED');
    tiReport($this->academy, $this->m1, '2026-09-25 09:45:00+00');

    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function tiPress(string $academyId, string $sessionId, string $teacherId, string $at): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('session_joins')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'session_id' => $sessionId,
        'teacher_id' => $teacherId, 'joined_at' => $at, 'created_at' => $at,
    ]);
}

/** A report first filed at $at — `created_at` is the clock the page reads. */
function tiReport(string $academyId, string $sessionId, string $at): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('session_reports')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'session_id' => $sessionId,
        'values' => '{}', 'filled_at' => $at, 'created_at' => $at, 'updated_at' => $at,
    ]);
}

function tiTeacher(array $json, string $id): array
{
    return collect($json['teachers'])->firstWhere('id', $id);
}

it('judges every teacher on entering, reporting and attending', function () {
    Sanctum::actingAs($this->owner);
    $json = $this->getJson('/api/teacher-insights?from=2026-09-20&to=2026-09-26')->assertOk()->json();

    expect($json['thresholds'])->toMatchArray(['late_minutes' => 5, 'report_minutes' => 120]);

    $mona = tiTeacher($json, $this->mona);
    expect($mona['join'])->toMatchArray([
        'measured' => 4, 'entered' => 3, 'on_time' => 2, 'late' => 1, 'missed' => 1, 'pending' => 1,
        'on_time_rate' => 50, 'entered_rate' => 75, 'avg_delay_minutes' => 5, 'avg_late_minutes' => 12,
    ]);
    expect($mona['reports'])->toMatchArray([
        'due' => 3, 'filed' => 2, 'on_time' => 1, 'late' => 1, 'missing' => 1, 'pending' => 1,
        'on_time_rate' => 33.3, 'filed_rate' => 66.7, 'avg_delay_minutes' => 80,
    ]);
    expect($mona['attendance'])->toMatchArray([
        'lessons' => 6, 'attended' => 3, 'student_absent' => 1, 'teacher_absent' => 1, 'in_progress' => 1,
        'unmarked' => 0, 'teacher_attendance_rate' => 80, 'teacher_absence_rate' => 20, 'student_attendance_rate' => 75,
    ]);
    // mean(50, 33.3, 80)
    expect($mona['score'])->toEqual(54.4);
    expect($mona['has_meeting_url'])->toBeTrue();

    // No link: Enter is not measured and does not drag the score — mean(100, 100).
    $karim = tiTeacher($json, $this->karim);
    expect($karim['join']['measured'])->toBe(0);
    expect($karim['join']['on_time_rate'])->toBeNull();
    expect($karim['has_meeting_url'])->toBeFalse();
    expect($karim['score'])->toEqual(100);

    // On the staff but idle this week: listed, with nothing to score.
    $salma = tiTeacher($json, $this->salma);
    expect($salma['attendance']['lessons'])->toBe(0);
    expect($salma['score'])->toBeNull();

    // A teacher who left and taught nothing in the window is not listed.
    expect(collect($json['teachers'])->pluck('name')->all())->toBe(['Karim', 'Mona', 'Salma']);

    expect($json['totals']['attendance']['lessons'])->toBe(7);
    expect($json['totals']['reports'])->toMatchArray(['due' => 4, 'on_time' => 2, 'on_time_rate' => 50, 'avg_delay_minutes' => 58.3]);
    expect($json['totals']['attendance']['teacher_attendance_rate'])->toEqual(83.3);
    expect($json['totals']['score'])->toEqual(61.1);
});

it('moves lessons between buckets when the thresholds move', function () {
    Sanctum::actingAs($this->owner);
    $json = $this->getJson('/api/teacher-insights?from=2026-09-20&to=2026-09-26&late_minutes=15&report_minutes=180')
        ->assertOk()->json();

    $mona = tiTeacher($json, $this->mona);
    expect($mona['join'])->toMatchArray(['on_time' => 3, 'late' => 0, 'on_time_rate' => 75]);
    expect($mona['reports'])->toMatchArray(['on_time' => 2, 'late' => 0]);
});

it('lists the lessons behind one teacher, judged the same way', function () {
    Sanctum::actingAs($this->owner);
    $json = $this->getJson("/api/teacher-insights/teachers/{$this->mona}?from=2026-09-20&to=2026-09-26")
        ->assertOk()->json();

    expect($json['teacher']['name'])->toBe('Mona');
    $lessons = collect($json['lessons'])->keyBy('id');
    expect($lessons)->toHaveCount(6);
    expect($json['lessons'][0]['id'])->toBe($this->l6); // newest first

    expect($lessons[$this->l2])->toMatchArray([
        'join_bucket' => 'late', 'join_delay_minutes' => 12, 'presses' => 2,
        'report_bucket' => 'late', 'report_delay_minutes' => 150,
    ]);
    expect($lessons[$this->l5])->toMatchArray([
        'join_bucket' => 'on_time', 'join_delay_minutes' => -5, 'report_bucket' => 'missing', 'reported_at' => null,
    ]);
    expect($lessons[$this->l4])->toMatchArray(['join_bucket' => 'not_tracked', 'report_bucket' => 'not_needed']);
    expect($lessons[$this->l3])->toMatchArray(['join_bucket' => 'missed', 'report_bucket' => 'not_needed']);
    expect($lessons[$this->l6])->toMatchArray(['join_bucket' => 'pending', 'report_bucket' => 'pending']);

    $this->getJson('/api/teacher-insights/teachers/not-a-uuid?from=2026-09-20&to=2026-09-26')->assertNotFound();
});

it('is for managers only, and answers 402 when the switch is off', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/teacher-insights?from=2026-09-20&to=2026-09-26')->assertForbidden();

    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['teacher_quality']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/teacher-insights?from=2026-09-20&to=2026-09-26')->assertStatus(402);
});
