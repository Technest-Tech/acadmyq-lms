<?php

declare(strict_types=1);

use App\Services\Invoicing;
use App\Services\LessonPackages;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/*
|--------------------------------------------------------------------------
| Lesson packages — the hour-based billing mode (docs/lesson-packages)
|--------------------------------------------------------------------------
|
| These tests pin the three rules the whole design rests on:
|   1. A package student never also collects a monthly invoice line (one clock).
|   2. A lesson never splits across two packages — it overdraws the one it is on.
|   3. Consumption is reversible while the bill is OPEN and frozen once it is not.
*/

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // PRO grants the `invoicing` entitlement the /api/packages routes gate on.
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-pkg@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-pkg@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id]);
    $this->guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201009998887', 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    // Package student: price_minor is the DEFAULT HOURLY RATE (200 EGP/hour), not a session fee.
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

    /** Open a package directly through the engine. Hours in, minutes stored. */
    $this->openPackage = function (float $hours, int $priceMinor, string $timing = 'ON_START', bool $carryOver = false): array {
        $this->asAcademy($this->academy);

        return app(LessonPackages::class)->open([
            'student_id' => $this->student,
            'label' => $hours.' hours',
            'minutes_total' => (int) round($hours * 60),
            'price_minor' => $priceMinor,
            'currency' => 'EGP',
            'bill_timing' => $timing,
            'starts_on' => '2026-06-01',
            'carry_over' => $carryOver,
        ], (string) $this->owner->id, 'ACADEMY_OWNER');
    };

    /** A June lesson of the given length. */
    $this->lesson = function (int $minutes, string $at = '2026-06-02 10:00:00+00'): string {
        return $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => $at,
            'duration_minutes' => $minutes,
            'status' => 'SCHEDULED',
        ]);
    };

    $this->packageRow = function (string $id): object {
        $this->asAcademy($this->academy);

        return DB::table('lesson_packages')->where('id', $id)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ─── One clock ───────────────────────────────────────────────────────────────

it('burns package minutes instead of writing a monthly invoice line', function () {
    $package = ($this->openPackage)(4, 80000);
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);

    // The lesson consumed an hour…
    $row = ($this->packageRow)($package['package_id']);
    expect((int) $row->minutes_consumed)->toBe(60)
        ->and((int) $row->minutes_overdrawn)->toBe(0)
        ->and($row->status)->toBe('ACTIVE');

    // …and produced NO AUTO monthly invoice line for it. The only invoice is the package's own.
    expect(DB::table('invoice_line_items')->where('session_id', $session)->count())->toBe(0)
        ->and(DB::table('invoices')->where('academy_id', $this->academy)->where('kind', 'AUTO')->count())->toBe(0);

    // The session is still flagged billed — the shared idempotency guard, whichever engine ran.
    expect((bool) DB::table('sessions')->where('id', $session)->value('billed'))->toBeTrue();
});

it('bills ON_START packages the moment they open', function () {
    $package = ($this->openPackage)(10, 200000);

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $package['invoice_id'])->first();

    expect($invoice)->not->toBeNull()
        ->and($invoice->kind)->toBe('MANUAL')
        ->and((int) $invoice->total_minor)->toBe(200000)
        ->and((string) $invoice->student_id)->toBe($this->student)
        // A package belongs to one child, so it never folds into the shared guardian invoice.
        ->and($invoice->guardian_id)->toBeNull();
});

it('does not bill ON_COMPLETION packages until they close', function () {
    $package = ($this->openPackage)(2, 40000, 'ON_COMPLETION');

    expect($package['invoice_id'])->toBeNull();

    $session = ($this->lesson)(120);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $row = ($this->packageRow)($package['package_id']);

    // Exhausted by that one lesson → closed and billed the agreed price exactly.
    expect($row->status)->toBe('COMPLETED')
        ->and($row->closed_reason)->toBe('EXHAUSTED')
        ->and($row->invoice_id)->not->toBeNull();

    expect((int) DB::table('invoices')->where('id', $row->invoice_id)->value('total_minor'))->toBe(40000);
});

