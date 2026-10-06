<?php

declare(strict_types=1);

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

/**
 * A student may study with several teachers at once — one per course — and each teacher has
 * their own timetable with the student. What this pins down: the student is still ONE student
 * everywhere (lists, families), each timetable generates lessons for its own teacher only, and
 * replacing or removing one teacher never touches another teacher's lessons.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-15 06:00:00'); // Monday, mid-month: a real past and future
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-multi@test.local']);
    $this->quranUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'quran-multi@test.local']);
    $this->quran = $this->createTeacher($this->academy, ['full_name' => 'Quran Teacher', 'user_id' => $this->quranUser->getKey()]);
    $this->arabicUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'arabic-multi@test.local']);
    $this->arabic = $this->createTeacher($this->academy, ['full_name' => 'Arabic Teacher', 'user_id' => $this->arabicUser->getKey()]);
    $this->spare = $this->createTeacher($this->academy, ['full_name' => 'Spare Teacher']);
    $this->guardian = $this->createGuardian($this->academy);

    /** @return array<string,string> occurrence date => teacher id, for the student's generated lessons */
    $this->lessonTeachers = function (string $student): array {
        $this->asAcademy($this->academy);

        return DB::table('sessions')->where('student_id', $student)->whereNotNull('schedule_id')
            ->orderBy('scheduled_at_utc')->pluck('teacher_id', 'occurrence_local_date')
            ->map(fn ($id) => (string) $id)->all();
    };
});

afterEach(fn () => Carbon::setTestNow());

/** Create a student through the API with both teachers, as the create form does. */
function createWithTwoTeachers($test): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/students', [
        'full_name' => 'Two Teachers Student',
        'guardian_id' => $test->guardian,
        'teachers' => [
            ['teacher_id' => $test->quran, 'course' => 'Quran'],
            ['teacher_id' => $test->arabic, 'course' => '  Arabic  '],
        ],
    ])->assertCreated()->json('studentId');
}

