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

/** Assign a student to a teacher (active assignment) in the academy's tenant context. */
function assignStudent(string $academyId, string $studentId, string $teacherId): void
{
    test()->asAcademy($academyId);
    DB::table('student_teacher_assignments')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'student_id' => $studentId,
        'teacher_id' => $teacherId,
    ]);
    test()->clearTenantContext();
}

beforeEach(function () {
    Carbon::setTestNow('2026-06-18 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-spr@test.local']);

    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-spr@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Rep Teacher', 'user_id' => $this->teacherUser->id]);

    $this->student = $this->createStudent($this->academy, overrides: ['full_name' => 'Pupil']);
    assignStudent($this->academy, $this->student, $this->teacher);
});

afterEach(fn () => Carbon::setTestNow());

function submitReport(string $studentId, array $overrides = []): array
{
    return array_merge([
        'student_id' => $studentId,
        'period_month' => '2026-06-01',
        'title' => 'June progress',
        'body' => 'Steady improvement in fluency.',
    ], $overrides);
}

it('lets a teacher submit a report for an assigned student', function () {
    Sanctum::actingAs($this->teacherUser);

    $res = $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201);
    expect($res->json('status'))->toBe('PENDING');

    $this->asAcademy($this->academy);
    $row = DB::table('student_progress_reports')->where('id', $res->json('reportId'))->first();
    expect($row->status)->toBe('PENDING')
        ->and((string) $row->teacher_id)->toBe($this->teacher)
        ->and((string) $row->student_id)->toBe($this->student)
        ->and(Carbon::parse($row->period_month)->toDateString())->toBe('2026-06-01');
    expect(DB::table('audit_log')->where('action', 'student_report.submitted')->where('entity_id', $res->json('reportId'))->exists())->toBeTrue();
});

it('lists the teacher\'s assigned students for the picker', function () {
    Sanctum::actingAs($this->teacherUser);

    $students = $this->getJson('/api/student-reports/students')->assertOk()->json('students');
    expect($students)->toHaveCount(1)
        ->and($students[0]['id'])->toBe($this->student);
});

it('refuses a report for a student not assigned to the teacher', function () {
    $other = $this->createStudent($this->academy, overrides: ['full_name' => 'Stranger']);
    Sanctum::actingAs($this->teacherUser);

    $this->postJson('/api/student-reports', submitReport($other))
        ->assertStatus(422)->assertJsonValidationErrors('student_id');
});

it('blocks a second pending report for the same student and month', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201);

    $this->postJson('/api/student-reports', submitReport($this->student, ['title' => 'Again']))
        ->assertStatus(422)->assertJsonValidationErrors('period_month');
});

it('surfaces the report in the owner review queue', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201);

    Sanctum::actingAs($this->owner);
    $reports = $this->getJson('/api/student-reports/review')->assertOk()->json('reports');
    expect($reports)->toHaveCount(1)
        ->and($reports[0]['student_name'])->toBe('Pupil')
        ->and($reports[0]['teacher_name'])->toBe('Rep Teacher')
        ->and($reports[0]['status'])->toBe('PENDING');
});

it('counts pending student reports in the summary (but not the bell total)', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201);

    Sanctum::actingAs($this->owner);
    $summary = $this->getJson('/api/notifications/summary')->assertOk()->json();
    expect($summary['studentReports'])->toBe(1)
        ->and($summary['total'])->toBe(0); // student reports drive the tab badge, not the bell
});

it('lets the owner approve a report with a note', function () {
    Sanctum::actingAs($this->teacherUser);
    $id = $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201)->json('reportId');

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/student-reports/{$id}/approve", ['note' => 'Great work'])->assertOk();
    expect($res->json('status'))->toBe('APPROVED');

    $this->asAcademy($this->academy);
    $row = DB::table('student_progress_reports')->where('id', $id)->first();
    expect($row->status)->toBe('APPROVED')
        ->and($row->review_note)->toBe('Great work')
        ->and($row->reviewed_at)->not->toBeNull();
    expect(DB::table('audit_log')->where('action', 'student_report.approved')->where('entity_id', $id)->exists())->toBeTrue();
});

it('lets the owner reject a report and lets the teacher resubmit for that month', function () {
    Sanctum::actingAs($this->teacherUser);
    $id = $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201)->json('reportId');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/student-reports/{$id}/reject", ['note' => 'Add attendance details'])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('student_progress_reports')->where('id', $id)->value('status'))->toBe('REJECTED');
    $this->clearTenantContext();

    // A rejected report is locked, so the teacher may submit a NEW one for the same month.
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/student-reports', submitReport($this->student, ['title' => 'June progress v2']))
        ->assertStatus(201);
});

it('cannot review the same report twice', function () {
    Sanctum::actingAs($this->teacherUser);
    $id = $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201)->json('reportId');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/student-reports/{$id}/approve")->assertOk();
    $this->postJson("/api/student-reports/{$id}/reject")->assertStatus(422);
});

it('forbids a teacher from the owner-only review endpoints', function () {
    Sanctum::actingAs($this->teacherUser);
    $id = $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201)->json('reportId');

    $this->getJson('/api/student-reports/review')->assertStatus(403);
    $this->postJson("/api/student-reports/{$id}/approve")->assertStatus(403);
    $this->postJson("/api/student-reports/{$id}/reject")->assertStatus(403);
});

it('shows a teacher only their own reports', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201);

    $mine = $this->getJson('/api/student-reports')->assertOk()->json('reports');
    expect($mine)->toHaveCount(1)
        ->and($mine[0]['student_name'])->toBe('Pupil');
});

it('isolates reports across academies (RLS)', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/student-reports', submitReport($this->student))->assertStatus(201);

    // A second academy's owner sees nothing.
    $otherAcademy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $otherOwner = $this->makeUser($otherAcademy, 'ACADEMY_OWNER', ['email' => 'owner2-spr@test.local']);

    Sanctum::actingAs($otherOwner);
    expect($this->getJson('/api/student-reports/review')->assertOk()->json('reports'))->toHaveCount(0);
});
