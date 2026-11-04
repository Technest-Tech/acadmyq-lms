<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * lingo, 2026-11-03: Science and Maths with the same teacher. The second block was refused because a
 * subject was only its teacher. Now it is teacher + course, and a timetable slot names its subject.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-two@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Omnia']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Janna']);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->student, 'plan_label' => 'Hours package',
        'price_minor' => 16500, 'currency' => 'EGP', 'price_basis' => 'PER_PACKAGE', 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);
    DB::table('student_teacher_assignments')->insert([
        'academy_id' => $this->academy, 'student_id' => $this->student, 'teacher_id' => $this->teacher, 'course' => 'Science', 'started_at' => '2026-06-01',
    ]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['centre']);
    $this->clearTenantContext();

    /** A block of `$lessons` × 60 minutes for a subject of this teacher. */
    $this->open = function (string $course, int $lessons = 4, bool $autoRenew = false): string {
        Sanctum::actingAs($this->owner);

        return (string) $this->postJson('/api/packages', [
            'student_id' => $this->student, 'teacher_id' => $this->teacher, 'course' => $course, 'label' => 'Private '.$course,
            'hours' => $lessons, 'lesson_minutes' => 60, 'price_minor' => $lessons * 25000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => $autoRenew,
        ])->assertCreated()->json('id');
    };
    $this->block = function (string $id): object {
        $this->asAcademy($this->academy);

        return DB::table('lesson_packages')->where('id', $id)->first();
    };
    $this->attend = function (?string $course, string $at): string {
        $session = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => $at, 'duration_minutes' => 40, 'status' => 'SCHEDULED', 'course' => $course,
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return (string) $session;
    };
    $this->row = function (string $id): array {
        Sanctum::actingAs($this->owner);

        return collect($this->getJson("/api/packages?student_id={$this->student}")->assertOk()->json('packages'))->firstWhere('id', $id);
    };
});

afterEach(fn () => Carbon::setTestNow());

it('opens a second subject with the same teacher, and refuses the same subject twice', function () {
    $science = ($this->open)('Science');
    $maths = ($this->open)('Maths');

    expect((string) ($this->block)($science)->course)->toBe('Science');
    expect((string) ($this->block)($maths)->course)->toBe('Maths');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/packages', [
        'student_id' => $this->student, 'teacher_id' => $this->teacher, 'course' => ' maths ', 'label' => 'Again',
        'hours' => 4, 'lesson_minutes' => 60, 'price_minor' => 100000, 'currency' => 'EGP', 'starts_on' => '2026-06-01',
    ])->assertStatus(422);
});

it('holds the one-block-per-subject rule in the database too', function () {
    $science = ($this->open)('Science');
    $this->asAcademy($this->academy);
    $copy = (array) DB::table('lesson_packages')->where('id', $science)->first();
    $copy['id'] = (string) Str::uuid();
    $copy['sequence_no'] = 99;
    $copy['course'] = 'SCIENCE';

    expect(fn () => DB::transaction(fn () => DB::table('lesson_packages')->insert($copy)))->toThrow(QueryException::class);
});

it('takes each lesson off its own subject, and one naming none off the older block', function () {
    $science = ($this->open)('Science');
    $maths = ($this->open)('Maths');

    ($this->attend)('Maths', '2026-06-02 10:00:00+00');
    expect((int) ($this->block)($maths)->minutes_consumed)->toBe(60);
    expect((int) ($this->block)($science)->minutes_consumed)->toBe(0);

    ($this->attend)('science', '2026-06-03 10:00:00+00');
    expect((int) ($this->block)($science)->minutes_consumed)->toBe(60);

    ($this->attend)(null, '2026-06-04 10:00:00+00');
    expect((int) ($this->block)($science)->minutes_consumed)->toBe(120);
    expect((int) ($this->block)($maths)->minutes_consumed)->toBe(60);
});

it('keeps taking every lesson on the one block when the teacher has just one subject', function () {
    $science = ($this->open)('Science');

    ($this->attend)(null, '2026-06-02 10:00:00+00');
    ($this->attend)('Something old', '2026-06-03 10:00:00+00');

    expect((int) ($this->block)($science)->minutes_consumed)->toBe(120);
});

