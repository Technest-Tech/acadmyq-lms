<?php

declare(strict_types=1);

use App\Jobs\PrepaidMonthlyBillingJob;
use App\Jobs\SendPrepaidBillJob;
use App\Services\PrepaidMonthly;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/*
 * Settings → طريقة التحصيل (انا مسلم, 2026-11-22): "monthly, in advance" — next month billed in full
 * from the 27th, this month's not-charged lessons off that bill — next to the untouched default
 * "after the lessons". The student is 8 × 30 min at 50/hour: a lesson is 25, the month 200.
 */

/** Call one of the test case's protected helpers from a plain function. */
function ppCall($test, string $method, mixed ...$args): mixed
{
    return (fn () => $this->{$method}(...$args))->call($test);
}

function ppAt(string $when): void
{
    Carbon::setTestNow($when);
    CarbonImmutable::setTestNow($when);
}

beforeEach(function () {
    ppAt('2026-11-23 10:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-prepaid@test.local']);
    $this->teacher = $this->createTeacher($this->academy);
    $this->guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201001234567', 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);
});

afterEach(function () {
    Carbon::setTestNow();
    CarbonImmutable::setTestNow();
});

/** A REGULAR monthly student with a Saturday timetable: 8 lessons × 30 min at 50 EGP/hour. */
function ppMonthly($test, string $studentId, array $sub = []): void
{
    ppCall($test, 'asAcademy', $test->academy);
    DB::table('subscriptions')->insert(array_merge([
        'id' => (string) Str::uuid(),
        'academy_id' => $test->academy,
        'student_id' => $studentId,
        'plan_label' => '8 × 30',
        'price_minor' => 5000,
        'currency' => 'EGP',
        'price_basis' => 'PER_HOUR',
        'sessions_per_month' => 8,
        'lesson_minutes' => 30,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ], $sub));
    $schedule = ppCall($test, 'createSchedule', $test->academy, $studentId, $test->teacher);
    ppCall($test, 'addSlot', $test->academy, $schedule, 6, '17:00:00', 30);
}

/** A lesson on a Cairo date at 17:00 (15:00 UTC in winter). */
function ppLesson($test, string $studentId, string $date, string $status = 'SCHEDULED'): string
{
    return ppCall($test, 'createSession', $test->academy, $studentId, $test->teacher, [
        'scheduled_at_utc' => "{$date} 15:00:00+00",
        'duration_minutes' => 30,
        'status' => $status,
    ]);
}

function ppMark($test, string $sessionId, string $status, ?bool $charge = null): void
{
    Sanctum::actingAs($test->owner);
    $body = ['status' => $status];
    if ($charge !== null) {
        $body['charge_student'] = $charge;
    }
    $test->postJson("/api/sessions/{$sessionId}/attendance", $body)->assertOk();
}

function ppRun(): void
{
    app()->call([new PrepaidMonthlyBillingJob, 'handle']);
}

/** The guardian's AUTO bill for a month, with its lines. */
function ppBill($test, string $period, ?string $guardianId = null): ?object
{
    ppCall($test, 'asAcademy', $test->academy);
    $p = CarbonImmutable::parse($period);
    $bill = DB::table('invoices')->where('guardian_id', $guardianId ?? $test->guardian)
        ->where('kind', 'AUTO')->where('period_year', $p->year)->where('period_month', $p->month)->first();
    if ($bill !== null) {
        $bill->lines = DB::table('invoice_line_items')->where('invoice_id', $bill->id)->orderBy('created_at')->orderBy('amount_minor', 'desc')->get();
    }

    return $bill;
}

function ppSwitchOn($test): void
{
    Sanctum::actingAs($test->owner);
    $test->putJson('/api/academy/billing-mode', ['mode' => 'PREPAID_MONTHLY'])->assertOk();
}

