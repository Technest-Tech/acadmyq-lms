<?php

declare(strict_types=1);

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
 * GET /api/session-reports — سجل التقارير. Teachers could only reach an old report through a salary
 * statement; this is the log of every report, with the lessons still owed one beside it.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-log@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-log@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Log Teacher', 'user_id' => $this->teacherUser->id]);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Other Teacher']);
    $this->fatima = $this->createStudent($this->academy, overrides: ['full_name' => 'فاطمة علي']);
    $this->omar = $this->createStudent($this->academy, overrides: ['full_name' => 'Omar Said']);

    $this->report = function (string $sessionId, array $values, ?string $by = null): void {
        $this->asAcademy($this->academy);
        DB::table('session_reports')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academy,
            'session_id' => $sessionId,
            'values' => json_encode($values, JSON_UNESCAPED_UNICODE),
            'filled_by_user_id' => $by,
        ]);
    };

    // ── The teacher's lessons ──
    // Written: a free-text report, by the teacher.
    $this->written = $this->createSession($this->academy, $this->fatima, $this->teacher, ['scheduled_at_utc' => '2026-06-10 15:00:00+00']);
    ($this->report)($this->written, ['report_text' => '<p>حفظ سورة الملك</p>'], $this->teacherUser->id);
    // Written: a structured answer, by the office.
    $this->structured = $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-06-05 15:00:00+00']);
    ($this->report)($this->structured, ['tajweed' => '9', 'report_text' => ''], $this->owner->id);
    // A cancelled lesson's report row, saved empty by the popup: neither written nor owed.
    $this->cancelled = $this->createSession($this->academy, $this->fatima, $this->teacher, ['scheduled_at_utc' => '2026-06-09 15:00:00+00', 'status' => 'CANCELLED_BY_STUDENT']);
    ($this->report)($this->cancelled, ['report_text' => '', 'is_free_trial' => false]);
    // Owed: delivered, ended, and the only thing saved is blank markup.
    $this->blank = $this->createSession($this->academy, $this->fatima, $this->teacher, ['scheduled_at_utc' => '2026-06-08 15:00:00+00']);
    ($this->report)($this->blank, ['report_text' => '<p>&nbsp;</p>']);
    // Owed: a free lesson with no report row at all.
    $this->free = $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-06-07 15:00:00+00', 'status' => 'FREE']);
    // Not owed: never marked (that is the overdue list's job), still running, or in the future.
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-06-06 15:00:00+00', 'status' => 'SCHEDULED']);
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-06-11 11:45:00+00', 'duration_minutes' => 30]);
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-06-12 15:00:00+00']);
    // A deleted lesson keeps its report row but is off every list.
    $hidden = $this->createSession($this->academy, $this->fatima, $this->teacher, ['scheduled_at_utc' => '2026-06-04 15:00:00+00', 'hidden_at' => '2026-06-04 18:00:00+00']);
    ($this->report)($hidden, ['report_text' => 'deleted lesson']);

    // ── Another teacher's ──
    $this->othersReport = $this->createSession($this->academy, $this->fatima, $this->other, ['scheduled_at_utc' => '2026-06-10 17:00:00+00']);
    ($this->report)($this->othersReport, ['report_text' => 'other teacher report']);

    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

it('lists only the teacher\'s own written reports, newest first, and counts what is still owed', function () {
    Sanctum::actingAs($this->teacherUser);

    // Asking for another teacher's lessons changes nothing for a teacher.
    $body = $this->getJson("/api/session-reports?filter[teacher_id]={$this->other}")->assertOk()->json();

    expect(collect($body['rows'])->pluck('id')->all())->toBe([$this->written, $this->structured])
        ->and($body['total'])->toBe(2)
        ->and($body['counts'])->toBe(['written' => 2, 'missing' => 2]);

    $first = $body['rows'][0];
    expect($first['student_name'])->toBe('فاطمة علي')
        ->and($first['report_values'])->toBe(['report_text' => '<p>حفظ سورة الملك</p>'])
        ->and($first['written_by_teacher'])->toBeTrue()
        ->and($first['written_at'])->not->toBeNull();
    // Saved by the office on the teacher's behalf.
    expect($body['rows'][1]['written_by_teacher'])->toBeFalse()
        ->and($body['rows'][1]['written_by_name'])->not->toBeNull();

    $missing = $this->getJson('/api/session-reports?filter[tab]=missing')->assertOk()->json();
    expect(collect($missing['rows'])->pluck('id')->all())->toBe([$this->blank, $this->free]);
});

it('lets the office read every teacher, narrowed by teacher, student and window', function () {
    Sanctum::actingAs($this->owner);

    expect($this->getJson('/api/session-reports')->assertOk()->json('total'))->toBe(3);

    $byTeacher = $this->getJson("/api/session-reports?filter[teacher_id]={$this->other}")->assertOk()->json();
    expect(collect($byTeacher['rows'])->pluck('id')->all())->toBe([$this->othersReport])
        ->and($byTeacher['counts'])->toBe(['written' => 1, 'missing' => 0]);

    $byStudent = $this->getJson("/api/session-reports?filter[student_id]={$this->omar}")->assertOk()->json();
    expect(collect($byStudent['rows'])->pluck('id')->all())->toBe([$this->structured]);

    $from = urlencode('2026-06-08T00:00:00+03:00');
    $to = urlencode('2026-06-10T00:00:00+03:00');
    $window = $this->getJson("/api/session-reports?filter[tab]=missing&filter[from]={$from}&filter[to]={$to}")->assertOk()->json();
    expect(collect($window['rows'])->pluck('id')->all())->toBe([$this->blank]);
});

it('finds a report by a word inside it or by the student\'s name, typed loosely', function () {
    Sanctum::actingAs($this->teacherUser);

    $byWord = $this->getJson('/api/session-reports?search='.urlencode('الملك'))->assertOk()->json();
    expect(collect($byWord['rows'])->pluck('id')->all())->toBe([$this->written])
        ->and($byWord['counts']['written'])->toBe(1);

    // "فاطمه" (taa marbuta typed as haa) still finds "فاطمة".
    $byName = $this->getJson('/api/session-reports?search='.urlencode('فاطمه'))->assertOk()->json();
    expect(collect($byName['rows'])->pluck('id')->all())->toBe([$this->written])
        ->and($byName['counts'])->toBe(['written' => 1, 'missing' => 1]);
});

it('labels old answers with every field the academy defined, retired ones included', function () {
    $this->asAcademy($this->academy);
    foreach ([['tajweed', true, 1], ['old_notes', false, 2]] as [$key, $active, $order]) {
        DB::table('report_field_definitions')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academy,
            'key' => $key,
            'label_ar' => $key,
            'label_en' => $key,
            'field_type' => 'TEXT',
            'sort_order' => $order,
            'is_required' => false,
            'is_active' => $active,
        ]);
    }
    $this->clearTenantContext();

    Sanctum::actingAs($this->teacherUser);
    $fields = $this->getJson('/api/session-reports')->assertOk()->json('fields');

    expect(collect($fields)->pluck('key')->all())->toBe(['tajweed', 'old_notes'])
        ->and($fields[1]['is_active'])->toBeFalse();
});
