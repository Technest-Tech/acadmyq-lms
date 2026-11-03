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
 * lingo, 2026-11-03: a subscription deleted from the dues was still in the bills, reading "due" with a
 * raw status key; and a family buying more lessons with the same teacher was told to close what it had.
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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-cbt@test.local', 'full_name' => 'Nour Office']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Sama']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);

    $this->student = function (string $name): string {
        $id = $this->createStudent($this->academy, $this->guardian, ['full_name' => $name]);
        $this->asAcademy($this->academy);
        DB::table('subscriptions')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $id,
            'plan_label' => 'Hours package', 'price_minor' => 16500, 'currency' => 'EGP',
            'price_basis' => 'PER_PACKAGE', 'sessions_per_month' => null, 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
        ]);

        return $id;
    };

    /** 4 × 60-minute lessons at 200 EGP each. */
    $this->block = function (string $student, bool $autoRenew = false, ?int $lessonMinutes = 60): array {
        $this->asAcademy($this->academy);

        return app(LessonPackages::class)->open([
            'student_id' => $student, 'label' => 'Private English', 'minutes_total' => 240, 'lesson_minutes' => $lessonMinutes,
            'price_minor' => 80000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => $autoRenew,
        ], (string) $this->owner->id, 'ACADEMY_OWNER');
    };

    $this->pay = function (string $invoiceId, int $amount): void {
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/receipts', [
            'guardian_id' => $this->guardian, 'amount_minor' => $amount, 'currency' => 'EGP', 'method' => 'CASH',
            'received_on' => '2026-06-01', 'invoice_id' => $invoiceId,
        ])->assertCreated();
    };

    /** A package student's lesson of `$minutes`, marked attended through the API. */
    $this->attend = function (string $student, int $minutes, string $at): string {
        $session = $this->createSession($this->academy, $student, $this->teacher, [
            'scheduled_at_utc' => $at, 'duration_minutes' => $minutes, 'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return (string) $session;
    };

    $this->billIds = function (string $query = ''): array {
        Sanctum::actingAs($this->owner);

        return collect($this->getJson('/api/invoices'.$query)->assertOk()->json('rows'))->pluck('id')->all();
    };

    $this->invoice = function (string $id): object {
        $this->asAcademy($this->academy);

        return DB::table('invoices')->where('id', $id)->first();
    };

    $this->package = function (string $id): object {
        $this->asAcademy($this->academy);

        return DB::table('lesson_packages')->where('id', $id)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

function cbtCentreOn(string $academyId, array $features = ['centre', 'accounting']): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], $features);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

it('takes a deleted subscription\'s bill off a centre\'s list and counts, and keeps it under the voided filter', function () {
    cbtCentreOn($this->academy);
    $kept = ($this->block)(($this->student)('Linda'));
    $gone = ($this->block)(($this->student)('Hana'));
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$gone['package_id']}/cancel", [])->assertOk();

    expect(($this->invoice)($gone['invoice_id'])->status)->toBe('VOID');
    expect(($this->billIds)())->toBe([$kept['invoice_id']]);
    expect(($this->billIds)('?filter[status]=OPEN'))->toBe([$kept['invoice_id']]);
    expect(($this->billIds)('?filter[status]=VOID'))->toBe([$gone['invoice_id']]);

    Sanctum::actingAs($this->owner);
    $summary = $this->getJson('/api/invoices/summary')->assertOk();
    expect($summary->json('counts.all'))->toBe(1);
    expect($summary->json('money.0.billed_minor'))->toBe(80000);
    expect($summary->json('money.0.due_minor'))->toBe(80000);
});

it('drops a centre\'s bill once all its charges were let go, and keeps a paid one', function () {
    cbtCentreOn($this->academy);
    $letGo = ($this->block)(($this->student)('Linda'));
    $paid = ($this->block)(($this->student)('Hana'));
    ($this->pay)($paid['invoice_id'], 80000);

    $this->asAcademy($this->academy);
    DB::table('invoice_line_items')->where('invoice_id', $letGo['invoice_id'])->update(['amount_minor' => 0, 'cancelled_minor' => 80000, 'cancelled_at' => now()]);
    DB::table('invoices')->where('id', $letGo['invoice_id'])->update(['subtotal_minor' => 0, 'total_minor' => 0]);

    expect(($this->billIds)())->toBe([$paid['invoice_id']]);
});

