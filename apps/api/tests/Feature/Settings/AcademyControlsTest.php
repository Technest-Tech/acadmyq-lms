<?php

declare(strict_types=1);

use App\Jobs\AutoDeductUnreportedSessionsJob;
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

/**
 * Academy controls (Settings → Controls). The first switch makes lessons read-only for teachers:
 * they still see them, but cannot add a class, mark attendance, write a report, reschedule, or
 * raise a cancel/free request. It works by stripping capabilities from the TEACHER set, so this
 * file checks the endpoints themselves, not just the flag.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-05-15 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone'         => 'Africa/Cairo',
        'plan_id'          => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-controls@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-controls@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->getKey(), 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);

    $this->clearTenantContext();
    $this->sessionId = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => now()->subHours(9)->format('Y-m-d H:i:sP'),
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    $this->clearTenantContext();

    $this->lock = function (bool $on = true): void {
        Sanctum::actingAs($this->owner);
        $this->putJson('/api/academy/settings', ['teacher_lessons_read_only' => $on])
            ->assertOk()
            ->assertJsonPath('settings.teacher_lessons_read_only', $on);
    };
});

afterEach(fn () => Carbon::setTestNow());

it('defaults to teachers being able to work on lessons', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/academy/settings')
        ->assertOk()
        ->assertJsonPath('settings.teacher_lessons_read_only', false);
});

it('only lets someone who manages settings change the controls', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->putJson('/api/academy/settings', ['teacher_lessons_read_only' => false])->assertForbidden();
    $this->getJson('/api/academy/settings')->assertForbidden();
});

it('strips the lesson-writing capabilities from a teacher once locked', function () {
    ($this->lock)();

    Sanctum::actingAs($this->teacherUser);
    $perms = $this->getJson('/api/auth/me')->assertOk()->json('permissions');

    expect($perms)->toContain('session.read')
        ->and($perms)->not->toContain('session.create')
        ->and($perms)->not->toContain('session.mark_attendance')
        ->and($perms)->not->toContain('session.write_report')
        ->and($perms)->not->toContain('session.reschedule')
        ->and($perms)->not->toContain('session.cancel_request')
        ->and($perms)->not->toContain('session.free_request');
});

it('blocks a locked teacher from adding, marking, reporting and requesting', function () {
    ($this->lock)();
    Sanctum::actingAs($this->teacherUser);

    $this->postJson('/api/sessions', [
        'student_id'       => $this->student,
        'local_datetime'   => '2026-05-15 08:00',
        'timezone'         => 'Africa/Cairo',
        'duration_minutes' => 45,
    ])->assertForbidden();

    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])->assertForbidden();
    $this->putJson("/api/sessions/{$this->sessionId}/report", ['values' => ['report_text' => 'x']])->assertForbidden();
    $this->postJson("/api/sessions/{$this->sessionId}/cancellation-request", ['reason' => 'x'])->assertForbidden();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->sessionId)->value('status'))->toBe('SCHEDULED')
        ->and(DB::table('sessions')->where('academy_id', $this->academy)->count())->toBe(1);
});

it('still lets the owner mark a lesson while teachers are locked', function () {
    ($this->lock)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();
});

it('gives a teacher their lessons back when the lock is lifted', function () {
    ($this->lock)();
    ($this->lock)(false);

    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->sessionId}/attendance", ['status' => 'ATTENDED'])->assertOk();
});

it('never docks a locked teacher for a lesson they were not allowed to mark', function () {
    $this->asAcademy($this->academy);
    DB::table('teacher_quality_settings')->insert([
        'id'                       => (string) Str::uuid(),
        'academy_id'               => $this->academy,
        'auto_deduct_enabled'      => true,
        'auto_deduct_grace_hours'  => 6,
        'auto_deduct_basis'        => 'FIXED',
        'auto_deduct_amount_minor' => 2000,
        'auto_deduct_bp'           => 0,
    ]);
    $this->clearTenantContext();
    ($this->lock)();

    $docked = (new AutoDeductUnreportedSessionsJob($this->academy))->handle();

    expect($docked[$this->academy])->toBe(0);
});
