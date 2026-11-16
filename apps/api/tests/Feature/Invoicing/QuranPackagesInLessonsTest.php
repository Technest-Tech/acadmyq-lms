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
 * A Quran academy's packages counted in lessons (`packages_in_lessons`, 2026-11-15): blocks left
 * open on a few stray minutes, and blocks a mistyped length closed early. With the switch on a
 * lesson takes one lesson off the block whatever its length — or two, when the office marks it a
 * double lesson — and the running blocks are converted by `packages:count-in-lessons`.
 * Without the switch nothing changes.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-qpl@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-qpl@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id, 'full_name' => 'Ustadha']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Yusuf']);
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->student,
        'plan_label' => 'Package', 'price_minor' => 10000, 'currency' => 'EGP',
        'price_basis' => 'PER_PACKAGE', 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);
    $this->clearTenantContext();

    $this->open = function (array $terms): string {
        $this->asAcademy($this->academy);
        $id = app(LessonPackages::class)->open($terms + [
            'student_id' => $this->student, 'label' => 'Package', 'price_minor' => 40000, 'currency' => 'EGP',
            'starts_on' => '2026-06-01', 'auto_renew' => false,
        ], (string) $this->owner->id, 'ACADEMY_OWNER')['package_id'];
        $this->clearTenantContext();

        return $id;
    };
    /** Record a lesson of `$minutes` attended; returns the session id. */
    $this->attend = function (int $minutes, string $at, array $extra = []): string {
        $session = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => $at, 'duration_minutes' => $minutes, 'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'] + $extra)->assertOk();

        return $session;
    };
    $this->package = function (string $id): object {
        $this->asAcademy($this->academy);
        $row = DB::table('lesson_packages')->where('id', $id)->first();
        $this->clearTenantContext();

        return $row;
    };
    $this->switchOn = function (array $also = []): void {
        DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['packages_in_lessons', ...$also]);
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    };
});

afterEach(fn () => Carbon::setTestNow());

it('keeps counting minutes for an academy that did not switch it on', function () {
    $id = ($this->open)(['minutes_total' => 120, 'lesson_minutes' => 30]);

    ($this->attend)(45, '2026-06-02 15:00:00+00');

    expect((int) ($this->package)($id)->minutes_consumed)->toBe(45);
    $lesson = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-06-03 15:00:00+00', 'status' => 'SCHEDULED']);
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/sessions/{$lesson}")->assertOk()->assertJsonPath('session.counts_in_lessons', false);
});

it('takes one lesson off the block whatever the lesson ran, and ends on the last one', function () {
    ($this->switchOn)();
    $id = ($this->open)(['minutes_total' => 120, 'lesson_minutes' => 30]);

    ($this->attend)(45, '2026-06-02 15:00:00+00');
    ($this->attend)(25, '2026-06-03 15:00:00+00');
    expect((int) ($this->package)($id)->minutes_consumed)->toBe(60)
        ->and(($this->package)($id)->status)->toBe('ACTIVE');

    ($this->attend)(60, '2026-06-04 15:00:00+00');
    ($this->attend)(30, '2026-06-05 15:00:00+00');
    $row = ($this->package)($id);
    expect($row->status)->toBe('COMPLETED')
        ->and((int) $row->minutes_consumed)->toBe(120)
        ->and((int) $row->minutes_overdrawn)->toBe(0);
});