it('leaves the bill list of an academy that is not a centre as it was', function () {
    $kept = ($this->block)(($this->student)('Linda'), false, null);
    $gone = ($this->block)(($this->student)('Hana'), false, null);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$gone['package_id']}/cancel", [])->assertOk();

    expect(($this->billIds)())->toEqualCanonicalizing([$kept['invoice_id'], $gone['invoice_id']]);
    Sanctum::actingAs($this->owner);
    expect($this->getJson('/api/invoices/summary')->assertOk()->json('counts.all'))->toBe(2);
});

it('adds lessons to a paid block: the receipts stay and only the difference is due', function () {
    cbtCentreOn($this->academy);
    $block = ($this->block)(($this->student)('Janna'));
    ($this->pay)($block['invoice_id'], 80000);

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/packages/{$block['package_id']}/top-up", ['lessons' => 2, 'lesson_price_minor' => 25000])->assertOk();

    expect($res->json('lessons_added'))->toBe(2);
    expect($res->json('lessons_total'))->toBe(6);
    expect($res->json('added_minor'))->toBe(50000);
    expect($res->json('due_minor'))->toBe(50000);

    $package = ($this->package)($block['package_id']);
    expect((int) $package->minutes_total)->toBe(360);
    expect((int) $package->price_minor)->toBe(130000);
    expect((string) $package->status)->toBe('ACTIVE');

    $bill = ($this->invoice)($block['invoice_id']);
    expect((int) $bill->total_minor)->toBe(130000);
    expect((int) $bill->amount_paid_minor)->toBe(80000);

    Sanctum::actingAs($this->owner);
    $due = collect($this->getJson('/api/packages?scope=due')->assertOk()->json('packages'))->firstWhere('id', $block['package_id']);
    expect($due['outstanding_minor'])->toBe(50000);
    expect($due['minutes_remaining'])->toBe(360);
});

it('renews a topped-up block at the size it was sold, not with the added lessons', function () {
    cbtCentreOn($this->academy);
    $block = ($this->block)(($this->student)('Janna'), true);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$block['package_id']}/top-up", ['lessons' => 4, 'lesson_price_minor' => 20000])->assertOk();

    $package = ($this->package)($block['package_id']);
    expect((int) $package->minutes_total)->toBe(480);
    $next = json_decode((string) $package->next_terms, true);
    expect($next['minutes_total'])->toBe(240);
    expect($next['price_minor'])->toBe(80000);
});

it('keeps terms already parked for the renewal through a top-up', function () {
    cbtCentreOn($this->academy);
    $block = ($this->block)(($this->student)('Janna'), true);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$block['package_id']}", ['label' => 'Level 2', 'hours' => 8, 'price_minor' => 160000, 'applies_to' => 'NEXT'])->assertOk();
    $this->postJson("/api/packages/{$block['package_id']}/top-up", ['lessons' => 1, 'lesson_price_minor' => 20000])->assertOk();

    $next = json_decode((string) ($this->package)($block['package_id'])->next_terms, true);
    expect($next['label'])->toBe('Level 2');
    expect($next['minutes_total'])->toBe(480);
    expect($next['price_minor'])->toBe(160000);
});

it('refuses a top-up outside a running centre block, and for someone who cannot manage packages', function () {
    $student = ($this->student)('Janna');
    $block = ($this->block)($student);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$block['package_id']}/top-up", ['lessons' => 1, 'lesson_price_minor' => 20000])->assertStatus(422);

    cbtCentreOn($this->academy);
    $this->postJson("/api/packages/{$block['package_id']}/top-up", ['lessons' => 0, 'lesson_price_minor' => 20000])->assertStatus(422);

    $hours = ($this->block)(($this->student)('Hana'), false, null);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$hours['package_id']}/top-up", ['lessons' => 1, 'lesson_price_minor' => 20000])->assertStatus(422);

    $this->postJson("/api/packages/{$block['package_id']}/close", ['reason' => 'done'])->assertOk();
    $this->postJson("/api/packages/{$block['package_id']}/top-up", ['lessons' => 1, 'lesson_price_minor' => 20000])->assertStatus(422);

    $other = ($this->block)(($this->student)('Sara'));
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-cbt@test.local']);
    Sanctum::actingAs($teacherUser);
    $this->postJson("/api/packages/{$other['package_id']}/top-up", ['lessons' => 1, 'lesson_price_minor' => 20000])->assertForbidden();
});

// ── A lesson is one lesson ──────────────────────────────────────────────────────────────────────

