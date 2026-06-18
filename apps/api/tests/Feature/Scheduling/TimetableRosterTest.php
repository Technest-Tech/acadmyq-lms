<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * GET /api/timetables — the academy's full timetable roster, period-independent. It lists every
 * ACTIVE schedule with its slots and names; a TEACHER is row-scoped to their own students while
 * an Owner sees them all, and RLS keeps another academy's timetables out entirely.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-15 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-tt@test.local']);

    $this->teacher1User = $this->makeUser($this->academy, 'TEACHER', ['email' => 't1-tt@test.local']);
    $this->teacher1 = $this->createTeacher($this->academy, ['full_name' => 'Teacher One', 'user_id' => $this->teacher1User->getKey()]);
    $this->teacher2 = $this->createTeacher($this->academy, ['full_name' => 'Teacher Two']);

    $this->student1 = $this->createStudent($this->academy, null, ['full_name' => 'Aisha']);
    $this->student2 = $this->createStudent($this->academy, null, ['full_name' => 'Bilal']);
    $this->assignTeacher($this->academy, $this->student1, $this->teacher1);
    $this->assignTeacher($this->academy, $this->student2, $this->teacher2);

    $this->asAcademy($this->academy);
    $sch1 = $this->createSchedule($this->academy, $this->student1, $this->teacher1);
    $this->addSlot($this->academy, $sch1, 1, '17:00:00', 30); // Mon 17:00
    $this->addSlot($this->academy, $sch1, 3, '18:00:00', 60); // Wed 18:00
    $sch2 = $this->createSchedule($this->academy, $this->student2, $this->teacher2);
    $this->addSlot($this->academy, $sch2, 2, '16:00:00', 45); // Tue 16:00
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

it('returns every active timetable with its slots for the owner', function () {
    Sanctum::actingAs($this->owner);

    $rows = $this->getJson('/api/timetables')->assertOk()->json('timetables');

    expect($rows)->toHaveCount(2);
    $aisha = collect($rows)->firstWhere('student_id', $this->student1);
    expect($aisha['student_name'])->toBe('Aisha');
    expect($aisha['teacher_name'])->toBe('Teacher One');
    expect($aisha['slots'])->toHaveCount(2);
    // Slots come back weekday-ordered.
    expect($aisha['slots'][0]['weekday'])->toBe(1);
    expect($aisha['slots'][0]['duration_minutes'])->toBe(30);
});

it('row-scopes a teacher to only their own students timetables', function () {
    Sanctum::actingAs($this->teacher1User);

    $rows = $this->getJson('/api/timetables')->assertOk()->json('timetables');

    expect(collect($rows)->pluck('student_id')->all())->toBe([$this->student1]);
});

it('never leaks another academy timetable (RLS)', function () {
    $other = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $ot = $this->createTeacher($other);
    $os = $this->createStudent($other);
    $this->assignTeacher($other, $os, $ot);
    $this->asAcademy($other);
    $osch = $this->createSchedule($other, $os, $ot);
    $this->addSlot($other, $osch, 4, '19:00:00', 30);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $rows = $this->getJson('/api/timetables')->assertOk()->json('timetables');

    expect(collect($rows)->pluck('student_id'))->not->toContain($os);
});

it('omits a deactivated schedule', function () {
    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/students/{$this->student2}/schedule")->assertOk();

    $rows = $this->getJson('/api/timetables')->assertOk()->json('timetables');

    expect(collect($rows)->pluck('student_id')->all())->toBe([$this->student1]);
});