// ─── A lesson never splits ───────────────────────────────────────────────────

it('overdraws rather than splitting a lesson across two packages', function () {
    // 30 minutes bought at 200 EGP/hour; the lesson is 90 minutes.
    $package = ($this->openPackage)(0.5, 10000);
    $session = ($this->lesson)(90);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $row = ($this->packageRow)($package['package_id']);

    expect((int) $row->minutes_consumed)->toBe(90)
        ->and((int) $row->minutes_overdrawn)->toBe(60)
        ->and($row->status)->toBe('COMPLETED');

    // ONE ledger row, on ONE package. This is the rule, and the unique index enforces it.
    $credits = DB::table('lesson_package_credits')->where('session_id', $session)->get();
    expect($credits)->toHaveCount(1)
        ->and((int) $credits[0]->minutes)->toBe(90)
        ->and((int) $credits[0]->minutes_overdrawn)->toBe(60)
        // 60 overdrawn minutes at the package's own snapshotted rate (10 000 per 30 min = 20 000/h).
        ->and((int) $credits[0]->amount_minor)->toBe(20000);
});

it('carries an unbilled overdraft onto the next package invoice', function () {
    $first = ($this->openPackage)(0.5, 10000);              // 30 min @ 20 000/hour
    $session = ($this->lesson)(90);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    expect(($this->packageRow)($first['package_id'])->overdraft_invoice_id)->toBeNull();

    // The next block picks the debt up — the first invoice went out up front and is immutable.
    $second = ($this->openPackage)(4, 80000);

    $this->asAcademy($this->academy);
    $lines = DB::table('invoice_line_items')->where('invoice_id', $second['invoice_id'])->get();

    expect($lines)->toHaveCount(2)
        ->and((int) DB::table('invoices')->where('id', $second['invoice_id'])->value('total_minor'))->toBe(100000)
        ->and((string) ($this->packageRow)($first['package_id'])->overdraft_invoice_id)->toBe($second['invoice_id']);
});

// ─── Reversal ────────────────────────────────────────────────────────────────

it('hands the minutes back when an outcome is corrected', function () {
    $package = ($this->openPackage)(4, 80000);
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_TEACHER'])->assertOk();

    $this->asAcademy($this->academy);
    $row = ($this->packageRow)($package['package_id']);

    expect((int) $row->minutes_consumed)->toBe(0)
        ->and(DB::table('lesson_package_credits')->where('session_id', $session)->count())->toBe(0);
});

it('re-opens a package that only closed because it ran out', function () {
    $package = ($this->openPackage)(1, 20000);
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->asAcademy($this->academy);
    expect(($this->packageRow)($package['package_id'])->status)->toBe('COMPLETED');

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_TEACHER'])->assertOk();

    $this->asAcademy($this->academy);
    $row = ($this->packageRow)($package['package_id']);
    expect($row->status)->toBe('ACTIVE')
        ->and($row->closed_at)->toBeNull()
        ->and((int) $row->minutes_consumed)->toBe(0);
});

it('refuses to un-consume minutes once the package bill has been closed', function () {
    $package = ($this->openPackage)(1, 20000, 'ON_COMPLETION');
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = (string) ($this->packageRow)($package['package_id'])->invoice_id;
    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, (string) $this->owner->id, 'ACADEMY_OWNER');

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_TEACHER'])
        ->assertStatus(422);

    // And the ledger is untouched — the rejection rolled the whole attendance change back.
    $this->asAcademy($this->academy);
    expect(DB::table('lesson_package_credits')->where('session_id', $session)->count())->toBe(1);
});

// ─── The no-package case ─────────────────────────────────────────────────────

it('bills a package student by the hour and alerts the owner when no package is open', function () {
    $session = ($this->lesson)(90);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);

    // Revenue is never silently dropped: the lesson falls through to the ordinary invoice, priced
    // at the subscription's hourly rate × 1.5h rather than as a flat session fee.
    $line = DB::table('invoice_line_items')->where('session_id', $session)->first();
    expect($line)->not->toBeNull()
        ->and((int) $line->amount_minor)->toBe(30000);

    expect(DB::table('notifications')->where('type', 'NO_ACTIVE_PACKAGE')->count())->toBe(1);
});