it('counts each lesson on a centre block as one lesson, whatever its length, and the block ends on its last', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $block = ($this->block)($student); // 4 × 60

    ($this->attend)($student, 40, '2026-06-02 10:00:00+00');
    ($this->attend)($student, 90, '2026-06-03 10:00:00+00');
    ($this->attend)($student, 120, '2026-06-04 10:00:00+00');

    $package = ($this->package)($block['package_id']);
    expect((int) $package->minutes_consumed)->toBe(180);
    expect((int) $package->minutes_overdrawn)->toBe(0);
    expect((string) $package->status)->toBe('ACTIVE');

    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson('/api/packages?scope=open')->assertOk()->json('packages'))->firstWhere('id', $block['package_id']);
    expect($row['lesson_count'])->toBe(3);
    expect($row['minutes_remaining'])->toBe(60);

    ($this->attend)($student, 40, '2026-06-05 10:00:00+00');
    $package = ($this->package)($block['package_id']);
    expect((string) $package->status)->toBe('COMPLETED');
    expect((string) $package->closed_reason)->toBe('EXHAUSTED');
    expect((int) $package->minutes_consumed)->toBe(240);
    expect((int) $package->minutes_overdrawn)->toBe(0);
});

it('keeps counting minutes for an academy that is not a centre, even with a length on the block', function () {
    $student = ($this->student)('Malika');
    $block = ($this->block)($student);

    ($this->attend)($student, 40, '2026-06-02 10:00:00+00');

    expect((int) ($this->package)($block['package_id'])->minutes_consumed)->toBe(40);
});

it('leaves the session and the teacher\'s pay on the lesson\'s real length', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $block = ($this->block)($student);
    $this->asAcademy($this->academy);
    DB::table('teachers')->where('id', $this->teacher)->update(['session_rate_minor' => 6000]); // 6000 an hour

    $session = ($this->attend)($student, 40, '2026-06-02 10:00:00+00');

    $this->asAcademy($this->academy);
    expect((int) DB::table('sessions')->where('id', $session)->value('duration_minutes'))->toBe(40);
    expect((int) DB::table('lesson_package_credits')->where('session_id', $session)->value('minutes'))->toBe(60);
    expect((int) DB::table('payout_line_items')->where('session_id', $session)->value('amount_minor'))->toBe(4000);
    expect(DB::table('lesson_package_credits')->where('session_id', $session)->value('description'))->toContain('40');
    expect((int) ($this->package)($block['package_id'])->minutes_consumed)->toBe(60);
});

it('gives back exactly one lesson on undo, and reopens the block it finished', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $this->asAcademy($this->academy);
    $block = app(LessonPackages::class)->open([
        'student_id' => $student, 'label' => 'One', 'minutes_total' => 60, 'lesson_minutes' => 60,
        'price_minor' => 20000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER');

    $session = ($this->attend)($student, 40, '2026-06-02 10:00:00+00');
    expect((string) ($this->package)($block['package_id'])->status)->toBe('COMPLETED');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance/revert", ['reason' => 'wrong'])->assertSuccessful();

    $package = ($this->package)($block['package_id']);
    expect((string) $package->status)->toBe('ACTIVE');
    expect((int) $package->minutes_consumed)->toBe(0);
});

it('never makes a stray remainder a free lesson or an overdraft', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $this->asAcademy($this->academy);
    $block = app(LessonPackages::class)->open([
        'student_id' => $student, 'label' => 'Odd', 'minutes_total' => 200, 'lesson_minutes' => 60,
        'price_minor' => 60000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER');

    ($this->attend)($student, 60, '2026-06-02 10:00:00+00');
    ($this->attend)($student, 60, '2026-06-03 10:00:00+00');
    ($this->attend)($student, 60, '2026-06-04 10:00:00+00');

    $package = ($this->package)($block['package_id']);
    expect((string) $package->status)->toBe('COMPLETED');
    expect((int) $package->minutes_consumed)->toBe(200);
    expect((int) $package->minutes_overdrawn)->toBe(0);
});

it('moves the teacher\'s pay but not the block when a lesson\'s length is corrected', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $block = ($this->block)($student);
    $session = ($this->attend)($student, 40, '2026-06-02 10:00:00+00');

    $this->asAcademy($this->academy);
    $credit = DB::table('lesson_package_credits')->where('session_id', $session)->value('id');
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$block['package_id']}/lessons/{$credit}", ['duration_minutes' => 120])->assertOk();

    $this->asAcademy($this->academy);
    expect((int) DB::table('sessions')->where('id', $session)->value('duration_minutes'))->toBe(120);
    expect((int) DB::table('lesson_package_credits')->where('session_id', $session)->value('minutes'))->toBe(60);
    expect((int) ($this->package)($block['package_id'])->minutes_consumed)->toBe(60);
});