it('leaves an academy that never chose it exactly as before', function () {
    ppMonthly($this, $this->student);
    $lesson = ppLesson($this, $this->student, '2026-11-21');
    ppMark($this, $lesson, 'ATTENDED');

    $bill = ppBill($this, '2026-11-01');
    expect((int) $bill->total_minor)->toBe(2500)
        ->and($bill->lines)->toHaveCount(1)
        ->and($bill->lines[0]->session_id)->toBe($lesson)
        ->and($bill->lines[0]->prepaid_charge)->toBeNull()
        ->and($bill->due_on)->toBeNull();

    // The daily job reads the academy and leaves it alone.
    ppAt('2026-11-27 08:00:00');
    ppRun();
    expect(ppBill($this, '2026-12-01'))->toBeNull();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/academy/billing-mode')->assertOk()
        ->assertJsonPath('settings.mode', 'AFTER_LESSONS')
        ->assertJsonPath('available', true);
});

it('bills next month in full on the 27th, adds nothing on attendance, and takes not-charged lessons off the bill after', function () {
    ppMonthly($this, $this->student);
    ppSwitchOn($this);

    $this->asAcademy($this->academy);
    $s = PrepaidMonthly::settings($this->academy);
    expect($s['from'])->toBe('2026-12-01')->and($s['first_fee'])->toBe('2026-12-01');

    // This month is still billed after its lessons, as before the switch.
    $nov = ppLesson($this, $this->student, '2026-11-21');
    ppMark($this, $nov, 'ATTENDED');
    expect((int) ppBill($this, '2026-11-01')->total_minor)->toBe(2500);

    // Before the issue day nothing goes out.
    ppAt('2026-11-26 08:00:00');
    ppRun();
    expect(ppBill($this, '2026-12-01'))->toBeNull();

    ppAt('2026-11-27 08:00:00');
    ppRun();
    $dec = ppBill($this, '2026-12-01');
    expect((int) $dec->total_minor)->toBe(20000)
        ->and($dec->lines)->toHaveCount(1)
        ->and($dec->lines[0]->prepaid_charge)->toBe('FEE')
        ->and(substr((string) $dec->lines[0]->prepaid_period, 0, 10))->toBe('2026-12-01')
        ->and($dec->lines[0]->description)->toBe('اشتراك شهر ديسمبر 2026')
        ->and($dec->lines[0]->session_id)->toBeNull()
        ->and(substr((string) $dec->due_on, 0, 10))->toBe('2026-12-05');

    // Every later morning is a no-op for a student already billed.
    ppAt('2026-11-28 08:00:00');
    ppRun();
    expect(ppBill($this, '2026-12-01')->lines)->toHaveCount(1);

    // December: attended, cancelled NOT charged, cancelled charged — the bill does not move.
    $d5 = ppLesson($this, $this->student, '2026-12-05');
    $d12 = ppLesson($this, $this->student, '2026-12-12');
    $d19 = ppLesson($this, $this->student, '2026-12-19');
    ppAt('2026-12-20 10:00:00');
    ppMark($this, $d5, 'ATTENDED');
    ppMark($this, $d12, 'CANCELLED_BY_STUDENT', charge: false);
    ppMark($this, $d19, 'CANCELLED_BY_STUDENT', charge: true);
    $dec = ppBill($this, '2026-12-01');
    expect((int) $dec->total_minor)->toBe(20000)->and($dec->lines)->toHaveCount(1);
    $this->asAcademy($this->academy);
    expect(DB::table('invoice_line_items')->whereIn('session_id', [$d5, $d12, $d19])->count())->toBe(0);
    // The teacher is paid exactly as before.
    expect(DB::table('payout_line_items')->where('session_id', $d5)->count())->toBe(1);

    // January's bill: the month, less the one lesson that was not charged.
    ppAt('2026-12-27 08:00:00');
    ppRun();
    $jan = ppBill($this, '2027-01-01');
    expect((int) $jan->total_minor)->toBe(17500)
        ->and($jan->lines->pluck('amount_minor')->map(fn ($v) => (int) $v)->sort()->values()->all())->toBe([-2500, 20000]);
    $credit = $jan->lines->firstWhere('prepaid_charge', 'LESSON');
    expect($credit->prepaid_session_id)->toBe($d12)
        ->and($credit->session_id)->toBeNull()
        ->and($credit->description)->toStartWith('خصم حصة 12 ديسمبر 2026');

    // Corrected to "charged" after January's bill went out: that bill stays as sent…
    ppAt('2026-12-28 10:00:00');
    ppMark($this, $d12, 'CANCELLED_BY_STUDENT', charge: true);
    expect((int) ppBill($this, '2027-01-01')->total_minor)->toBe(17500);

    // …and February's takes the deduction back.
    ppAt('2027-01-27 08:00:00');
    ppRun();
    $feb = ppBill($this, '2027-02-01');
    expect((int) $feb->total_minor)->toBe(22500)
        ->and($feb->lines->firstWhere('prepaid_charge', 'LESSON')->description)->toContain('رجوع عن الخصم');

    // And March has nothing more to say about that lesson.
    ppAt('2027-02-27 08:00:00');
    ppRun();
    expect((int) ppBill($this, '2027-03-01')->total_minor)->toBe(20000);
});