/** Give one of the student's teachers a weekly timetable (one slot) and generate it. */
function timetableFor($test, string $student, string $teacher, int $weekday): void
{
    Sanctum::actingAs($test->owner);
    $test->putJson("/api/students/{$student}/schedule", [
        'teacher_id' => $teacher,
        'timezone' => 'Africa/Cairo',
        'start_date' => '2026-06-15',
        'slots' => [['weekday' => $weekday, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertSuccessful();
}

it('creates a student with several teachers, each with their course', function () {
    $student = createWithTwoTeachers($this);

    $detail = $this->getJson("/api/students/{$student}")->assertOk();
    expect(collect($detail->json('teachers'))->map(fn ($t) => [$t['teacher_id'], $t['course']])->all())
        ->toBe([[$this->arabic, 'Arabic'], [$this->quran, 'Quran']]); // added together → name order
    // The single-teacher key stays, pointing at the first one.
    expect($detail->json('currentTeacher.teacher_id'))->toBe($this->arabic);
});

it('lists a student with two teachers once, and finds them by either teacher', function () {
    $student = createWithTwoTeachers($this);

    $rows = $this->getJson('/api/students')->assertOk()->json('rows');
    $mine = collect($rows)->where('id', $student)->values();
    expect($mine)->toHaveCount(1)
        ->and($mine[0]['teacher_name'])->toBe('Arabic Teacher, Quran Teacher')
        ->and(collect($mine[0]['teachers'])->pluck('course')->all())->toBe(['Arabic', 'Quran']);

    $byArabic = $this->getJson("/api/students?filter[teacher_id]={$this->arabic}")->assertOk()->json('rows');
    expect(collect($byArabic)->pluck('id')->all())->toBe([$student]);

    // A family's children list does not double the child either.
    $children = $this->getJson("/api/guardians/{$this->guardian}")->assertOk()->json('children');
    expect(collect($children)->where('id', $student))->toHaveCount(1);
});

it('lets every one of the student\'s teachers see them', function () {
    $student = createWithTwoTeachers($this);

    foreach ([$this->quranUser, $this->arabicUser] as $user) {
        Sanctum::actingAs($user);
        expect(collect($this->getJson('/api/students')->assertOk()->json('rows'))->pluck('id')->all())->toContain($student);
        $this->getJson("/api/students/{$student}")->assertOk();
    }
});

it('gives each teacher their own timetable, and each generates lessons for its own teacher only', function () {
    $student = createWithTwoTeachers($this);
    timetableFor($this, $student, $this->quran, 2);   // Tuesdays
    timetableFor($this, $student, $this->arabic, 4);  // Thursdays

    $lessons = ($this->lessonTeachers)($student);
    expect($lessons['2026-06-16'])->toBe($this->quran)   // Tue
        ->and($lessons['2026-06-18'])->toBe($this->arabic) // Thu
        ->and($lessons['2026-06-23'])->toBe($this->quran)
        ->and($lessons['2026-06-25'])->toBe($this->arabic);

    Sanctum::actingAs($this->owner);
    $arabic = $this->getJson("/api/students/{$student}/schedule?teacher_id={$this->arabic}")->assertOk();
    expect($arabic->json('schedule.teacher_id'))->toBe($this->arabic)
        ->and(collect($arabic->json('slots'))->pluck('weekday')->all())->toBe([4]);

    // Without saying which teacher, there is no right answer — refused, not guessed.
    $this->getJson("/api/students/{$student}/schedule")->assertUnprocessable();
    $this->putJson("/api/students/{$student}/schedule", [
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertUnprocessable()->assertJsonValidationErrors('teacher_id');

    // The timetables roster shows both, each with its course.
    $roster = collect($this->getJson('/api/timetables')->assertOk()->json('timetables'))->where('student_id', $student);
    expect($roster->pluck('course', 'teacher_id')->all())->toBe([$this->arabic => 'Arabic', $this->quran => 'Quran']);
});

it('links a teacher who is given a timetable with a student they did not teach yet', function () {
    $student = createWithTwoTeachers($this);
    timetableFor($this, $student, $this->spare, 6);

    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson("/api/students/{$student}")->json('teachers'))->pluck('teacher_id')->all())
        ->toContain($this->spare);
});

it('replaces one teacher: the newcomer takes their course and lessons, the other teacher is untouched', function () {
    $student = createWithTwoTeachers($this);
    timetableFor($this, $student, $this->quran, 2);
    timetableFor($this, $student, $this->arabic, 4);

    Sanctum::actingAs($this->owner);
    // With two teachers, "replace" must say which one.
    $this->postJson("/api/students/{$student}/teacher", ['teacher_id' => $this->spare])
        ->assertUnprocessable()->assertJsonValidationErrors('replaces_teacher_id');
    // Nor may the newcomer be someone who already teaches them.
    $this->postJson("/api/students/{$student}/teacher", ['teacher_id' => $this->arabic, 'replaces_teacher_id' => $this->quran])
        ->assertUnprocessable()->assertJsonValidationErrors('teacher_id');

    $this->postJson("/api/students/{$student}/teacher", [
        'teacher_id' => $this->spare,
        'replaces_teacher_id' => $this->quran,
    ])->assertOk();

    $teachers = collect($this->getJson("/api/students/{$student}")->json('teachers'));
    expect($teachers->pluck('course', 'teacher_id')->all())->toBe([$this->arabic => 'Arabic', $this->spare => 'Quran']);

    $lessons = ($this->lessonTeachers)($student);
    expect($lessons['2026-06-16'])->toBe($this->spare)
        ->and($lessons['2026-06-23'])->toBe($this->spare)
        ->and($lessons['2026-06-18'])->toBe($this->arabic)
        ->and($lessons['2026-06-25'])->toBe($this->arabic);
});

it('removes a teacher: their timetable and future lessons end, history and the other teacher stay', function () {
    $student = createWithTwoTeachers($this);
    timetableFor($this, $student, $this->quran, 2);
    timetableFor($this, $student, $this->arabic, 4);

    // A past Arabic lesson that was taught — history.
    $this->asAcademy($this->academy);
    $past = (string) Str::uuid();
    DB::table('sessions')->insert([
        'id' => $past, 'academy_id' => $this->academy, 'student_id' => $student, 'teacher_id' => $this->arabic,
        'scheduled_at_utc' => '2026-06-11 14:00:00+00', 'duration_minutes' => 30, 'status' => 'ATTENDED',
    ]);

    Sanctum::actingAs($this->owner);
    $res = $this->putJson("/api/students/{$student}/teachers", [
        'teachers' => [['teacher_id' => $this->quran, 'course' => 'Quran & Tajweed']],
    ])->assertOk();
    expect($res->json('removed'))->toBe([$this->arabic])
        ->and($res->json('timetables_ended'))->toBe(1)
        ->and($res->json('lessons_removed'))->toBeGreaterThan(0);

    $teachers = collect($this->getJson("/api/students/{$student}")->json('teachers'));
    expect($teachers->pluck('course', 'teacher_id')->all())->toBe([$this->quran => 'Quran & Tajweed']);

    $lessons = ($this->lessonTeachers)($student);
    expect(array_unique(array_values($lessons)))->toBe([$this->quran]);
    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $past)->value('status'))->toBe('ATTENDED');

    // The removal is history, not a delete.
    $history = collect($this->getJson("/api/students/{$student}/teacher-history")->json('history'));
    expect($history->firstWhere('teacher_id', $this->arabic)['ended_at'])->not->toBeNull();

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'student.teacher_removed')->where('entity_id', $student)->exists())->toBeTrue()
        ->and(DB::table('audit_log')->where('action', 'student.teacher_course_changed')->where('entity_id', $student)->exists())->toBeTrue();
});