it('keeps the lessons taught when a running block\'s length is edited, and refuses to sell below them', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $block = ($this->block)($student); // 4 × 60
    ($this->attend)($student, 60, '2026-06-02 10:00:00+00');
    ($this->attend)($student, 60, '2026-06-03 10:00:00+00');

    Sanctum::actingAs($this->owner);
    // Same 4 lessons, really of 40.
    $this->patchJson("/api/packages/{$block['package_id']}", ['hours' => round(160 / 60, 4), 'lesson_minutes' => 40])->assertOk();

    $package = ($this->package)($block['package_id']);
    expect((int) $package->minutes_total)->toBe(160);
    expect((int) $package->minutes_consumed)->toBe(80);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$block['package_id']}", ['hours' => 1, 'lesson_minutes' => 30])->assertStatus(422);
});

it('recounts a running block in the repair command, only with --apply, and leaves finished ones', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Yusuf');
    $block = ($this->block)($student); // 4 × 60
    ($this->attend)($student, 60, '2026-06-02 10:00:00+00');
    $done = ($this->block)(($this->student)('Hana'));

    // As they were before the rule: lessons counted by their minutes.
    $this->asAcademy($this->academy);
    DB::table('lesson_package_credits')->where('package_id', $block['package_id'])->update(['minutes' => 90]);
    DB::table('lesson_packages')->where('id', $block['package_id'])->update(['minutes_consumed' => 90]);
    DB::table('lesson_packages')->where('id', $done['package_id'])->update(['status' => 'COMPLETED', 'closed_at' => now(), 'closed_reason' => 'MANUAL', 'minutes_consumed' => 100]);
    $this->clearTenantContext();

    $this->artisan('packages:count-by-lesson', ['--academy' => $this->academy])->assertSuccessful();
    expect((int) ($this->package)($block['package_id'])->minutes_consumed)->toBe(90);
    $this->clearTenantContext();

    $this->artisan('packages:count-by-lesson', ['--academy' => $this->academy, '--apply' => true])->assertSuccessful();
    expect((int) ($this->package)($block['package_id'])->minutes_consumed)->toBe(60);
    expect((int) ($this->package)($done['package_id'])->minutes_consumed)->toBe(100);
});

it('corrects a finished block\'s length: same minutes and money, the count and bill line follow', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $block = ($this->block)($student); // 4 × 60 = 240, 800 EGP
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->where('id', $block['package_id'])->update(['status' => 'COMPLETED', 'closed_at' => now(), 'closed_reason' => 'EXHAUSTED', 'minutes_consumed' => 240]);
    $this->clearTenantContext();

    $this->artisan('packages:count-by-lesson', ['--academy' => $this->academy, '--length' => $block['package_id'].':40'])->assertSuccessful();
    expect((int) ($this->package)($block['package_id'])->lesson_minutes)->toBe(60);
    $this->clearTenantContext();

    $this->artisan('packages:count-by-lesson', ['--academy' => $this->academy, '--length' => $block['package_id'].':40', '--apply' => true])->assertSuccessful();

    $package = ($this->package)($block['package_id']);
    expect((int) $package->lesson_minutes)->toBe(40);
    expect((int) $package->minutes_total)->toBe(240);
    expect((int) $package->price_minor)->toBe(80000);
    expect((string) DB::table('invoice_line_items')->where('invoice_id', $block['invoice_id'])->value('description'))->toContain('6 حصص');
    expect((int) ($this->invoice)($block['invoice_id'])->total_minor)->toBe(80000);
});

it('tells a centre\'s form how long each subject\'s lessons really are', function () {
    cbtCentreOn($this->academy);
    $student = ($this->student)('Malika');
    $this->asAcademy($this->academy);
    $schedule = $this->createSchedule($this->academy, $student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 40);
    $this->addSlot($this->academy, $schedule, 3, '17:00:00', 40);
    DB::table('student_teacher_assignments')->insert([
        'academy_id' => $this->academy, 'student_id' => $student, 'teacher_id' => $this->teacher, 'course' => 'English', 'started_at' => '2026-06-01',
    ]);

    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson('/api/packages/students')->assertOk()->json('students'))->firstWhere('id', $student);

    expect($row['lesson_minutes'])->toBe(40);
    expect($row['subjects'][0]['lesson_minutes'])->toBe(40);
});

it('tells an academy that is not a centre nothing about lesson lengths', function () {
    $student = ($this->student)('Malika');
    $this->asAcademy($this->academy);
    $schedule = $this->createSchedule($this->academy, $student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 1, '17:00:00', 40);

    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson('/api/packages/students')->assertOk()->json('students'))->firstWhere('id', $student);

    expect($row['lesson_minutes'])->toBeNull();
});
