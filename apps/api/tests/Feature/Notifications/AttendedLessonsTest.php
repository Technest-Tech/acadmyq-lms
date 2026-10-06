<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/*
| The "Attended classes" tab: one LESSON_ATTENDED row per lesson marked attended. An activity
| log, so it has its own feed and count and stays off the bell.
*/

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-att@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-att@test.local', 'full_name' => 'Sara Teacher']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Sara Teacher', 'user_id' => $this->teacherUser->id]);
    $this->student = $this->createStudent($this->academy, overrides: ['full_name' => 'Pupil']);
    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-11 10:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED',
    ]);

    $this->attended = function (): array {
        Sanctum::actingAs($this->owner);

        return $this->getJson('/api/notifications?category=ATTENDED')->assertOk()->json('notifications');
    };
});

afterEach(fn () => Carbon::setTestNow());

it('logs a lesson the moment the teacher marks it attended', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $rows = ($this->attended)();

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['type'])->toBe('LESSON_ATTENDED')
        ->and($rows[0]['session_id'])->toBe($this->session)
        ->and($rows[0]['data']['teacher_name'])->toBe('Sara Teacher')
        ->and($rows[0]['data']['student_name'])->toBe('Pupil')
        ->and($rows[0]['data']['duration_minutes'])->toBe(60)
        ->and($rows[0]['data']['marked_by_role'])->toBe('TEACHER');
});

it('keeps the log out of the other tabs and off the bell', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    Sanctum::actingAs($this->owner);
    $default = $this->getJson('/api/notifications')->assertOk()->json('notifications');
    expect(collect($default)->where('category', 'ATTENDED'))->toHaveCount(0);

    $this->getJson('/api/notifications/summary')
        ->assertOk()
        ->assertJsonPath('attended', 1)
        ->assertJsonPath('reports', 0)
        ->assertJsonPath('total', 0);
});

it('marks the log read only when asked for that category', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/notifications/read-all')->assertOk();
    $this->getJson('/api/notifications/summary')->assertJsonPath('attended', 1);

    $this->postJson('/api/notifications/read-all', ['category' => 'ATTENDED'])->assertOk();
    $this->getJson('/api/notifications/summary')->assertJsonPath('attended', 0);
});

it('writes one row even when the lesson is marked attended twice', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    expect(($this->attended)())->toHaveCount(1);
});

it('drops the row when the outcome is taken back', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$this->session}/attendance/revert")->assertOk();

    expect(($this->attended)())->toHaveCount(0);
});

it('does not log a lesson that was cancelled', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'CANCELLED_BY_STUDENT'])->assertOk();

    expect(($this->attended)())->toHaveCount(0);
});

it('still deletes a teacher whose lessons are in the log', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$this->session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/teachers/{$this->teacher}")->assertSuccessful();

    expect(($this->attended)())->toHaveCount(0);
});