it('counts a double lesson as two, when the office marks it so — and only then', function () {
    ($this->switchOn)();
    $id = ($this->open)(['minutes_total' => 120, 'lesson_minutes' => 30]);

    $double = ($this->attend)(60, '2026-06-02 15:00:00+00', ['package_lessons' => 2]);
    expect((int) ($this->package)($id)->minutes_consumed)->toBe(60);
    // The popup reads it back, and knows the block counts lessons.
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/sessions/{$double}")->assertOk()
        ->assertJsonPath('session.package_lessons', 2)->assertJsonPath('session.counts_in_lessons', true);

    // Already counted: undo it first rather than re-cut the books under it.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$double}/attendance", ['status' => 'ATTENDED', 'package_lessons' => 1])
        ->assertUnprocessable()->assertJsonValidationErrors(['package_lessons']);

    // A teacher records lessons, but does not decide what the family's block counts.
    $lesson = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-03 15:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/sessions/{$lesson}/attendance", ['status' => 'ATTENDED', 'package_lessons' => 2])
        ->assertUnprocessable()->assertJsonValidationErrors(['package_lessons']);
    expect((int) ($this->package)($id)->minutes_consumed)->toBe(60);

    // Two left, a double lesson takes both and ends the block exactly.
    ($this->attend)(60, '2026-06-04 15:00:00+00', ['package_lessons' => 2]);
    $row = ($this->package)($id);
    expect($row->status)->toBe('COMPLETED')->and((int) $row->minutes_overdrawn)->toBe(0);
});

it('renews a block still sold in hours as a block in lessons, at the timetable\'s length', function () {
    ($this->switchOn)();
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 30);
    $this->clearTenantContext();
    $id = ($this->open)(['minutes_total' => 60, 'auto_renew' => true]);

    ($this->attend)(30, '2026-06-02 15:00:00+00');
    ($this->attend)(30, '2026-06-03 15:00:00+00');

    expect(($this->package)($id)->status)->toBe('COMPLETED');
    $this->asAcademy($this->academy);
    $next = DB::table('lesson_packages')->where('student_id', $this->student)->where('status', 'ACTIVE')->first();
    expect($next)->not->toBeNull()->and((int) $next->lesson_minutes)->toBe(30);
});

it('lists the running blocks first, then converts them: stray minutes close it, a long length gives lessons back', function () {
    // Built the old way, in minutes, before the switch.
    $stuck = ($this->open)(['minutes_total' => 360, 'label' => '12 × 30', 'auto_renew' => true]);
    foreach (range(1, 3) as $d) {
        ($this->attend)(25, sprintf('2026-05-%02d 15:00:00+00', $d));
    }
    foreach (range(4, 12) as $d) {
        ($this->attend)(30, sprintf('2026-05-%02d 15:00:00+00', $d));
    }
    expect((int) ($this->package)($stuck)->minutes_consumed)->toBe(345)
        ->and(($this->package)($stuck)->status)->toBe('ACTIVE');

    // Dry run: listed, nothing written; writing needs the switch.
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy])
        ->expectsOutputToContain('Yusuf · 12 × 30: lessons of 30 min · 12 sold · 12 taken · was 345/360 min used → FINISHES (renews')
        ->assertSuccessful();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--apply' => true])->assertFailed();
    expect((int) ($this->package)($stuck)->minutes_consumed)->toBe(345);

    ($this->switchOn)();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('Converted 1 packages to lessons.')
        ->assertSuccessful();

    $row = ($this->package)($stuck);
    expect($row->status)->toBe('COMPLETED')
        ->and((int) $row->lesson_minutes)->toBe(30)
        ->and((int) $row->minutes_consumed)->toBe(360)
        ->and((int) $row->minutes_overdrawn)->toBe(0);
    $this->asAcademy($this->academy);
    $renewed = DB::table('lesson_packages')->where('student_id', $this->student)->where('status', 'ACTIVE')->first();
    expect((int) $renewed->lesson_minutes)->toBe(30)
        ->and(DB::table('audit_log')->where('action', 'lesson_package.counted_in_lessons')->where('entity_id', $stuck)->exists())->toBeTrue();
});

it('gives back the lessons a mistyped length ate', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 30);
    $this->clearTenantContext();
    $id = ($this->open)(['minutes_total' => 240]);
    ($this->attend)(60, '2026-06-02 15:00:00+00');   // entered as 60, really one 30-minute lesson
    ($this->attend)(60, '2026-06-03 15:00:00+00');
    expect((int) ($this->package)($id)->minutes_consumed)->toBe(120);

    ($this->switchOn)();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('stays open, 6 lessons left')
        ->assertSuccessful();

    $row = ($this->package)($id);
    expect($row->status)->toBe('ACTIVE')
        ->and((int) $row->lesson_minutes)->toBe(30)
        ->and((int) $row->minutes_consumed)->toBe(60);
    $this->asAcademy($this->academy);
    expect(DB::table('lesson_package_credits')->where('package_id', $id)->pluck('minutes')->map(fn ($m) => (int) $m)->all())->toBe([30, 30]);
});

