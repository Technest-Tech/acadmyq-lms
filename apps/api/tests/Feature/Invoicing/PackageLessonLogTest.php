<?php

declare(strict_types=1);

use App\Services\LessonPackages;
use App\Services\SessionGenerator;
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
 * The student profile's lesson log (EnglishSpirit, 2026-11-11): one package's lessons, no more and
 * no less. A block of 4 hours in hour lessons lists 4: what it counted, what is unmarked since it
 * started, and the upcoming lessons its balance still pays for — or a count of those with no date.
 * The package card's "N upcoming" reads the same rule, so the card, the schedules log and this list
 * never disagree.
 */
beforeEach(function () {
    // Thursday 11 June 2026, 15:00 Cairo.
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-pkglog@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-pkglog@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id]);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Hours package',
        'price_minor' => 20000,
        'currency' => 'EGP',
        'price_basis' => 'PER_PACKAGE',
        'sessions_per_month' => null,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    // 4 hours from 1 June, nothing renews.
    $this->packageId = app(LessonPackages::class)->open([
        'student_id' => $this->student,
        'label' => '4 hours',
        'minutes_total' => 240,
        'price_minor' => 80000,
        'currency' => 'EGP',
        'bill_timing' => 'ON_START',
        'starts_on' => '2026-06-01',
        'carry_over' => false,
        'auto_renew' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER')['package_id'];

    $this->lesson = function (string $at, string $status = 'SCHEDULED', int $minutes = 60): string {
        $this->asAcademy($this->academy);

        return $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => $at,
            'duration_minutes' => $minutes,
            'status' => $status,
        ]);
    };
    $this->attend = function (string $session): void {
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    };
    $this->log = function () {
        Sanctum::actingAs($this->owner);

        return $this->getJson("/api/packages/{$this->packageId}/lessons")->assertOk();
    };
    $this->card = function (): array {
        Sanctum::actingAs($this->owner);

        return collect($this->getJson("/api/packages?student_id={$this->student}")->assertOk()->json('packages'))
            ->firstWhere('id', $this->packageId);
    };

    // Before the block began, never marked: not its lesson.
    $this->before = ($this->lesson)('2026-05-28 10:00:00+00');
    // Taken off the block.
    $this->taken = ($this->lesson)('2026-06-02 10:00:00+00');
    ($this->attend)($this->taken);
    // Cancelled by the teacher: in the block's time, never counted.
    $this->cancelled = ($this->lesson)('2026-06-05 10:00:00+00', 'CANCELLED_BY_TEACHER');
    // Past and still unmarked: it comes off this block when marked.
    $this->unmarked = ($this->lesson)('2026-06-09 10:00:00+00');
});

afterEach(fn () => Carbon::setTestNow());

it('lists exactly the block: counted, unmarked, and the upcoming lessons its balance still pays for', function () {
    $first = ($this->lesson)('2026-06-12 10:00:00+00');
    $second = ($this->lesson)('2026-06-14 10:00:00+00');
    $past = ($this->lesson)('2026-06-16 10:00:00+00'); // the 5th hour: the next block's

    $res = ($this->log)();

    expect(collect($res->json('lessons'))->map(fn ($l) => [$l['id'], $l['package_state']])->all())->toBe([
        [$this->taken, 'COUNTED'],
        [$this->unmarked, 'UNMARKED'],
        [$first, 'UPCOMING'],
        [$second, 'UPCOMING'],
    ])
        ->and($res->json('unscheduled'))->toBe(0)
        ->and($res->json('lessons_total'))->toBe(4)
        ->and(collect($res->json('not_counted'))->pluck('id')->all())->toBe([$this->cancelled]);

    // The calendar's shape, so the web renders it like any lesson.
    expect($res->json('lessons.0'))->toMatchArray([
        'status' => 'ATTENDED',
        'duration_minutes' => 60,
        'teacher_id' => $this->teacher,
        'scheduled_at_utc' => '2026-06-02T10:00:00+00:00',
    ]);

    // The card says the same: the unmarked lesson is paid for before the upcoming ones.
    expect(($this->card)()['upcoming_in_package_count'])->toBe(2);
    expect(collect($res->json('lessons'))->pluck('id'))->not->toContain($past, $this->before);
});