it('adds a teacher to a student who already has one, without touching the first', function () {
    Sanctum::actingAs($this->owner);
    $student = $this->postJson('/api/students', [
        'full_name' => 'One Teacher Student',
        'guardian_id' => $this->guardian,
        'teacher_id' => $this->quran, // the older single-teacher shape still works
    ])->assertCreated()->json('studentId');

    $this->putJson("/api/students/{$student}/teachers", [
        'teachers' => [
            ['teacher_id' => $this->quran],
            ['teacher_id' => $this->arabic, 'course' => 'Arabic'],
        ],
    ])->assertOk()->assertJsonPath('added', [$this->arabic])->assertJsonPath('removed', []);

    $history = collect($this->getJson("/api/students/{$student}/teacher-history")->json('history'));
    expect($history)->toHaveCount(2)
        ->and($history->whereNull('ended_at'))->toHaveCount(2);
});

it('refuses an ad-hoc lesson without a teacher for a student with two, and accepts it from either teacher', function () {
    $student = createWithTwoTeachers($this);
    $lesson = ['student_id' => $student, 'local_datetime' => '2026-06-20 10:00', 'timezone' => 'Africa/Cairo', 'duration_minutes' => 30];

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/sessions', $lesson)->assertUnprocessable()->assertJsonValidationErrors('teacher_id');
    $this->postJson('/api/sessions', $lesson + ['teacher_id' => $this->arabic])->assertCreated();

    // The SECOND teacher is as much the student's teacher as the first.
    Sanctum::actingAs($this->arabicUser);
    $id = $this->postJson('/api/sessions', ['local_datetime' => '2026-06-21 10:00'] + $lesson)->assertCreated()->json('sessionId');
    $this->asAcademy($this->academy);
    expect((string) DB::table('sessions')->where('id', $id)->value('teacher_id'))->toBe($this->arabic);
});

it('allows two different active teachers per student but never the same teacher twice', function () {
    $student = $this->createStudent($this->academy, $this->guardian);
    $this->asAcademy($this->academy);
    $row = fn (string $teacher) => [
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy,
        'student_id' => $student, 'teacher_id' => $teacher, 'ended_at' => null,
    ];

    DB::table('student_teacher_assignments')->insert($row($this->quran));
    DB::table('student_teacher_assignments')->insert($row($this->arabic));
    expect(fn () => DB::table('student_teacher_assignments')->insert($row($this->quran)))->toThrow(QueryException::class);
});