it('stamps a timetable slot\'s subject on its lessons, and moves the unmarked ones when it changes', function () {
    ($this->open)('Science');
    ($this->open)('Maths');

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/students/{$this->student}/schedule", [
        'teacher_id' => $this->teacher, 'start_date' => '2026-06-12',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60, 'course' => 'Science'],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60, 'course' => 'Maths'],
        ],
    ])->assertSuccessful();

    $this->asAcademy($this->academy);
    $courses = DB::table('sessions')->where('student_id', $this->student)->pluck('course')->unique()->sort()->values()->all();
    expect($courses)->toBe(['Maths', 'Science']);

    Sanctum::actingAs($this->owner);
    $read = $this->getJson("/api/students/{$this->student}/schedule?teacher_id={$this->teacher}")->assertOk();
    expect($read->json('subjects'))->toBe(['Science', 'Maths']);
    expect(collect($read->json('slots'))->pluck('course')->all())->toBe(['Science', 'Maths']);

    $this->putJson("/api/students/{$this->student}/schedule", [
        'teacher_id' => $this->teacher, 'start_date' => '2026-06-12',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60, 'course' => 'Maths'],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60, 'course' => 'Maths'],
        ],
    ])->assertSuccessful();

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('student_id', $this->student)->where('status', 'SCHEDULED')->pluck('course')->unique()->values()->all())->toBe(['Maths']);
});

it('leaves a slot\'s subject alone when an older form saves without one', function () {
    ($this->open)('Science');
    ($this->open)('Maths');

    Sanctum::actingAs($this->owner);
    $slot = ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60];
    $this->putJson("/api/students/{$this->student}/schedule", ['teacher_id' => $this->teacher, 'start_date' => '2026-06-12', 'slots' => [$slot + ['course' => 'Maths']]])->assertSuccessful();
    $this->putJson("/api/students/{$this->student}/schedule", ['teacher_id' => $this->teacher, 'start_date' => '2026-06-12', 'slots' => [$slot]])->assertSuccessful();

    $this->asAcademy($this->academy);
    expect(DB::table('schedule_slots')->value('course'))->toBe('Maths');
});

it('renews a finished subject as that subject, beside the other one', function () {
    $science = ($this->open)('Science');
    $maths = ($this->open)('Maths', 1, true);

    ($this->attend)('Maths', '2026-06-02 10:00:00+00');

    expect((string) ($this->block)($maths)->status)->toBe('COMPLETED');
    $this->asAcademy($this->academy);
    $next = DB::table('lesson_packages')->where('student_id', $this->student)->where('status', 'ACTIVE')->where('id', '<>', $science)->first();
    expect($next)->not->toBeNull();
    expect((string) $next->course)->toBe('Maths');
    expect((string) ($this->block)($science)->status)->toBe('ACTIVE');
});

it('reopens a finished subject on undo even with the other subject open', function () {
    ($this->open)('Science');
    $maths = ($this->open)('Maths', 1);

    $session = ($this->attend)('Maths', '2026-06-02 10:00:00+00');
    expect((string) ($this->block)($maths)->status)->toBe('COMPLETED');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance/revert", ['reason' => 'wrong'])->assertSuccessful();

    expect((string) ($this->block)($maths)->status)->toBe('ACTIVE');
    expect((int) ($this->block)($maths)->minutes_consumed)->toBe(0);
});

it('counts upcoming lessons per subject', function () {
    $science = ($this->open)('Science');
    $maths = ($this->open)('Maths');
    foreach ([['Science', '2026-06-15'], ['Maths', '2026-06-16'], ['Maths', '2026-06-17']] as [$course, $day]) {
        $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => "{$day} 10:00:00+00", 'duration_minutes' => 60, 'status' => 'SCHEDULED', 'course' => $course]);
    }

    expect(($this->row)($science)['upcoming_lesson_count'])->toBe(1);
    expect(($this->row)($maths)['upcoming_lesson_count'])->toBe(2);
});

it('lists both subjects and which are open for the form', function () {
    ($this->open)('Science');
    ($this->open)('Maths');

    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson('/api/packages/students')->assertOk()->json('students'))->firstWhere('id', $this->student);

    expect(collect($row['subjects'])->pluck('course')->sort()->values()->all())->toBe(['Maths', 'Science']);
    expect(collect($row['open_blocks'])->pluck('course')->sort()->values()->all())->toBe(['Maths', 'Science']);
    expect($row['open_subjects'])->toBe([$this->teacher]);
});

it('names the subject on the student\'s link when it had none', function () {
    $this->asAcademy($this->academy);
    DB::table('student_teacher_assignments')->where('student_id', $this->student)->update(['course' => null]);

    ($this->open)('Science');

    $this->asAcademy($this->academy);
    expect(DB::table('student_teacher_assignments')->where('student_id', $this->student)->value('course'))->toBe('Science');
});
