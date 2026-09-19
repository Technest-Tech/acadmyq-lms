<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * Moving a client off the old (pre-AcademiQ) app. The export is a fixture here, so these tests
 * pin the four judgement calls the importer makes — everything the old schema could not say:
 *
 *   • a shared WhatsApp number is one family, not two unrelated payers
 *   • the live timetable, not the append-only join table, says who teaches a student today
 *   • an imported timetable starts TODAY, so the generator never invents lessons nobody taught
 *   • running it twice imports the client once
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class);

beforeEach(function () {
    Carbon::setTestNow('2026-09-18 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
    ]);
    $this->clearTenantContext();

    $this->exportFile = tempnam(sys_get_temp_dir(), 'legacy').'.json';
    file_put_contents($this->exportFile, json_encode(legacyExportFixture(), JSON_UNESCAPED_UNICODE));
});

afterEach(function () {
    Carbon::setTestNow();
    @unlink($this->exportFile);
});

/**
 * One teacher pair, one sibling pair on a shared phone, one student with no number at all, one
 * live timetable series and one that ran out last year.
 */
function legacyExportFixture(): array
{
    return [
        'format' => 'academiq.legacy-export/1',
        'source' => 'ehsan',
        'exported_at' => '2026-09-18T09:00:00+00:00',
        'teachers' => [
            ['legacy_id' => 10, 'name' => 'أستاذ أول', 'email' => null, 'phone_raw' => '201001234567', 'hour_price' => null, 'currency' => null, 'timezone' => 'Africa/Cairo', 'created_at' => '2024-01-01 00:00:00'],
            ['legacy_id' => 11, 'name' => 'أستاذ ثانٍ', 'email' => null, 'phone_raw' => null, 'hour_price' => null, 'currency' => null, 'timezone' => null, 'created_at' => '2024-01-01 00:00:00'],
        ],
        'students' => [
            // Siblings: the old app has no payer, only a number typed twice.
            ['legacy_id' => 100, 'name' => 'ابن أول', 'email' => null, 'phone_raw' => '447000000001', 'hour_price' => 5.0, 'currency' => 'GBP', 'timezone' => null, 'created_at' => '2024-02-01 00:00:00', 'first_activity_date' => '2024-02-02'],
            ['legacy_id' => 101, 'name' => 'ابن ثانٍ', 'email' => null, 'phone_raw' => '447000000001', 'hour_price' => 6.0, 'currency' => 'GBP', 'timezone' => null, 'created_at' => '2024-03-01 00:00:00', 'first_activity_date' => '2024-03-02'],
            ['legacy_id' => 102, 'name' => 'بلا رقم', 'email' => null, 'phone_raw' => null, 'hour_price' => 4.0, 'currency' => 'USD', 'timezone' => null, 'created_at' => '2024-04-01 00:00:00', 'first_activity_date' => null],
        ],
        'other_users' => [],
        'assignments' => [
            ['student_legacy_id' => 100, 'teacher_legacy_id' => 10, 'created_at' => '2024-02-01 00:00:00'],
            ['student_legacy_id' => 100, 'teacher_legacy_id' => 11, 'created_at' => '2025-06-01 00:00:00'],
            ['student_legacy_id' => 101, 'teacher_legacy_id' => 10, 'created_at' => '2024-03-01 00:00:00'],
        ],
        'schedules' => [
            [
                'series_id' => 'live-1', 'student_legacy_id' => 100, 'teacher_legacy_id' => 11,
                'lesson_name' => 'قرآن', 'first_date' => '2026-05-24', 'last_date' => '2029-12-30',
                'occurrences' => 2, 'is_live' => true,
                'slots' => [
                    ['weekday' => 1, 'start_time' => '17:00:00', 'end_time' => '18:00:00', 'duration_minutes' => 60, 'crosses_midnight' => false, 'occurrences' => 1, 'first_date' => '2026-05-25', 'last_date' => '2029-12-30'],
                    // 22:30 → 00:00 next day: the old app stored bare times, so the wrap is recovered.
                    ['weekday' => 3, 'start_time' => '22:30:00', 'end_time' => '00:00:00', 'duration_minutes' => 90, 'crosses_midnight' => true, 'occurrences' => 1, 'first_date' => '2026-05-27', 'last_date' => '2029-12-30'],
                    // 23:50 → 12:00 reads as 12h10m. A typo in the old data, not a lesson.
                    ['weekday' => 5, 'start_time' => '23:50:00', 'end_time' => '12:00:00', 'duration_minutes' => 730, 'crosses_midnight' => true, 'occurrences' => 1, 'first_date' => '2026-05-29', 'last_date' => '2029-12-30'],
                ],
            ],
            [
                'series_id' => 'dead-1', 'student_legacy_id' => 101, 'teacher_legacy_id' => 10,
                'lesson_name' => 'قرآن', 'first_date' => '2025-01-01', 'last_date' => '2025-06-30',
                'occurrences' => 1, 'is_live' => false,
                'slots' => [
                    ['weekday' => 2, 'start_time' => '10:00:00', 'end_time' => '11:00:00', 'duration_minutes' => 60, 'crosses_midnight' => false, 'occurrences' => 1, 'first_date' => '2025-01-07', 'last_date' => '2025-06-30'],
                ],
            ],
        ],
        'lessons' => [
            ['legacy_id' => 900, 'student_legacy_id' => 100, 'teacher_legacy_id' => 10, 'date' => '2024-02-02', 'hours' => 1.0, 'name' => 'قرآن', 'course_name' => null],
            ['legacy_id' => 901, 'student_legacy_id' => 101, 'teacher_legacy_id' => 10, 'date' => '2024-03-02', 'hours' => 0.5, 'name' => 'قرآن', 'course_name' => null],
        ],
        'warnings' => [],
    ];
}