it('starts an academy that was already collecting in advance from a chosen month (انا مسلم)', function () {
    ppMonthly($this, $this->student);
    ppAt('2026-11-22 10:00:00');
    $n7 = ppLesson($this, $this->student, '2026-11-07');
    $n14 = ppLesson($this, $this->student, '2026-11-14');
    ppMark($this, $n7, 'ATTENDED');
    ppMark($this, $n14, 'ATTENDED');
    $novBill = ppBill($this, '2026-11-01');
    expect((int) $novBill->total_minor)->toBe(5000);

    // A dry run changes nothing.
    Artisan::call('billing:prepaid-start', ['academy' => $this->academy, '--from' => '2026-11', '--first-fee' => '2026-12', '--void-before' => '2026-12']);
    $this->asAcademy($this->academy);
    expect(PrepaidMonthly::settings($this->academy)['mode'])->toBe('AFTER_LESSONS')
        ->and(ppBill($this, '2026-11-01')->status)->toBe('OPEN');

    $code = Artisan::call('billing:prepaid-start', ['academy' => $this->academy, '--from' => '2026-11', '--first-fee' => '2026-12', '--void-before' => '2026-12', '--apply' => true]);
    expect($code)->toBe(0);
    $this->asAcademy($this->academy);
    $s = PrepaidMonthly::settings($this->academy);
    expect($s['mode'])->toBe('PREPAID_MONTHLY')->and($s['from'])->toBe('2026-11-01')->and($s['first_fee'])->toBe('2026-12-01')
        ->and(ppBill($this, '2026-11-01')->status)->toBe('VOID')
        ->and(DB::table('audit_log')->where('action', 'invoice.voided')->where('entity_id', $novBill->id)->exists())->toBeTrue();

    // A November lesson corrected after the switch is not refused by its set-aside bill, and adds nothing.
    ppMark($this, $n14, 'CANCELLED_BY_STUDENT', charge: false);
    $n21 = ppLesson($this, $this->student, '2026-11-21');
    ppAt('2026-11-23 10:00:00');
    ppMark($this, $n21, 'ATTENDED');
    $this->asAcademy($this->academy);
    expect(DB::table('invoices')->where('status', '<>', 'VOID')->count())->toBe(0);

    // December's bill: the month, less November's leave.
    ppAt('2026-11-27 08:00:00');
    ppRun();
    $dec = ppBill($this, '2026-12-01');
    expect((int) $dec->total_minor)->toBe(17500)
        ->and($dec->lines->firstWhere('prepaid_charge', 'LESSON')->prepaid_session_id)->toBe($n14);
});

