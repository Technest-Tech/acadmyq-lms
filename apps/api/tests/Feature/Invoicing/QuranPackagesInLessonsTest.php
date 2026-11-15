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
    $this->switchOn = function (): void {
        DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['packages_in_lessons']);
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
        ->expectsOutputToContain('Yusuf · 12 × 30: lessons of 30 min · 12 sold · 12 taught · was 345/360 min used → FINISHES (renews')
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