function runImport(string $file, string $academy, array $extra = []): void
{
    test()->artisan('legacy:import', array_merge([
        'file' => $file,
        '--academy' => $academy,
    ], $extra))->assertSuccessful()->run();
}

it('lands the people, and puts siblings under one guardian', function () {
    runImport($this->exportFile, $this->academy);

    $this->asAcademy($this->academy);

    expect(DB::table('teachers')->count())->toBe(2);
    // The old app never stored a teacher rate, so they arrive at zero and are reported, never guessed.
    expect(DB::table('teachers')->where('session_rate_minor', 0)->count())->toBe(2);
    // Bare digits carrying their own country code get the '+' restored.
    expect(DB::table('teachers')->where('full_name', 'أستاذ أول')->value('phone'))->toBe('+201001234567');

    // Two students on one number is one family; the student with no number at all is left out
    // rather than given an invented one, because that number is where invoices are sent.
    expect(DB::table('guardians')->count())->toBe(1);
    expect(DB::table('students')->count())->toBe(2);
    expect(DB::table('students')->where('full_name', 'بلا رقم')->exists())->toBeFalse();

    $guardian = DB::table('guardians')->first();
    expect($guardian->whatsapp_phone)->toBe('+447000000001');
    expect($guardian->currency)->toBe('GBP');
    expect(DB::table('students')->where('guardian_id', $guardian->id)->count())->toBe(2);
});

it('carries each student\'s old hourly rate across as PER_HOUR', function () {
    runImport($this->exportFile, $this->academy);

    $this->asAcademy($this->academy);
    $student = DB::table('students')->where('full_name', 'ابن أول')->first();
    $sub = DB::table('subscriptions')->where('student_id', $student->id)->first();

    // £5/hour in the old app bills a 90-minute lesson at £7.50 — exactly what PER_HOUR does here.
    expect($sub->price_basis)->toBe('PER_HOUR');
    expect((int) $sub->price_minor)->toBe(500);
    expect($sub->currency)->toBe('GBP');
    expect($sub->status)->toBe('ACTIVE');
    // Priced from the day they actually started, not the day we imported them.
    expect(Carbon::parse($sub->start_date)->toDateString())->toBe('2024-02-02');
});

it('believes the live timetable over the old join table about who teaches a student', function () {
    runImport($this->exportFile, $this->academy);

    $this->asAcademy($this->academy);
    $student = DB::table('students')->where('full_name', 'ابن أول')->first();
    $second = DB::table('teachers')->where('full_name', 'أستاذ ثانٍ')->first();
    $first = DB::table('teachers')->where('full_name', 'أستاذ أول')->first();

    $active = DB::table('student_teacher_assignments')
        ->where('student_id', $student->id)->whereNull('ended_at')->first();
    expect($active->teacher_id)->toBe($second->id);

    // The teacher they used to have is kept, closed, so the history page is not blank.
    $past = DB::table('student_teacher_assignments')
        ->where('student_id', $student->id)->whereNotNull('ended_at')->get();
    expect($past)->toHaveCount(1);
    expect($past->first()->teacher_id)->toBe($first->id);

    // A student with no live series falls back to the last row in the join table.
    $sibling = DB::table('students')->where('full_name', 'ابن ثانٍ')->first();
    expect(DB::table('student_teacher_assignments')
        ->where('student_id', $sibling->id)->whereNull('ended_at')->value('teacher_id'))->toBe($first->id);
});