it('charges a student who joined mid-month for the lessons they had, on their first monthly bill', function () {
    ppMonthly($this, $this->student);
    ppSwitchOn($this);
    ppAt('2026-11-27 08:00:00');
    ppRun();

    // Joins on 8 December, nobody paid December for them.
    ppAt('2026-12-08 10:00:00');
    $guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201009999999', 'currency' => 'EGP']);
    $late = $this->createStudent($this->academy, $guardian);
    ppMonthly($this, $late);
    $a = ppLesson($this, $late, '2026-12-12');
    $b = ppLesson($this, $late, '2026-12-19');
    ppAt('2026-12-20 10:00:00');
    ppMark($this, $a, 'ATTENDED');
    ppMark($this, $b, 'CANCELLED_BY_STUDENT', charge: false);
    expect(ppBill($this, '2026-12-01', $guardian))->toBeNull();

    ppAt('2026-12-27 08:00:00');
    ppRun();
    $jan = ppBill($this, '2027-01-01', $guardian);
    expect((int) $jan->total_minor)->toBe(22500)
        ->and($jan->lines->firstWhere('prepaid_charge', 'LESSON')->prepaid_session_id)->toBe($a);
});

it('keeps billing per lesson a student it cannot bill a month for', function () {
    // No price to tell a month from (no lessons-per-month), and a student with no timetable.
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->student,
        'plan_label' => 'hourly', 'price_minor' => 5000, 'currency' => 'EGP', 'price_basis' => 'PER_HOUR',
        'sessions_per_month' => null, 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 6);
    $noTimetable = $this->createStudent($this->academy, $this->guardian);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $noTimetable,
        'plan_label' => '8 × 30', 'price_minor' => 5000, 'currency' => 'EGP', 'price_basis' => 'PER_HOUR',
        'sessions_per_month' => 8, 'lesson_minutes' => 30, 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);
    ppSwitchOn($this);

    ppAt('2026-11-27 08:00:00');
    Sanctum::actingAs($this->owner);
    $preview = $this->getJson('/api/academy/billing-mode/preview')->assertOk();
    expect($preview->json('period'))->toBe('2026-12-01')
        ->and($preview->json('summary.no_price'))->toBe(1)
        ->and($preview->json('summary.no_timetable'))->toBe(1)
        ->and($preview->json('summary.billed'))->toBe(0);
    ppRun();
    expect(ppBill($this, '2026-12-01'))->toBeNull();

    $l1 = ppLesson($this, $this->student, '2026-12-05');
    $l2 = ppLesson($this, $noTimetable, '2026-12-05');
    ppAt('2026-12-06 10:00:00');
    ppMark($this, $l1, 'ATTENDED');
    ppMark($this, $l2, 'ATTENDED');
    $dec = ppBill($this, '2026-12-01');
    expect($dec->lines->pluck('session_id')->sort()->values()->all())->toBe(collect([$l1, $l2])->sort()->values()->all())
        ->and((int) $dec->total_minor)->toBe(5000);
});

it('takes a lesson off at the price of one lesson of the month, whatever length it was saved with', function () {
    // 8 lessons of 40 minutes at 60/hour: a lesson is 40, the month 320.
    ppMonthly($this, $this->student, ['price_minor' => 6000, 'lesson_minutes' => 40]);
    ppSwitchOn($this);
    ppAt('2026-11-27 08:00:00');
    ppRun();
    expect((int) ppBill($this, '2026-12-01')->total_minor)->toBe(32000);

    // Saved at 30 minutes (and one mistyped at 340): each still comes off as one lesson, 40.
    $short = ppLesson($this, $this->student, '2026-12-05');
    $typo = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-12-12 15:00:00+00', 'duration_minutes' => 340, 'status' => 'SCHEDULED',
    ]);
    ppAt('2026-12-13 10:00:00');
    ppMark($this, $short, 'CANCELLED_BY_STUDENT', charge: false);
    ppMark($this, $typo, 'CANCELLED_BY_STUDENT', charge: false);

    ppAt('2026-12-27 08:00:00');
    ppRun();
    $jan = ppBill($this, '2027-01-01');
    expect((int) $jan->total_minor)->toBe(24000)
        ->and($jan->lines->where('prepaid_charge', 'LESSON')->pluck('amount_minor')->map(fn ($v) => (int) $v)->all())->toBe([-4000, -4000]);
});

