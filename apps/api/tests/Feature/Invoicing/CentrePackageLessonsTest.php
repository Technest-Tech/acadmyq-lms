<?php

declare(strict_types=1);

use App\Services\LessonPackages;
use App\Services\ModuleBilling;
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

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * A curriculum centre's private subscriptions (lingo, 2026-10-31): the old blocks sold in hours read
 * in lessons like the new ones, a finished block says why and who ended it, and a student taking two
 * subjects sees each block's own upcoming lessons.
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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-cpl@test.local', 'full_name' => 'Nour Office']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Sama']);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Mr Adel']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);

    /** A student billed by the block. */
    $this->packageStudent = function (string $name): string {
        $id = $this->createStudent($this->academy, $this->guardian, ['full_name' => $name]);
        $this->asAcademy($this->academy);
        DB::table('subscriptions')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $id,
            'plan_label' => 'Hours package', 'price_minor' => 16500, 'currency' => 'EGP',
            'price_basis' => 'PER_PACKAGE', 'sessions_per_month' => null, 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
        ]);

        return $id;
    };

    $this->open = function (string $studentId, float $hours, ?string $teacherId = null): string {
        $this->asAcademy($this->academy);

        return app(LessonPackages::class)->open([
            'student_id' => $studentId, 'label' => $hours.' hours', 'minutes_total' => (int) round($hours * 60),
            'price_minor' => 66000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
            'teacher_id' => $teacherId,
        ], (string) $this->owner->id, 'ACADEMY_OWNER')['package_id'];
    };

    $this->attend = function (string $studentId, int $minutes, string $at): void {
        $session = $this->createSession($this->academy, $studentId, $this->teacher, [
            'scheduled_at_utc' => $at, 'duration_minutes' => $minutes, 'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    };

    $this->lessonMinutes = function (string $packageId): ?int {
        $this->asAcademy($this->academy);
        $v = DB::table('lesson_packages')->where('id', $packageId)->value('lesson_minutes');

        return $v !== null ? (int) $v : null;
    };

    $this->fill = fn (): int => (require base_path('database/migrations/2026_10_31_100001_centre_packages_in_lessons.php'))->fill();
});

afterEach(fn () => Carbon::setTestNow());

function cplCentreOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['centre']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

it('reads a centre\'s old hour blocks in lessons, from the lessons they actually had', function () {
    $malika = ($this->packageStudent)('Malika');
    $taught = ($this->open)($malika, 4);
    ($this->attend)($malika, 40, '2026-06-02 10:00:00+00');
    ($this->attend)($malika, 40, '2026-06-04 10:00:00+00');

    // No lesson yet, but a timetable of 45-minute lessons.
    $hassan = ($this->packageStudent)('Hassan');
    $scheduled = ($this->open)($hassan, 3);
    $this->asAcademy($this->academy);
    $schedule = $this->createSchedule($this->academy, $hassan, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 45);
    $this->addSlot($this->academy, $schedule, 3, '17:00:00', 45);

    // Nothing to go on: stays in hours.
    $empty = ($this->open)(($this->packageStudent)('Omar'), 2);

    // Not a centre (yet): nothing changes.
    expect(($this->fill)())->toBe(0)
        ->and(($this->lessonMinutes)($taught))->toBeNull();

    cplCentreOn($this->academy);
    expect(($this->fill)())->toBe(2);

    expect(($this->lessonMinutes)($taught))->toBe(40)
        ->and(($this->lessonMinutes)($scheduled))->toBe(45)
        ->and(($this->lessonMinutes)($empty))->toBeNull();

    // The balance never moves — only how it reads.
    $this->asAcademy($this->academy);
    $row = DB::table('lesson_packages')->where('id', $taught)->first();
    expect((int) $row->minutes_total)->toBe(240)->and((int) $row->minutes_consumed)->toBe(80);

    // Idempotent, and a length already set is never touched.
    expect(($this->fill)())->toBe(0);
});

it('says who ended a subscription by hand, and nobody for one that ran out', function () {
    $student = ($this->packageStudent)('Hassan');
    $ranOut = ($this->open)($student, 1);
    ($this->attend)($student, 60, '2026-06-02 10:00:00+00');
    $ended = ($this->open)($student, 4);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$ended}/close")->assertOk();

    $rows = collect($this->getJson("/api/packages?student_id={$student}")->assertOk()->json('packages'))->keyBy('id');
    expect($rows[$ranOut]['closed_reason'])->toBe('EXHAUSTED')
        ->and($rows[$ranOut]['closed_by_name'])->toBeNull()
        ->and($rows[$ended]['closed_reason'])->toBe('CLOSED_EARLY')
        ->and($rows[$ended]['closed_by_name'])->toBe('Nour Office');
});

it('counts only its own subject\'s upcoming lessons on a block tied to a subject', function () {
    cplCentreOn($this->academy);
    $student = ($this->packageStudent)('Hassan');
    $this->asAcademy($this->academy);
    // Two subjects at once (one teacher each).
    foreach ([[$this->teacher, 'Connect Plus'], [$this->other, 'English OL']] as [$teacherId, $course]) {
        DB::table('student_teacher_assignments')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $student,
            'teacher_id' => $teacherId, 'course' => $course, 'started_at' => now(), 'ended_at' => null,
        ]);
    }
    $sama = ($this->open)($student, 5, $this->teacher);
    $adel = ($this->open)($student, 5, $this->other);

    $this->asAcademy($this->academy);
    foreach (['2026-06-20 15:00:00+00', '2026-06-22 15:00:00+00'] as $at) {
        $this->createSession($this->academy, $student, $this->teacher, ['scheduled_at_utc' => $at, 'duration_minutes' => 40, 'status' => 'SCHEDULED']);
    }
    $this->createSession($this->academy, $student, $this->other, ['scheduled_at_utc' => '2026-06-21 15:00:00+00', 'duration_minutes' => 40, 'status' => 'SCHEDULED']);

    Sanctum::actingAs($this->owner);
    $rows = collect($this->getJson("/api/packages?student_id={$student}")->assertOk()->json('packages'))->keyBy('id');
    expect($rows[$sama]['upcoming_lesson_count'])->toBe(2)
        ->and($rows[$adel]['upcoming_lesson_count'])->toBe(1)
        ->and(substr((string) $rows[$adel]['next_lesson_at'], 0, 10))->toBe('2026-06-21');
});
