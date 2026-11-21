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

/**
 * Settings → Controls "report required" (2026-11-21): a teacher records a lesson as attended only
 * once its report is written. Off by default; the office is never held to it.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-05-15 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-report-req@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-report-req@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->getKey(), 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);

    $this->clearTenantContext();
    $this->sessionId = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => now()->subHours(2)->format('Y-m-d H:i:sP'),
        'duration_minutes' => 30,
        'status' => 'SCHEDULED',
    ]);
    $this->clearTenantContext();

    $this->require = function (bool $on = true): void {
        Sanctum::actingAs($this->owner);
        $this->putJson('/api/academy/settings', ['teacher_report_required' => $on])
            ->assertOk()
            ->assertJsonPath('settings.teacher_report_required', $on);
    };
    $this->status = function (): string {
        $this->asAcademy($this->academy);
        $status = (string) DB::table('sessions')->where('id', $this->sessionId)->value('status');
        $this->clearTenantContext();

        return $status;
    };
});

afterEach(fn () => Carbon::setTestNow());

it('is off by default: a teacher records a lesson with no report, as before', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.teacherReportRequired', false);
    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();
});

it('refuses a teacher recording an attended lesson with no report once switched on', function () {
    ($this->require)();
    Sanctum::actingAs($this->teacherUser);

    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.teacherReportRequired', true);
    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('report');

    expect(($this->status)())->toBe('SCHEDULED');
});

it('does not take an empty box or bare markup for a report', function () {
    ($this->require)();
    Sanctum::actingAs($this->teacherUser);

    $this->putJson("/api/sessions/{$this->sessionId}/report", ['values' => ['report_text' => '<p>&nbsp; </p><br>']])->assertOk();
    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('report');

    expect(($this->status)())->toBe('SCHEDULED');
});

it('records the lesson once the teacher has written the report', function () {
    ($this->require)();
    Sanctum::actingAs($this->teacherUser);

    $this->putJson("/api/sessions/{$this->sessionId}/report", ['values' => ['report_text' => '<p>حفظ سورة الملك</p>']])->assertOk();
    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();

    expect(($this->status)())->toBe('ATTENDED');
});

it('never holds the office to it', function () {
    ($this->require)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();

    expect(($this->status)())->toBe('ATTENDED');
});

it('lets the teacher record again once the switch is turned off', function () {
    ($this->require)();
    ($this->require)(false);
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();
});