it('bills the month that was agreed: a monthly price exactly, one worked out from a rate back on its whole amount', function () {
    $hourly = (object) ['price_basis' => 'PER_HOUR', 'price_minor' => 1667, 'sessions_per_month' => 12, 'lesson_minutes' => 30];
    $halves = (object) ['price_basis' => 'PER_HOUR', 'price_minor' => 1250, 'sessions_per_month' => 5, 'lesson_minutes' => null];
    $monthly = (object) ['price_basis' => 'PER_MONTH', 'price_minor' => 25000, 'sessions_per_month' => 8, 'lesson_minutes' => 40];
    // "100 for 12 half-hours" typed as 16.67 an hour: 100.08 worked out, 100 agreed.
    expect(PrepaidMonthly::monthlyFee($hourly))->toBe(10000)
        ->and(PrepaidMonthly::lessonValue($hourly, 30))->toBe(833)
        // A real half (62.50) is no rounding drift and stays.
        ->and(PrepaidMonthly::monthlyFee($halves))->toBe(6250)
        ->and(PrepaidMonthly::monthlyFee($monthly))->toBe(25000)
        ->and(PrepaidMonthly::lessonValue($monthly, 30))->toBe(3125);

    ppMonthly($this, $this->student, ['price_basis' => 'PER_MONTH', 'price_minor' => 25000, 'lesson_minutes' => 40]);
    ppSwitchOn($this);
    ppAt('2026-11-27 08:00:00');
    ppRun();
    expect((int) ppBill($this, '2026-12-01')->total_minor)->toBe(25000);

    $off = ppLesson($this, $this->student, '2026-12-05');
    $held = ppLesson($this, $this->student, '2026-12-12');
    ppAt('2026-12-13 10:00:00');
    ppMark($this, $off, 'CANCELLED_BY_STUDENT', charge: false);
    ppMark($this, $held, 'ATTENDED');
    $this->asAcademy($this->academy);
    expect(DB::table('invoice_line_items')->whereIn('session_id', [$off, $held])->count())->toBe(0);

    ppAt('2026-12-27 08:00:00');
    ppRun();
    expect((int) ppBill($this, '2027-01-01')->total_minor)->toBe(21875);
});

it('never sends a bill that owes the family money: what does not fit waits for the next month', function () {
    ppMonthly($this, $this->student);
    ppSwitchOn($this);
    ppAt('2026-11-27 08:00:00');
    ppRun();

    // Ten December lessons, all cancelled and not charged: 250 of deductions against a 200 month.
    $ids = [];
    foreach (['01', '03', '05', '08', '10', '12', '15', '17', '19', '22'] as $d) {
        $ids[] = ppLesson($this, $this->student, "2026-12-{$d}");
    }
    ppAt('2026-12-23 10:00:00');
    foreach ($ids as $id) {
        ppMark($this, $id, 'CANCELLED_BY_STUDENT', charge: false);
    }

    ppAt('2026-12-27 08:00:00');
    ppRun();
    $jan = ppBill($this, '2027-01-01');
    expect((int) $jan->total_minor)->toBe(0)
        ->and($jan->lines->where('prepaid_charge', 'LESSON'))->toHaveCount(8);

    ppAt('2027-01-27 08:00:00');
    ppRun();
    $feb = ppBill($this, '2027-02-01');
    expect((int) $feb->total_minor)->toBe(15000)
        ->and($feb->lines->where('prepaid_charge', 'LESSON'))->toHaveCount(2);
});

