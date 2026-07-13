<?php

declare(strict_types=1);

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

/**
 * How an ADDED class (one the weekly timetable never produced — a make-up lesson, or one logged
 * from the Attendance page's "add a class") lands on the student's monthly invoice.
 *
 * The added class is billed by the very same hook as a timetable class — there is no second
 * billing path — so what it costs is decided purely by the subscription's price basis:
 *
 *   PER_MONTH   → a FLAT monthly fee. Lessons divide it up to the quota; anything beyond the
 *                 quota is already paid for and bills 0. The invoice total is the monthly fee,
 *                 full stop, however many lessons were marked.
 *   PER_SESSION → each lesson is its own charge, so an added class genuinely adds one more.
 *
 * The PER_MONTH over-quota case used to emit NEGATIVE line items (the remainder-absorption
 * branch kept subtracting past the quota), so extra lessons REFUNDED the academy: an 8-lesson /
 * 800 EGP month collapsed to 500 EGP after three make-up classes. These tests pin that shut.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-07-01 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-added@test.local']);
    $this->teacher = $this->createTeacher($this->academy);
    $this->guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201001234598', 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);

    $this->subscribe = function (string $basis, int $priceMinor, ?int $quota): void {
        $this->asAcademy($this->academy);
        DB::table('subscriptions')->where('student_id', $this->student)->delete();
        DB::table('subscriptions')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academy,
            'student_id' => $this->student,
            'plan_label' => 'test',
            'price_minor' => $priceMinor,
            'currency' => 'EGP',
            'price_basis' => $basis,
            'sessions_per_month' => $quota,
            'status' => 'ACTIVE',
            'start_date' => '2026-01-01',
        ]);
    };

    // Mark `$n` June lessons ATTENDED — the same path a timetable class and an added class share.
    $this->attendLessons = function (int $n): void {
        Sanctum::actingAs($this->owner);
        for ($i = 1; $i <= $n; $i++) {
            $day = str_pad((string) $i, 2, '0', STR_PAD_LEFT);
            $s = $this->createSession($this->academy, $this->student, $this->teacher, [
                'scheduled_at_utc' => "2026-06-{$day} 10:00:00+00",
                'status' => 'SCHEDULED',
            ]);
            $this->postJson("/api/sessions/{$s}/attendance", ['status' => 'ATTENDED'])->assertOk();
        }
    };

    $this->juneInvoice = function (): object {
        $this->asAcademy($this->academy);

        return DB::table('invoices')->where('academy_id', $this->academy)
            ->where('period_year', 2026)->where('period_month', 6)->first();
    };

    $this->juneLines = function (string $invoiceId): array {
        $this->asAcademy($this->academy);

        return DB::table('invoice_line_items')->where('invoice_id', $invoiceId)
            ->pluck('amount_minor')->map(fn ($a) => (int) $a)->all();
    };
});

afterEach(fn () => Carbon::setTestNow());

it('PER_MONTH: added classes beyond the quota bill nothing and never go negative', function () {
    ($this->subscribe)('PER_MONTH', 80000, 8); // 800 EGP/month over 8 lessons

    // The timetable's 8 lessons, plus 3 added make-up classes.
    ($this->attendLessons)(11);

    $invoice = ($this->juneInvoice)();
    $lines = ($this->juneLines)($invoice->id);

    // The flat fee is charged exactly once, no matter how many lessons ran.
    expect((int) $invoice->total_minor)->toBe(80000)
        ->and(array_sum($lines))->toBe(80000)
        // The three over-quota lessons are free, not a refund.
        ->and(array_filter($lines, fn (int $a) => $a < 0))->toBeEmpty()
        ->and(array_slice($lines, 8))->toBe([0, 0, 0]);
});

it('PER_MONTH: an indivisible monthly price still sums exactly, even over quota', function () {
    // 10001 ÷ 8 leaves a remainder, so the last quota lesson absorbs it (TC-7.10). Adding lessons
    // on top must not push the total a single minor unit past the monthly price.
    ($this->subscribe)('PER_MONTH', 10001, 8);
    ($this->attendLessons)(10);

    $invoice = ($this->juneInvoice)();
    expect((int) $invoice->total_minor)->toBe(10001)
        ->and(array_sum(($this->juneLines)($invoice->id)))->toBe(10001);
});

it('PER_SESSION: an added class genuinely adds one more charge', function () {
    ($this->subscribe)('PER_SESSION', 10000, null); // 100 EGP per lesson

    ($this->attendLessons)(5); // 4 timetable lessons + 1 added class — each is its own charge

    $invoice = ($this->juneInvoice)();
    expect((int) $invoice->total_minor)->toBe(50000)
        ->and(($this->juneLines)($invoice->id))->toBe([10000, 10000, 10000, 10000, 10000]);
});

it('PER_MONTH: a month that runs UNDER quota bills only the lessons taught', function () {
    // The mirror case, so the fix cannot be mistaken for "always charge the full fee": an unmet
    // quota still bills per lesson, and the fee is only reached when the quota is.
    ($this->subscribe)('PER_MONTH', 80000, 8);
    ($this->attendLessons)(3);

    $invoice = ($this->juneInvoice)();
    expect((int) $invoice->total_minor)->toBe(30000)
        ->and(($this->juneLines)($invoice->id))->toBe([10000, 10000, 10000]);
});