it('leaves a block with no length to go on in hours', function () {
    $id = ($this->open)(['minutes_total' => 240]);
    ($this->switchOn)();

    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('no lesson length to go on')
        ->assertSuccessful();

    expect(($this->package)($id)->lesson_minutes)->toBeNull();
});

it('reads an Arabic "N × M" label, counts the student\'s cancellations, and maps a mistyped length', function () {
    // Alrayan, 2026-11-17: "8 × 45 د — أكتوبر" was never read (byte-wise digit swap), lessons really
    // run 40, and a lesson the student cancels is a lesson taken.
    $id = ($this->open)(['minutes_total' => 360, 'label' => '8 × 45 د — أكتوبر 2026', 'starts_on' => '2026-06-01', 'auto_renew' => true]);
    foreach ([2, 3, 5, 8, 9] as $d) {
        ($this->attend)(40, sprintf('2026-06-%02d 15:00:00+00', $d));
    }
    $cancelled = fn (string $at) => $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => $at, 'duration_minutes' => 40, 'status' => 'CANCELLED_BY_STUDENT', 'bill_override' => false,
    ]);
    $before = $cancelled('2026-05-20 15:00:00+00');   // before the block: not its business
    $c1 = $cancelled('2026-06-04 15:00:00+00');
    $c2 = $cancelled('2026-06-06 15:00:00+00');
    $teacherCancel = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-07 15:00:00+00', 'duration_minutes' => 40, 'status' => 'CANCELLED_BY_TEACHER', 'bill_override' => false,
    ]);

    // Without the options: the label is read now — 8 lessons of 45.
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy])
        ->expectsOutputToContain('lessons of 45 min · 8 sold · 5 taken · was 200/360 min used → stays open, 3 lessons left')
        ->assertSuccessful();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--student-cancels' => true, '--length-map' => '45:40'])
        ->expectsOutputToContain('lessons of 40 min · 8 sold · 7 taken (2 of them student cancellations) · was 200/360 min used → stays open, 1 lessons left')
        ->assertSuccessful();

    ($this->switchOn)();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--student-cancels' => true, '--length-map' => '45:40', '--apply' => true])
        ->assertSuccessful();

    $row = ($this->package)($id);
    expect($row->status)->toBe('ACTIVE')
        ->and((int) $row->lesson_minutes)->toBe(40)
        ->and((int) $row->minutes_total)->toBe(320)
        ->and((int) $row->minutes_consumed)->toBe(280)
        ->and((int) $row->hourly_rate_minor)->toBe(7500);
    $this->asAcademy($this->academy);
    $sessions = DB::table('sessions')->whereIn('id', [$before, $c1, $c2, $teacherCancel])->get()->keyBy('id');
    expect((bool) $sessions[$c1]->billed)->toBeTrue()->and((bool) $sessions[$c1]->bill_override)->toBeTrue()
        ->and((bool) $sessions[$c2]->billed)->toBeTrue()
        ->and((bool) $sessions[$before]->billed)->toBeFalse()
        ->and((bool) $sessions[$teacherCancel]->billed)->toBeFalse()
        ->and(DB::table('lesson_package_credits')->where('package_id', $id)->count())->toBe(7)
        ->and((bool) $sessions[$c1]->paid_to_teacher)->toBeFalse();
    $this->clearTenantContext();

    // The eighth lesson ends it, and it renews.
    ($this->attend)(40, '2026-06-10 15:00:00+00');
    expect(($this->package)($id)->status)->toBe('COMPLETED');
});