it('keeps a month billed in advance covered after switching back', function () {
    ppMonthly($this, $this->student);
    ppSwitchOn($this);
    ppAt('2026-11-27 08:00:00');
    ppRun();

    ppAt('2026-12-10 10:00:00');
    Sanctum::actingAs($this->owner);
    $this->putJson('/api/academy/billing-mode', ['mode' => 'AFTER_LESSONS'])->assertOk()->assertJsonPath('settings.mode', 'AFTER_LESSONS');

    $dec = ppLesson($this, $this->student, '2026-12-05');
    ppMark($this, $dec, 'ATTENDED');
    expect((int) ppBill($this, '2026-12-01')->total_minor)->toBe(20000);

    // January was never billed ahead: back to per lesson.
    $jan = ppLesson($this, $this->student, '2027-01-02');
    ppAt('2027-01-03 10:00:00');
    ppMark($this, $jan, 'ATTENDED');
    expect((int) ppBill($this, '2027-01-01')->total_minor)->toBe(2500);
});

it('is the owner\'s choice, closed to a centre, and issues only from the issue day', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-prepaid@test.local']);
    Sanctum::actingAs($teacherUser);
    $this->getJson('/api/academy/billing-mode')->assertForbidden();
    $this->putJson('/api/academy/billing-mode', ['mode' => 'PREPAID_MONTHLY'])->assertForbidden();

    ppMonthly($this, $this->student);
    ppSwitchOn($this);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/academy/billing-mode/issue')->assertStatus(422);
    $this->putJson('/api/academy/billing-mode', ['mode' => 'PREPAID_MONTHLY', 'issue_day' => 29])->assertStatus(422);

    ppAt('2026-11-27 09:00:00');
    $this->postJson('/api/academy/billing-mode/issue')->assertOk()->assertJsonPath('students', 1);
    expect((int) ppBill($this, '2026-12-01')->total_minor)->toBe(20000);
    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'invoice.prepaid_issued')->count())->toBe(1);

    // A centre cannot pick it.
    $this->asAcademy($this->academy);
    DB::table('module_subscriptions')->where('academy_id', $this->academy)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]);
    $this->putJson('/api/academy/billing-mode', ['mode' => 'AFTER_LESSONS'])->assertOk();
    $this->putJson('/api/academy/billing-mode', ['mode' => 'PREPAID_MONTHLY'])->assertStatus(422);
});

it('queues the bills on WhatsApp only when the academy asked, spaced out, with the sum the family owes', function () {
    ppMonthly($this, $this->student);
    ppSwitchOn($this);
    Queue::fake();

    ppAt('2026-11-27 08:00:00');
    ppRun();
    Queue::assertNothingPushed();

    // Ticked: the next run's bills are queued.
    $other = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201005555555', 'currency' => 'EGP']);
    $second = $this->createStudent($this->academy, $other);
    ppMonthly($this, $second);
    Sanctum::actingAs($this->owner);
    $this->putJson('/api/academy/billing-mode', ['mode' => 'PREPAID_MONTHLY', 'whatsapp' => true])->assertOk();
    ppAt('2026-11-28 08:00:00');
    ppRun();
    Queue::assertPushed(SendPrepaidBillJob::class, 1);

    $this->asAcademy($this->academy);
    $bill = ppBill($this, '2026-12-01', $other);
    $inv = DB::table('invoices')->where('id', $bill->id)->first();
    $inv->payer_name = 'أم آدم';
    $text = (new SendPrepaidBillJob($this->academy, $bill->id, '2026-12-01'))->message($inv);
    expect($text)->toContain('ديسمبر 2026')
        ->and($text)->toContain('200 EGP')
        ->and($text)->toContain('السداد حتى 5 ديسمبر')
        ->and($text)->toContain('/i/'.$inv->public_token);
});