it('refuses an advance invoice for a package student', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/invoices/advance-quote?student_id='.$this->student.'&start_date=2026-06-01')
        ->assertStatus(422);
});

// ─── Early close and carry-over ──────────────────────────────────────────────

it('bills an ON_COMPLETION package pro-rata when it is closed early', function () {
    $package = ($this->openPackage)(4, 80000, 'ON_COMPLETION');   // 20 000 per hour
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->postJson("/api/packages/{$package['package_id']}/close", ['reason' => 'Student left'])
        ->assertOk();

    $this->asAcademy($this->academy);
    $row = ($this->packageRow)($package['package_id']);

    expect($row->status)->toBe('COMPLETED')
        // One hour used out of four → 20 000, not the full 80 000.
        ->and((int) DB::table('invoices')->where('id', $row->invoice_id)->value('total_minor'))->toBe(20000);
});

it('carries leftover minutes forward only when explicitly asked', function () {
    $first = ($this->openPackage)(4, 80000);
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/packages/{$first['package_id']}/close", ['reason' => 'Switched plan'])->assertOk();

    $second = ($this->openPackage)(4, 80000, 'ON_START', carryOver: true);

    $this->asAcademy($this->academy);
    $row = ($this->packageRow)($second['package_id']);

    // 3 unused hours travel; the new block is worth 7 hours of lessons.
    expect((int) $row->carried_over_minutes)->toBe(180)
        ->and((int) $row->minutes_total)->toBe(240)
        ->and((int) $row->sequence_no)->toBe(2);
});

it('never lets a student run two packages at once', function () {
    ($this->openPackage)(4, 80000);

    expect(fn () => ($this->openPackage)(4, 80000))
        ->toThrow(ValidationException::class);
});

// ─── Attention queue / badge ─────────────────────────────────────────────────

it('counts an unpaid finished package in the attention summary', function () {
    $package = ($this->openPackage)(1, 20000);
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->getJson('/api/packages/summary')
        ->assertOk()
        ->assertJsonPath('unpaid', 1)
        ->assertJsonPath('active', 0);
});

it('flags the owner when a new package opens with an earlier one unpaid', function () {
    $first = ($this->openPackage)(1, 20000);
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // Lessons are never blocked by the accounts — the second package opens fine, loudly.
    ($this->openPackage)(4, 80000);

    $this->asAcademy($this->academy);
    expect(DB::table('notifications')->where('type', 'PACKAGE_UNPAID')->count())->toBe(1);
});

it('bills a package in the currency it was sold in, not the student\'s default', function () {
    // The student's subscription is EGP; this block was agreed in USD. Every figure the package
    // owns — its invoice, its snapshotted hourly rate, and any later overdraft — follows the
    // package, because nothing in invoicing ever converts (§3.6).
    $this->asAcademy($this->academy);
    $package = app(LessonPackages::class)->open([
        'student_id' => $this->student,
        'label' => '10 hours (USD)',
        'minutes_total' => 600,
        'price_minor' => 50000,
        'currency' => 'usd',
        'bill_timing' => 'ON_START',
        'starts_on' => '2026-06-01',
    ], (string) $this->owner->id, 'ACADEMY_OWNER');

    $this->asAcademy($this->academy);
    $row = DB::table('lesson_packages')->where('id', $package['package_id'])->first();
    $invoice = DB::table('invoices')->where('id', $package['invoice_id'])->first();

    expect($row->currency)->toBe('USD')
        ->and((int) $row->hourly_rate_minor)->toBe(5000)
        ->and($invoice->currency)->toBe('USD')
        ->and((int) $invoice->total_minor)->toBe(50000);

    // The lesson's credit is stamped in the package's currency too.
    $session = ($this->lesson)(60);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('lesson_package_credits')->where('session_id', $session)->value('currency'))
        ->toBe('USD');
});