it('never lets stray minutes from the last block cost the family a lesson', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 40);
    $this->clearTenantContext();
    // "5.3 ساعة" = 318 minutes: eight 40-minute lessons, not seven and a stray 38.
    $id = ($this->open)(['minutes_total' => 318, 'label' => '5.3 ساعة — أكتوبر 2026']);
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->where('id', $id)->update(['absorbed_overdraft_minutes' => 20, 'minutes_consumed' => 20]);
    $this->clearTenantContext();
    ($this->attend)(40, '2026-06-02 15:00:00+00');

    ($this->switchOn)();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('8 sold · 1 taken · 20 stray min from the last block dropped')
        ->assertSuccessful();

    $row = ($this->package)($id);
    expect((int) $row->minutes_total)->toBe(320)
        ->and((int) $row->absorbed_overdraft_minutes)->toBe(0)
        ->and((int) $row->minutes_consumed)->toBe(40);
});

it('counts a student\'s cancellation as a lesson taken where the academy says so — unless the office says not to', function () {
    ($this->switchOn)(['student_cancel_charged']);
    $id = ($this->open)(['minutes_total' => 160, 'lesson_minutes' => 40]);
    $lesson = fn (string $at) => $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => $at, 'duration_minutes' => 40, 'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);

    // Nobody chose: charged.
    $this->postJson('/api/sessions/'.$lesson('2026-06-02 15:00:00+00').'/attendance', ['status' => 'CANCELLED_BY_STUDENT'])->assertOk();
    expect((int) ($this->package)($id)->minutes_consumed)->toBe(40);
    // The office said no: not charged.
    $this->postJson('/api/sessions/'.$lesson('2026-06-03 15:00:00+00').'/attendance', ['status' => 'CANCELLED_BY_STUDENT', 'charge_student' => false])->assertOk();
    // A teacher's cancellation is never charged by default.
    $this->postJson('/api/sessions/'.$lesson('2026-06-04 15:00:00+00').'/attendance', ['status' => 'CANCELLED_BY_TEACHER'])->assertOk();
    expect((int) ($this->package)($id)->minutes_consumed)->toBe(40);
});

it('leaves a student\'s cancellation uncharged where the academy did not switch it on', function () {
    ($this->switchOn)();
    $id = ($this->open)(['minutes_total' => 160, 'lesson_minutes' => 40]);
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-02 15:00:00+00', 'duration_minutes' => 40, 'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_STUDENT'])->assertOk();

    expect((int) ($this->package)($id)->minutes_consumed)->toBe(0);
});

it('retimes a mistyped lesson length: timetables, unmarked lessons and running blocks — never a marked lesson', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 45);
    $this->clearTenantContext();
    $id = ($this->open)(['minutes_total' => 360, 'label' => '8 × 45 د — أكتوبر 2026']);
    $attended = ($this->attend)(45, '2026-06-02 15:00:00+00');
    $past = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-06-05 15:00:00+00', 'duration_minutes' => 45, 'status' => 'SCHEDULED']);
    $future = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-06-20 15:00:00+00', 'duration_minutes' => 45, 'status' => 'SCHEDULED']);
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->where('student_id', $this->student)->update(['lesson_minutes' => 45]);
    $this->clearTenantContext();

    $this->artisan('lessons:retime', ['--academy' => $this->academy, '--from' => 45, '--to' => 40])
        ->expectsOutputToContain('Lessons not marked: 1 upcoming, 1 past and never marked')
        ->expectsOutputToContain('Yusuf · 8 × 45 د — أكتوبر 2026 → 8 × 40 د — أكتوبر 2026 · 8 lessons, 360 min → 320 min')
        ->assertSuccessful();
    $this->asAcademy($this->academy);
    expect((int) DB::table('sessions')->where('id', $future)->value('duration_minutes'))->toBe(45);
    $this->clearTenantContext();

    $this->artisan('lessons:retime', ['--academy' => $this->academy, '--from' => 45, '--to' => 40, '--apply' => true])->assertSuccessful();

    $this->asAcademy($this->academy);
    $durations = DB::table('sessions')->whereIn('id', [$attended, $past, $future])->pluck('duration_minutes', 'id')->map(fn ($d) => (int) $d);
    expect($durations[$attended])->toBe(45)
        ->and($durations[$past])->toBe(40)
        ->and($durations[$future])->toBe(40)
        ->and((int) DB::table('schedule_slots')->where('schedule_id', $schedule)->value('duration_minutes'))->toBe(40)
        ->and((int) DB::table('subscriptions')->where('student_id', $this->student)->value('lesson_minutes'))->toBe(40);
    $row = DB::table('lesson_packages')->where('id', $id)->first();
    expect($row->label)->toBe('8 × 40 د — أكتوبر 2026')
        ->and((int) $row->minutes_total)->toBe(320)
        ->and((int) $row->minutes_consumed)->toBe(45);
});

