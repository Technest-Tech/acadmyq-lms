<?php

declare(strict_types=1);

use App\Services\Invoicing;
use App\Services\Ledger;
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

    /** A centre on receipts, with a block of 4 × 60-minute lessons at 800 EGP, paid in full. */
    $this->paidBlock = function (string $student, int $priceMinor = 80000): array {
        cplAccountsOn($this->academy);
        $this->asAcademy($this->academy);
        $opened = app(LessonPackages::class)->open([
            'student_id' => $student, 'label' => 'Private English', 'minutes_total' => 240, 'lesson_minutes' => 60,
            'price_minor' => $priceMinor, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
        ], (string) $this->owner->id, 'ACADEMY_OWNER');
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/receipts', [
            'guardian_id' => $this->guardian, 'amount_minor' => $priceMinor, 'currency' => 'EGP', 'method' => 'CASH',
            'received_on' => '2026-06-01', 'invoice_id' => $opened['invoice_id'],
        ])->assertCreated();

        return $opened;
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

it('names the upcoming lessons past a block\'s balance apart (EnglishSpirit, 2026-11-10)', function () {
    $student = ($this->packageStudent)('Doaa');
    $block = ($this->open)($student, 3);
    ($this->attend)($student, 60, '2026-06-02 10:00:00+00');

    // 120 minutes left. A lesson never splits: one that starts with any balance lands on the block,
    // so 90 + 90 are both covered (the second overdraws), the 60 after is past its end. A hidden
    // lesson is not upcoming at all.
    $this->asAcademy($this->academy);
    foreach ([['2026-06-20 15:00:00+00', 90], ['2026-06-22 15:00:00+00', 90], ['2026-06-24 15:00:00+00', 60]] as [$at, $min]) {
        $this->createSession($this->academy, $student, $this->teacher, ['scheduled_at_utc' => $at, 'duration_minutes' => $min, 'status' => 'SCHEDULED']);
    }
    $this->createSession($this->academy, $student, $this->teacher, ['scheduled_at_utc' => '2026-06-26 15:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED', 'hidden_at' => now()]);

    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson("/api/packages?student_id={$student}")->assertOk()->json('packages'))->firstWhere('id', $block);
    expect($row['minutes_remaining'])->toBe(120)
        ->and($row['upcoming_lesson_count'])->toBe(3)
        ->and($row['upcoming_in_package_count'])->toBe(2);
});

// ─── "No hours" + editing a paid subscription (lingo, 2026-11-01) ─────────────

function cplAccountsOff(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        // Receipts stay on; only the centre rule goes.
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['accounting']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function cplAccountsOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['centre', 'accounting']);
        app(Ledger::class)->ensureReady($academyId);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

it('corrects a paid subscription: the name and lessons move, what was paid stays', function () {
    $student = ($this->packageStudent)('Hassan');
    $opened = ($this->paidBlock)($student);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$opened['package_id']}", ['label' => 'Connect Plus'])->assertOk();

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $opened['invoice_id'])->first();
    expect((int) $invoice->total_minor)->toBe(80000)->and((int) $invoice->amount_paid_minor)->toBe(80000);
    expect(DB::table('invoice_line_items')->where('invoice_id', $opened['invoice_id'])->value('description'))
        ->toBe('اشتراك: Connect Plus — 4 حصص');

    // A dearer block: the difference is left to pay.
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$opened['package_id']}", ['hours' => 6, 'price_minor' => 120000])
        ->assertOk()->assertJsonPath('due_minor', 40000)->assertJsonPath('credited_minor', 0);
    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $opened['invoice_id'])->first();
    expect((int) $invoice->total_minor)->toBe(120000)->and((int) $invoice->amount_paid_minor)->toBe(80000);
    expect(DB::table('invoice_line_items')->where('invoice_id', $opened['invoice_id'])->value('description'))
        ->toBe('اشتراك: Connect Plus — 6 حصص');
});

it('gives back as credit what was paid beyond a cheaper subscription', function () {
    $student = ($this->packageStudent)('Hassan');
    $opened = ($this->paidBlock)($student);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$opened['package_id']}", ['hours' => 3, 'price_minor' => 60000])
        ->assertOk()->assertJsonPath('credited_minor', 20000)->assertJsonPath('due_minor', 0);

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $opened['invoice_id'])->first();
    expect((int) $invoice->total_minor)->toBe(60000)->and((int) $invoice->amount_paid_minor)->toBe(60000);
    $balance = app(Ledger::class)->balance($this->academy, ['guardian_id' => $this->guardian]);
    expect($balance[0]['credit_minor'])->toBe(20000);
});