it('counts what the balance pays for that the timetable has not put on a date yet', function () {
    $only = ($this->lesson)('2026-06-12 10:00:00+00');

    $res = ($this->log)();

    expect(collect($res->json('lessons'))->pluck('id')->all())->toBe([$this->taken, $this->unmarked, $only])
        ->and($res->json('unscheduled'))->toBe(1)
        ->and($res->json('lessons_total'))->toBe(4);
});

it('dates the rest of a long block from the timetable, past the calendar window', function () {
    // 20 hour lessons; the calendar only holds the timetable to the end of next month.
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->where('id', $this->packageId)->update(['minutes_total' => 1200]);
    // Sundays 13:00 Cairo (10:00 UTC in summer).
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 0, '13:00:00', 60);
    app(SessionGenerator::class)->generateForSchedule($schedule, ...SessionGenerator::defaultWindow());
    // A holiday on a Sunday past the window: no lesson that day.
    DB::table('academy_holidays')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'name' => 'Break',
        'starts_on' => '2026-08-09', 'ends_on' => '2026-08-09',
    ]);

    $res = ($this->log)();
    $lessons = collect($res->json('lessons'));
    $upcoming = $lessons->where('package_state', 'UPCOMING')->values();
    $planned = $upcoming->where('planned', true)->values();

    // 1 counted + 1 unmarked + 18 upcoming: the whole block, every one on a date.
    expect($lessons)->toHaveCount(20)
        ->and($res->json('unscheduled'))->toBe(0)
        ->and($res->json('lessons_total'))->toBe(20)
        ->and($upcoming)->toHaveCount(18)
        // June 14 → July 26 are on the calendar already; the rest are read off the timetable.
        ->and($upcoming->where('planned', false)->count())->toBe(7)
        ->and($planned)->toHaveCount(11)
        ->and($planned->first()['scheduled_at_utc'])->toBe('2026-08-02T10:00:00+00:00')
        ->and($planned->pluck('scheduled_at_utc'))->not->toContain('2026-08-09T10:00:00+00:00')
        ->and($planned->last()['scheduled_at_utc'])->toBe('2026-10-18T10:00:00+00:00')
        ->and($planned->first())->toMatchArray(['status' => 'SCHEDULED', 'duration_minutes' => 60, 'teacher_id' => $this->teacher, 'schedule_id' => $schedule]);

    // Read only: nothing was written to the calendar.
    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('schedule_id', $schedule)->count())->toBe(7);
});

it('dates nothing from a timetable that is switched off', function () {
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->where('id', $this->packageId)->update(['minutes_total' => 1200]);
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher, overrides: ['is_active' => false]);
    $this->addSlot($this->academy, $schedule, 0, '13:00:00', 60);

    $res = ($this->log)();

    expect(collect($res->json('lessons'))->where('planned', true))->toHaveCount(0)
        ->and($res->json('unscheduled'))->toBe(18);
});

it('lists a finished block by what it counted, and nothing upcoming', function () {
    $lessons = [
        ($this->lesson)('2026-06-10 10:00:00+00'),
        ($this->lesson)('2026-06-10 12:00:00+00'),
    ];
    // The unmarked one is marked now; with the two above the block runs out (4 × 60).
    ($this->attend)($this->unmarked);
    foreach ($lessons as $lesson) {
        ($this->attend)($lesson);
    }
    $later = ($this->lesson)('2026-06-12 10:00:00+00');

    $this->asAcademy($this->academy);
    expect(DB::table('lesson_packages')->where('id', $this->packageId)->value('status'))->toBe('COMPLETED');

    $res = ($this->log)();

    expect(collect($res->json('lessons'))->pluck('package_state')->unique()->all())->toBe(['COUNTED'])
        ->and(collect($res->json('lessons'))->pluck('id')->all())->toBe([$this->taken, $this->unmarked, ...$lessons])
        ->and($res->json('lessons_total'))->toBe(4)
        ->and(collect($res->json('lessons'))->pluck('id'))->not->toContain($later);
});

it('is the package reader own: a teacher cannot read it', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->getJson("/api/packages/{$this->packageId}/lessons")->assertForbidden();
});