it('trusts a label that states a lesson count, and never charges a cancellation from an older block\'s time', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 40);
    $this->clearTenantContext();
    $cancelled = fn (string $at) => $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => $at, 'duration_minutes' => 40, 'status' => 'CANCELLED_BY_STUDENT', 'bill_override' => false,
    ]);

    // An earlier block, finished: its last lesson is 3 June.
    $old = ($this->open)(['minutes_total' => 80, 'label' => 'Old', 'starts_on' => '2026-05-25']);
    ($this->attend)(40, '2026-06-01 15:00:00+00');
    $inOldTime = $cancelled('2026-06-02 15:00:00+00');
    ($this->attend)(40, '2026-06-03 15:00:00+00');
    expect(($this->package)($old)->status)->toBe('COMPLETED');

    // "16 lessons" typed as 16 hours: the label is what was sold. One of its lessons was back-dated.
    $id = ($this->open)(['minutes_total' => 960, 'label' => 'باقه ١٦ حصة', 'starts_on' => '2026-06-04']);
    $this->asAcademy($this->academy);
    $backdated = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-05-30 15:00:00+00', 'duration_minutes' => 40, 'status' => 'SCHEDULED']);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$backdated}/attendance", ['status' => 'ATTENDED', 'override_timing' => true])->assertOk();
    ($this->attend)(40, '2026-06-05 15:00:00+00');
    $inItsTime = $cancelled('2026-06-06 15:00:00+00');

    ($this->switchOn)();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--student-cancels' => true, '--apply' => true])
        ->expectsOutputToContain('16 sold (the label says so; its minutes would hold 24)')
        ->assertSuccessful();

    $this->asAcademy($this->academy);
    $row = DB::table('lesson_packages')->where('id', $id)->first();
    $onBlock = DB::table('lesson_package_credits')->where('package_id', $id)->pluck('session_id')->all();
    expect((int) $row->minutes_total)->toBe(640)
        ->and($onBlock)->toContain($inItsTime)
        ->and($onBlock)->not->toContain($inOldTime)
        ->and((bool) DB::table('sessions')->where('id', $inOldTime)->value('billed'))->toBeFalse();
});

it('measures minutes left over from the last block against the lesson that ran over, not this block\'s length', function () {
    // The old block had 20 minutes left when a 40-minute lesson took it 20 past its end.
    $old = ($this->open)(['minutes_total' => 60, 'label' => 'Old', 'starts_on' => '2026-05-25']);
    ($this->attend)(40, '2026-06-01 15:00:00+00');
    ($this->attend)(40, '2026-06-02 15:00:00+00');
    expect(($this->package)($old)->status)->toBe('COMPLETED')->and((int) ($this->package)($old)->minutes_overdrawn)->toBe(20);

    // The next one is labelled in 30s: 20 over is half of the 40-minute lesson, not most of a 30.
    $id = ($this->open)(['minutes_total' => 240, 'label' => '8حصص × 30 د', 'starts_on' => '2026-06-03']);
    expect((int) ($this->package)($id)->absorbed_overdraft_minutes)->toBe(20);

    ($this->switchOn)();
    $this->artisan('packages:count-in-lessons', ['--academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('lessons of 30 min · 8 sold · 0 taken · 20 stray min from the last block dropped')
        ->assertSuccessful();

    $row = ($this->package)($id);
    expect((int) $row->absorbed_overdraft_minutes)->toBe(0)->and((int) $row->minutes_consumed)->toBe(0)->and((int) $row->minutes_total)->toBe(240);
});