it('still refuses a paid package for an academy that is not a centre', function () {
    $student = ($this->packageStudent)('Omar');
    $this->asAcademy($this->academy);
    $opened = app(LessonPackages::class)->open([
        'student_id' => $student, 'label' => 'Block', 'minutes_total' => 240,
        'price_minor' => 80000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER');
    $this->asAcademy($this->academy);
    DB::table('invoices')->where('id', $opened['invoice_id'])->update(['amount_paid_minor' => 80000]);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$opened['package_id']}", ['label' => 'Renamed'])->assertUnprocessable();
});

it('takes the last hours out of a centre\'s old blocks, labels and bills alike', function () {
    $student = ($this->packageStudent)('Hajar');
    $this->asAcademy($this->academy);
    $opened = app(LessonPackages::class)->open([
        'student_id' => $student, 'label' => '8 ساعة — أكتوبر 2026', 'minutes_total' => 480,
        'price_minor' => 80000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER');
    $typed = ($this->open)(($this->packageStudent)('Malak'), 4);
    $fill = fn (): array => (require base_path('database/migrations/2026_11_01_000001_centre_packages_no_hours.php'))->fill();

    // Not a centre: nothing moves.
    expect($fill())->toBe(['lengths' => 0, 'labels' => 0, 'lines' => 0]);

    cplCentreOn($this->academy);
    expect($fill()['labels'])->toBe(1);

    $this->asAcademy($this->academy);
    $block = DB::table('lesson_packages')->where('id', $opened['package_id'])->first();
    expect((int) $block->lesson_minutes)->toBe(60)
        ->and($block->label)->toBe('8 × 60 د — أكتوبر 2026')
        ->and((int) $block->minutes_total)->toBe(480)
        ->and(DB::table('invoice_line_items')->where('invoice_id', $opened['invoice_id'])->value('description'))
        ->toBe('اشتراك: 8 × 60 د — أكتوبر 2026 — 8 حصص');
    // A label somebody typed is theirs.
    expect(DB::table('lesson_packages')->where('id', $typed)->value('label'))->toBe('4 hours');

    expect($fill())->toBe(['lengths' => 0, 'labels' => 0, 'lines' => 0]);
});

// ─── A centre's month never closes (lingo, 2026-11-02) ───────────────────────

it('never closes a centre on receipts, and still closes everyone else', function () {
    $student = ($this->packageStudent)('Lara');
    $opened = ($this->paidBlock)($student);

    $this->asAcademy($this->academy);
    expect(app(Invoicing::class)->closePeriodInvoices($this->academy, 2026, 6, (string) $this->owner->id, 'ACADEMY_OWNER'))->toBe(0);
    expect(DB::table('invoices')->where('id', $opened['invoice_id'])->value('status'))->toBe('OPEN');

    // Off the centre rule, the month closes as it always has.
    cplAccountsOff($this->academy);
    $this->asAcademy($this->academy);
    expect(app(Invoicing::class)->closePeriodInvoices($this->academy, 2026, 6, (string) $this->owner->id, 'ACADEMY_OWNER'))->toBe(1);
    expect(DB::table('invoices')->where('id', $opened['invoice_id'])->value('status'))->not->toBe('OPEN');
});

it('takes back a month-end close: a discount, an edit and the reports reach those bills again', function () {
    $paidStudent = ($this->packageStudent)('Lara');
    $paid = ($this->paidBlock)($paidStudent);
    $this->asAcademy($this->academy);
    $unpaid = app(LessonPackages::class)->open([
        'student_id' => ($this->packageStudent)('Mohamed'), 'label' => 'Private Math', 'minutes_total' => 240, 'lesson_minutes' => 60,
        'price_minor' => 100000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
    ], (string) $this->owner->id, 'ACADEMY_OWNER');

    // What happened at 02:00 on the 2nd: closed before the rule existed.
    cplAccountsOff($this->academy);
    $this->asAcademy($this->academy);
    app(Invoicing::class)->closePeriodInvoices($this->academy, 2026, 6, (string) $this->owner->id, 'ACADEMY_OWNER');
    expect(DB::table('invoices')->where('id', $paid['invoice_id'])->value('status'))->toBe('PAID')
        ->and(DB::table('invoices')->where('id', $unpaid['invoice_id'])->value('status'))->toBe('CLOSED');

    $fill = fn (): int => (require base_path('database/migrations/2026_11_02_000001_centre_bills_stay_open.php'))->fill();
    expect($fill())->toBe(0); // not a centre: left closed

    cplAccountsOn($this->academy);
    expect($fill())->toBe(2)->and($fill())->toBe(0);

    $this->asAcademy($this->academy);
    $bill = DB::table('invoices')->where('id', $paid['invoice_id'])->first();
    expect($bill->status)->toBe('OPEN')->and($bill->closed_at)->toBeNull()
        ->and((int) $bill->total_minor)->toBe(80000)->and((int) $bill->amount_paid_minor)->toBe(80000);

    // The family's 10% now reaches the bill that was closed.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/accounting/family/{$this->guardian}/discounts", [
        'kind' => 'PERCENT', 'value' => 10, 'label' => 'Siblings', 'scope' => 'ALL', 'apply_to_existing' => true,
    ])->assertSuccessful();
    $this->asAcademy($this->academy);
    expect((int) DB::table('invoices')->where('id', $unpaid['invoice_id'])->value('total_minor'))->toBe(90000);

    // The paid subscription can be corrected again.
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$paid['package_id']}", ['label' => 'Connect Plus'])->assertOk();

    // What was received still counts (the discount freed 80 of the paid bill, and that credit paid
    // the other one), and the counts and the filter read the money on the bill.
    $this->getJson('/api/reports/profit-summary?year=2026&month=6')->assertOk()->assertJsonPath('rows.0.revenue_minor', 80000);
    $counts = $this->getJson('/api/invoices/summary?period_year=2026&period_month=6')->assertOk()->json('counts');
    expect($counts['PAID'])->toBe(1)->and($counts['PARTIALLY_PAID'])->toBe(1)->and($counts['OPEN'])->toBe(0);
    $rows = $this->getJson('/api/invoices?filter[status]=PAID')->assertOk()->json('rows');
    expect(collect($rows)->pluck('id')->all())->toBe([$paid['invoice_id']]);
});