it('collapses the pre-generated occurrences back into a weekly rule', function () {
    runImport($this->exportFile, $this->academy);

    $this->asAcademy($this->academy);
    $student = DB::table('students')->where('full_name', 'ابن أول')->first();
    $schedule = DB::table('schedules')->where('student_id', $student->id)->first();

    expect($schedule)->not->toBeNull();
    expect($schedule->timezone)->toBe('Africa/Cairo');
    expect($schedule->is_active)->toBeTrue();

    $slots = DB::table('schedule_slots')->where('schedule_id', $schedule->id)->orderBy('weekday')->get();
    expect($slots)->toHaveCount(3);
    expect((int) $slots[0]->weekday)->toBe(1);
    expect(substr((string) $slots[0]->start_time_local, 0, 5))->toBe('17:00');
    expect((int) $slots[0]->duration_minutes)->toBe(60);
    // Through midnight: 22:30 → 00:00 is an hour and a half, not minus twenty-two hours.
    expect((int) $slots[1]->duration_minutes)->toBe(90);
    // Twelve hours is a typo in the old data; it comes in as an ordinary hour and is reported.
    expect((int) $slots[2]->duration_minutes)->toBe(60);

    // A series that ran out last year is history, not an appointment.
    $sibling = DB::table('students')->where('full_name', 'ابن ثانٍ')->first();
    expect(DB::table('schedules')->where('student_id', $sibling->id)->exists())->toBeFalse();
});

it('starts the imported timetable today, so no lesson is invented behind us', function () {
    runImport($this->exportFile, $this->academy);

    $this->asAcademy($this->academy);
    $schedule = DB::table('schedules')->first();
    expect(Carbon::parse($schedule->start_date)->toDateString())->toBe('2026-09-18');

    // The generator ran, and every lesson it made is ahead of the import — the old system owns
    // the history, and back-dating would make it markable and billable a second time here.
    $sessions = DB::table('sessions')->get();
    expect($sessions->count())->toBeGreaterThan(0);
    expect($sessions->every(fn ($s) => Carbon::parse($s->scheduled_at_utc)->greaterThanOrEqualTo(Carbon::parse('2026-09-18 09:00:00'))))->toBeTrue();
});

it('imports the client once, however many times it is run', function () {
    runImport($this->exportFile, $this->academy);

    $this->asAcademy($this->academy);
    $before = [
        'teachers' => DB::table('teachers')->count(),
        'guardians' => DB::table('guardians')->count(),
        'students' => DB::table('students')->count(),
        'subscriptions' => DB::table('subscriptions')->count(),
        'schedules' => DB::table('schedules')->count(),
        'slots' => DB::table('schedule_slots')->count(),
        'assignments' => DB::table('student_teacher_assignments')->count(),
    ];

    runImport($this->exportFile, $this->academy);

    $this->asAcademy($this->academy);
    expect([
        'teachers' => DB::table('teachers')->count(),
        'guardians' => DB::table('guardians')->count(),
        'students' => DB::table('students')->count(),
        'subscriptions' => DB::table('subscriptions')->count(),
        'schedules' => DB::table('schedules')->count(),
        'slots' => DB::table('schedule_slots')->count(),
        'assignments' => DB::table('student_teacher_assignments')->count(),
    ])->toBe($before);
});

it('keeps nothing from a dry run', function () {
    runImport($this->exportFile, $this->academy, ['--dry-run' => true]);

    $this->asAcademy($this->academy);
    expect(DB::table('teachers')->count())->toBe(0);
    expect(DB::table('students')->count())->toBe(0);
    expect(DB::table('schedules')->count())->toBe(0);
    expect(DB::table('legacy_import_map')->count())->toBe(0);
});

it('includes a student with no number when given one to fall back on', function () {
    runImport($this->exportFile, $this->academy, ['--fallback-phone' => '+201555000111']);

    $this->asAcademy($this->academy);
    expect(DB::table('students')->count())->toBe(3);
    expect(DB::table('students')->where('full_name', 'بلا رقم')->value('whatsapp_phone'))->toBe('+201555000111');
});
