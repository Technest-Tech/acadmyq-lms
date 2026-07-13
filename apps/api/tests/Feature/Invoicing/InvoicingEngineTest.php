<?php

declare(strict_types=1);

use App\Services\Invoicing;
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

// ─── Shared setup ────────────────────────────────────────────────────────────

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // PRO plan grants the `invoicing` entitlement the invoice routes gate on (Sprint 9).
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-inv@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-inv@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id]);

    // Guardian + student with a PER_SESSION subscription at 10 000 piastres (100 EGP).
    $this->guardian = $this->createGuardian($this->academy, [
        'whatsapp_phone' => '+201001234567',
        'currency' => 'EGP',
    ]);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    $subId = (string) Str::uuid();
    DB::table('subscriptions')->insert([
        'id' => $subId,
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => '1:1 EGP',
        'price_minor' => 10000,
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'sessions_per_month' => null,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    // Helper: create a SCHEDULED session in June 2026 (before "now").
    $this->juneSession = function (array $overrides = []): string {
        return $this->createSession($this->academy, $this->student, $this->teacher, array_merge([
            'scheduled_at_utc' => '2026-06-01 10:00:00+00',
            'status' => 'SCHEDULED',
        ], $overrides));
    };

    // Helper: count line items for a session.
    $this->lineCount = function (string $sessionId): int {
        $this->asAcademy($this->academy);

        return DB::table('invoice_line_items')->where('session_id', $sessionId)->count();
    };

    // Helper: fetch the open invoice for the academy's guardian in the given period.
    $this->openInvoice = function (int $year = 2026, int $month = 6): ?object {
        $this->asAcademy($this->academy);

        return DB::table('invoices')
            ->where('academy_id', $this->academy)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->where('status', 'OPEN')
            ->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ─── TC-7.1 ──────────────────────────────────────────────────────────────────

it('TC-7.1: ATTENDED → one line item on OPEN invoice; amount = subscription price; currency matches', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    expect($invoice)->not->toBeNull()
        ->and($invoice->status)->toBe('OPEN')
        ->and($invoice->currency)->toBe('EGP');

    $lineItems = DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->get();
    expect($lineItems)->toHaveCount(1)
        ->and((int) $lineItems->first()->amount_minor)->toBe(10000)
        ->and($lineItems->first()->currency)->toBe('EGP');
});

// ─── TC-7.2 ──────────────────────────────────────────────────────────────────

it('TC-7.2: charged cancellation (charge_student) → also billed; one line item created', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_STUDENT', 'charge_student' => true])->assertOk();

    expect(($this->lineCount)($session))->toBe(1);

    $this->asAcademy($this->academy);
    $billed = DB::table('sessions')->where('id', $session)->value('billed');
    expect((bool) $billed)->toBeTrue();
});

// ─── TC-7.3 ──────────────────────────────────────────────────────────────────

it('TC-7.3: Re-marking the same session does not create a duplicate line item (idempotent)', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    expect(($this->lineCount)($session))->toBe(1);
});

// ─── TC-7.4 ──────────────────────────────────────────────────────────────────

it('TC-7.4: Changing subscription price after line exists leaves existing line amount_minor unchanged', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // Change subscription price.
    $this->asAcademy($this->academy);
    DB::table('subscriptions')
        ->where('student_id', $this->student)
        ->where('status', 'ACTIVE')
        ->update(['price_minor' => 99999]);

    // Existing line amount must still be 10000.
    $line = DB::table('invoice_line_items')->where('session_id', $session)->first();
    expect((int) $line->amount_minor)->toBe(10000);
});

// ─── TC-7.5 ──────────────────────────────────────────────────────────────────

it('TC-7.5: Description snapshots the session date at billing time', function () {
    $session = ($this->juneSession)(['scheduled_at_utc' => '2026-06-03 08:00:00+00']);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $line = DB::table('invoice_line_items')->where('session_id', $session)->first();

    // Description must contain the local date (Africa/Cairo is UTC+2, so 08:00 UTC → 10:00 local, still June 3).
    expect($line->description)->toContain('2026-06-03');
    expect($line->session_date)->toBe('2026-06-03');
});

// ─── TC-7.6 ──────────────────────────────────────────────────────────────────

it('TC-7.6: PER_GUARDIAN grouping — two children of same guardian → one invoice with two line items', function () {
    // Ensure academy is PER_GUARDIAN (already the default in beforeEach).
    $studentB = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $studentB,
        'plan_label' => '1:1 EGP',
        'price_minor' => 10000,
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    $teacherB = $this->createTeacher($this->academy);
    $sessionA = ($this->juneSession)();
    $sessionB = $this->createSession($this->academy, $studentB, $teacherB, [
        'scheduled_at_utc' => '2026-06-02 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoices = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('guardian_id', $this->guardian)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->get();

    expect($invoices)->toHaveCount(1);

    $invoiceId = $invoices->first()->id;
    $lineItems = DB::table('invoice_line_items')->where('invoice_id', $invoiceId)->get();
    expect($lineItems)->toHaveCount(2);
});

// ─── TC-7.7 ──────────────────────────────────────────────────────────────────

it('TC-7.7: PER_STUDENT grouping — two children of same guardian → two separate invoices', function () {
    // Switch academy to PER_STUDENT.
    $this->asSuperAdmin();
    DB::table('academies')->where('id', $this->academy)->update(['invoice_grouping' => 'PER_STUDENT']);

    $studentB = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $studentB,
        'plan_label' => '1:1 EGP',
        'price_minor' => 10000,
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    $teacherB = $this->createTeacher($this->academy);
    $sessionA = ($this->juneSession)();
    $sessionB = $this->createSession($this->academy, $studentB, $teacherB, [
        'scheduled_at_utc' => '2026-06-02 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoices = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->get();

    expect($invoices)->toHaveCount(2);

    // Each invoice must have exactly one line item.
    foreach ($invoices as $inv) {
        $count = DB::table('invoice_line_items')->where('invoice_id', $inv->id)->count();
        expect($count)->toBe(1);
    }
});

// ─── TC-7.8 ──────────────────────────────────────────────────────────────────

it('TC-7.8: Academy invoice_grouping change only affects future sessions, not already-created invoices', function () {
    // Bill a June session under PER_GUARDIAN → creates one guardian invoice.
    $sessionA = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $guardianInvoicesBefore = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->whereNotNull('guardian_id')
        ->count();
    expect($guardianInvoicesBefore)->toBe(1);

    // Switch to PER_STUDENT.
    $this->asSuperAdmin();
    DB::table('academies')->where('id', $this->academy)->update(['invoice_grouping' => 'PER_STUDENT']);

    // A July session (new period) with the new grouping.
    Carbon::setTestNow('2026-07-11 12:00:00');
    $sessionB = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-07-01 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    // The old June invoice is still a guardian invoice.
    $guardianInvoicesAfter = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->whereNotNull('guardian_id')
        ->where('period_month', 6)
        ->count();
    expect($guardianInvoicesAfter)->toBe(1);

    // The new July invoice is a student invoice.
    $studentInvoiceJuly = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->whereNotNull('student_id')
        ->where('period_month', 7)
        ->count();
    expect($studentInvoiceJuly)->toBe(1);
});

// ─── TC-7.9 ──────────────────────────────────────────────────────────────────

it('TC-7.9: Open invoice total always equals sum of line items after each add/remove', function () {
    $sessionA = ($this->juneSession)(['scheduled_at_utc' => '2026-06-01 10:00:00+00']);
    $sessionB = ($this->juneSession)(['scheduled_at_utc' => '2026-06-02 10:00:00+00']);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    $lineSum = (int) DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->sum('amount_minor');
    $invoice = DB::table('invoices')->where('id', $invoice->id)->first();
    expect((int) $invoice->total_minor)->toBe($lineSum);

    // Add a second line item.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $lineSum = (int) DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->sum('amount_minor');
    $invoice = DB::table('invoices')->where('id', $invoice->id)->first();
    expect((int) $invoice->total_minor)->toBe($lineSum);

    // Remove a line item by excusing sessionA.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'CANCELLED_BY_STUDENT', 'reason' => 'sick'])->assertOk();

    $this->asAcademy($this->academy);
    $lineSum = (int) DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->sum('amount_minor');
    $invoice = DB::table('invoices')->where('id', $invoice->id)->first();
    expect((int) $invoice->total_minor)->toBe($lineSum);
});

// ─── TC-7.10 ─────────────────────────────────────────────────────────────────

it('TC-7.10: PER_MONTH basis — 8 sessions at price not divisible by 8 → sum exactly equals monthly price', function () {
    // 8 sessions, monthly price = 10001 (not divisible by 8 → floor = 1250, remainder = 1).
    $this->asAcademy($this->academy);
    DB::table('subscriptions')
        ->where('student_id', $this->student)
        ->where('status', 'ACTIVE')
        ->update([
            'price_basis' => 'PER_MONTH',
            'price_minor' => 10001,
            'sessions_per_month' => 8,
        ]);

    Sanctum::actingAs($this->owner);

    for ($i = 1; $i <= 8; $i++) {
        $s = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => "2026-06-0{$i} 10:00:00+00",
            'status' => 'SCHEDULED',
        ]);
        $this->postJson("/api/sessions/{$s}/attendance", ['status' => 'ATTENDED'])->assertOk();
    }

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    $lineSum = (int) DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->sum('amount_minor');
    expect($lineSum)->toBe(10001);
});

// ─── TC-7.11 ─────────────────────────────────────────────────────────────────

it('TC-7.11: PER_SESSION basis — each line equals per-session price; total = count × price', function () {
    Sanctum::actingAs($this->owner);

    $sessions = [];
    for ($i = 1; $i <= 3; $i++) {
        $s = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => "2026-06-0{$i} 10:00:00+00",
            'status' => 'SCHEDULED',
        ]);
        $this->postJson("/api/sessions/{$s}/attendance", ['status' => 'ATTENDED'])->assertOk();
        $sessions[] = $s;
    }

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    $lines = DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->get();
    expect($lines)->toHaveCount(3);

    foreach ($lines as $line) {
        expect((int) $line->amount_minor)->toBe(10000);
    }
    expect((int) $invoice->total_minor)->toBe(30000);
});

// ─── TC-7.11b ────────────────────────────────────────────────────────────────

it('TC-7.11b: PER_HOUR basis — each line = hourly rate × session hours', function () {
    Sanctum::actingAs($this->owner);

    // Switch the student's subscription to PER_HOUR at 60.00 EGP/hour (6 000 piastres).
    $this->asAcademy($this->academy);
    DB::table('subscriptions')
        ->where('student_id', $this->student)
        ->update(['price_basis' => 'PER_HOUR', 'price_minor' => 6000]);

    // 60 min → 6 000, 90 min → 9 000, 30 min → 3 000.
    $cases = [
        ['day' => '01', 'duration' => 60, 'expected' => 6000],
        ['day' => '02', 'duration' => 90, 'expected' => 9000],
        ['day' => '03', 'duration' => 30, 'expected' => 3000],
    ];

    foreach ($cases as $case) {
        Sanctum::actingAs($this->owner);
        $s = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => "2026-06-{$case['day']} 10:00:00+00",
            'duration_minutes' => $case['duration'],
            'status' => 'SCHEDULED',
        ]);
        $this->postJson("/api/sessions/{$s}/attendance", ['status' => 'ATTENDED'])->assertOk();

        $this->asAcademy($this->academy);
        $amount = (int) DB::table('invoice_line_items')->where('session_id', $s)->value('amount_minor');
        expect($amount)->toBe($case['expected']);
    }

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();
    expect((int) $invoice->total_minor)->toBe(18000);
});

// ─── TC-7.12 ─────────────────────────────────────────────────────────────────

it('TC-7.12: ATTENDED → cancellation before close → line removed and total reduced', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->lineCount)($session))->toBe(1);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_STUDENT', 'reason' => 'sick'])->assertOk();
    expect(($this->lineCount)($session))->toBe(0);

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    expect((int) $invoice->total_minor)->toBe(0);
});

// ─── TC-7.13 ─────────────────────────────────────────────────────────────────

it('TC-7.13: Un-billing after invoice is CLOSED is rejected with 422', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoice_line_items')->where('session_id', $session)->value('invoice_id');
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_STUDENT'])
        ->assertStatus(422);

    expect(($this->lineCount)($session))->toBe(1);
});

// ─── TC-7.14 ─────────────────────────────────────────────────────────────────

it('TC-7.14: Adding a line item to a CLOSED invoice is rejected by DB trigger', function () {
    [$invoiceId] = $this->createInvoice($this->academy, $this->guardian, [
        'period_year' => 2026,
        'period_month' => 6,
        'status' => 'CLOSED',
        'closed_at' => now(),
        'currency' => 'EGP',
        'subtotal_minor' => 0,
        'total_minor' => 0,
    ]);

    $this->asAcademy($this->academy);
    expect(fn () => DB::table('invoice_line_items')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'invoice_id' => $invoiceId,
        'session_id' => (string) Str::uuid(),
        'student_id' => $this->student,
        'description' => 'ghost line',
        'amount_minor' => 1000,
        'currency' => 'EGP',
        'session_date' => '2026-06-01',
        'created_at' => now(),
    ]))->toThrow(Exception::class);
});

// ─── TC-7.15 ─────────────────────────────────────────────────────────────────

it('TC-7.15: Modifying total_minor on a CLOSED invoice is rejected by DB trigger', function () {
    [$invoiceId] = $this->createInvoice($this->academy, $this->guardian, [
        'period_year' => 2026,
        'period_month' => 6,
        'status' => 'CLOSED',
        'closed_at' => now(),
        'currency' => 'EGP',
        'subtotal_minor' => 10000,
        'total_minor' => 10000,
    ]);

    $this->asAcademy($this->academy);
    expect(fn () => DB::table('invoices')
        ->where('id', $invoiceId)
        ->update(['total_minor' => 99999])
    )->toThrow(Exception::class);
});

// ─── TC-7.16 ─────────────────────────────────────────────────────────────────

it('TC-7.16: Closing an already-CLOSED invoice is a no-op — no duplicate audit entry', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    // First close.
    app(Invoicing::class)->closeInvoice((string) $invoice->id, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    $auditCountAfterFirst = DB::table('audit_log')
        ->where('action', 'invoice.closed')
        ->where('entity_id', $invoice->id)
        ->count();

    // Second close call — should be a no-op.
    app(Invoicing::class)->closeInvoice((string) $invoice->id, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    $auditCountAfterSecond = DB::table('audit_log')
        ->where('action', 'invoice.closed')
        ->where('entity_id', $invoice->id)
        ->count();

    expect($auditCountAfterSecond)->toBe($auditCountAfterFirst);
});

// ─── TC-7.17 ─────────────────────────────────────────────────────────────────

it('TC-7.17: Pre-close integrity check fails when total_minor != sum of line items', function () {
    [$invoiceId] = $this->createInvoice($this->academy, $this->guardian, [
        'period_year' => 2026,
        'period_month' => 6,
        'status' => 'OPEN',
        'currency' => 'EGP',
        'subtotal_minor' => 99999,
        'total_minor' => 99999, // Mismatch: no line items yet.
    ]);

    $this->asAcademy($this->academy);
    expect(fn () => app(Invoicing::class)->closeInvoice(
        $invoiceId,
        $this->academy,
        $this->owner->id,
        'ACADEMY_OWNER',
    ))->toThrow(RuntimeException::class);

    $status = DB::table('invoices')->where('id', $invoiceId)->value('status');
    expect($status)->toBe('OPEN');
});

// ─── TC-7.18 ─────────────────────────────────────────────────────────────────

it('TC-7.18: Sessions in June → June invoice; July session → new separate July invoice', function () {
    $sessionJune = ($this->juneSession)(['scheduled_at_utc' => '2026-06-10 10:00:00+00']);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionJune}/attendance", ['status' => 'ATTENDED'])->assertOk();

    Carbon::setTestNow('2026-07-11 12:00:00');
    $sessionJuly = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-07-02 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);
    $this->postJson("/api/sessions/{$sessionJuly}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $juneInvoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();
    $julyInvoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 7)
        ->first();

    expect($juneInvoice)->not->toBeNull()
        ->and($julyInvoice)->not->toBeNull()
        ->and($juneInvoice->id)->not->toBe($julyInvoice->id);
});

// ─── TC-7.19 ─────────────────────────────────────────────────────────────────

it('TC-7.19: Closing June invoice leaves July invoice OPEN', function () {
    $sessionJune = ($this->juneSession)(['scheduled_at_utc' => '2026-06-05 10:00:00+00']);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionJune}/attendance", ['status' => 'ATTENDED'])->assertOk();

    Carbon::setTestNow('2026-07-11 12:00:00');
    $sessionJuly = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-07-03 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);
    $this->postJson("/api/sessions/{$sessionJuly}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $closed = app(Invoicing::class)->closePeriodInvoices(
        $this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER',
    );
    expect($closed)->toBe(1);

    $juneStatus = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_month', 6)
        ->value('status');
    $julyStatus = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_month', 7)
        ->value('status');

    expect($juneStatus)->toBe('CLOSED')
        ->and($julyStatus)->toBe('OPEN');
});

// ─── TC-7.20 ─────────────────────────────────────────────────────────────────

it('TC-7.20: GET /api/i/{token} returns correct DTO with academy name, payer, period, line items, totals', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    $token = $invoice->public_token;

    $this->clearTenantContext();
    $res = $this->getJson("/api/i/{$token}")->assertOk();

    expect($res->json('academy_name'))->not->toBeNull()
        ->and($res->json('payer_name'))->not->toBeNull()
        ->and($res->json('period_year'))->toBe(2026)
        ->and($res->json('period_month'))->toBe(6)
        ->and($res->json('total_minor'))->toBe(10000)
        ->and($res->json('currency'))->toBe('EGP')
        ->and($res->json('line_items'))->toHaveCount(1);
});

// ─── TC-7.21 ─────────────────────────────────────────────────────────────────

it('TC-7.21: Unknown token returns 404', function () {
    $this->clearTenantContext();
    $this->getJson('/api/i/completely-invalid-token-xyz-99999')->assertNotFound();
});

// ─── TC-7.22 ─────────────────────────────────────────────────────────────────

it('TC-7.22: Public page is correctly scoped — token for academy A cannot expose academy B invoice', function () {
    // Create a second, unrelated academy with its own invoice.
    $academyB = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $guardianB = $this->createGuardian($academyB);
    [$invoiceIdB, $tokenB] = $this->createInvoice($academyB, $guardianB, [
        'period_year' => 2026,
        'period_month' => 6,
        'currency' => 'EGP',
    ]);

    // Bill a session in academy A.
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $tokenA = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('public_token');

    // Using token A must not return academy B's data.
    $this->clearTenantContext();
    $resA = $this->getJson("/api/i/{$tokenA}")->assertOk();
    expect($resA->json('id'))->not->toBe($invoiceIdB);

    // Token B returns academy B's invoice, not academy A's.
    $resB = $this->getJson("/api/i/{$tokenB}")->assertOk();
    expect($resB->json('id'))->toBe($invoiceIdB);
});

// ─── TC-7.23 ─────────────────────────────────────────────────────────────────

it('TC-7.23: POST to public invoice route is rejected with 405 Method Not Allowed', function () {
    $this->clearTenantContext();
    $this->postJson('/api/i/some-token', [])->assertStatus(405);
});

// ─── #19 ─────────────────────────────────────────────────────────────────────

it('#19: public invoice lists every lesson — charged, free, cancelled and trial — split per child, only the charged one billed', function () {
    // 1) A charged attended lesson for the regular student → opens the guardian invoice + 1 billed line.
    $billed = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$billed}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);

    // 2) a FREE lesson and 3) a cancelled lesson for the SAME student — non-billable, so neither
    // carries a stored line item. They must still surface on the public bill, at zero.
    $free = ($this->juneSession)(['scheduled_at_utc' => '2026-06-05 10:00:00+00', 'status' => 'FREE']);
    $cancelled = ($this->juneSession)(['scheduled_at_utc' => '2026-06-07 10:00:00+00', 'status' => 'CANCELLED_BY_STUDENT']);

    // 4) a TRIAL learner under the SAME guardian with an attended taster — the billing engine skips
    // trials entirely, so it has no line item, yet the parent should see the lesson on the bill.
    $trialStudent = $this->createStudent($this->academy, $this->guardian, ['status' => 'TRIAL', 'full_name' => 'Trial Kid']);
    $trial = $this->createSession($this->academy, $trialStudent, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00',
        'status' => 'ATTENDED',
    ]);

    // Only the charged lesson ever stored a line item.
    expect(DB::table('invoice_line_items')->whereIn('session_id', [$free, $cancelled, $trial])->count())->toBe(0);

    $token = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('guardian_id', $this->guardian)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('public_token');

    $this->clearTenantContext();
    $res = $this->getJson("/api/i/{$token}")->assertOk();

    $items = collect($res->json('line_items'))->keyBy('session_id');

    // Every lesson of the month is listed: charged + free + cancelled + trial.
    expect($items)->toHaveCount(4)
        ->and((int) $items[$billed]['amount_minor'])->toBe(10000)
        ->and((int) $items[$free]['amount_minor'])->toBe(0)
        ->and($items[$free]['session_status'])->toBe('FREE')
        ->and((int) $items[$cancelled]['amount_minor'])->toBe(0)
        ->and($items[$cancelled]['session_status'])->toBe('CANCELLED_BY_STUDENT')
        ->and((int) $items[$trial]['amount_minor'])->toBe(0)
        ->and($items[$trial]['student_name'])->toBe('Trial Kid');

    // Totals are untouched by the informational rows — only the charged lesson counts.
    expect((int) $res->json('total_minor'))->toBe(10000);

    // Two distinct children on the bill (the regular student + the trial learner) → split per child.
    expect($items->pluck('student_id')->unique()->values())->toHaveCount(2);
});

// ─── TC-7.24 ─────────────────────────────────────────────────────────────────

it('TC-7.24: Public invoice route is registered with throttle middleware', function () {
    $router = app('router');
    $routes = $router->getRoutes();

    $found = false;
    foreach ($routes as $route) {
        if (str_contains((string) $route->uri(), 'i/{token}') && in_array('GET', $route->methods(), true)) {
            $found = true;
            $middlewares = $route->gatherMiddleware();
            $hasThrottle = collect($middlewares)->contains(
                fn ($m) => str_contains((string) $m, 'throttle')
            );
            expect($hasThrottle)->toBeTrue('Expected throttle middleware on public invoice route');
            break;
        }
    }
    expect($found)->toBeTrue('Public invoice route /i/{token} not found');
});

// ─── TC-7.25 ─────────────────────────────────────────────────────────────────

it('TC-7.25: Send-link builds WhatsApp message with /i/{token} URL and marks sent_at', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('id');

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/invoices/{$invoiceId}/send-link")->assertOk();

    $token = DB::table('invoices')->where('id', $invoiceId)->value('public_token');
    expect($res->json('message'))->toContain("/i/{$token}");
    expect($res->json('phone'))->toBe('+201001234567');
    expect($res->json('url'))->toContain("/i/{$token}");

    $this->asAcademy($this->academy);
    $row = DB::table('invoices')->where('id', $invoiceId)->first();
    expect($row->sent_at)->not->toBeNull()
        ->and($row->sent_channel)->toBe('WHATSAPP');
});

// ─── TC-7.27 ─────────────────────────────────────────────────────────────────

it('TC-7.27: Mark-paid CASH → status PAID, paid_at set, audit entry written', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('id');

    // Must be CLOSED first before mark-paid.
    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/invoices/{$invoiceId}/mark-paid", [
        'payment_method' => 'CASH',
    ])->assertOk();

    expect($res->json('status'))->toBe('PAID');

    $this->asAcademy($this->academy);
    $row = DB::table('invoices')->where('id', $invoiceId)->first();
    expect($row->status)->toBe('PAID')
        ->and($row->paid_at)->not->toBeNull()
        ->and($row->payment_method)->toBe('CASH');

    $auditExists = DB::table('audit_log')
        ->where('action', 'invoice.marked_paid')
        ->where('entity_id', $invoiceId)
        ->exists();
    expect($auditExists)->toBeTrue();
});

// ─── TC-7.28 ─────────────────────────────────────────────────────────────────

it('TC-7.28: Mark partial payment → PARTIALLY_PAID status with amount_paid_minor set', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('id');

    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/invoices/{$invoiceId}/mark-paid", [
        'payment_method' => 'BANK_TRANSFER',
        'amount_paid_minor' => 5000, // Partial payment (total is 10000).
    ])->assertOk();

    expect($res->json('status'))->toBe('PARTIALLY_PAID');

    $this->asAcademy($this->academy);
    $row = DB::table('invoices')->where('id', $invoiceId)->first();
    expect($row->status)->toBe('PARTIALLY_PAID')
        ->and((int) $row->amount_paid_minor)->toBe(5000);
});

// ─── TC-7.29 ─────────────────────────────────────────────────────────────────

it('TC-7.29: PER_GUARDIAN, same currency (EGP) → one shared guardian invoice', function () {
    $studentB = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $studentB,
        'plan_label' => '1:1 EGP',
        'price_minor' => 8000,
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    $teacherB = $this->createTeacher($this->academy);
    $sessionA = ($this->juneSession)(['scheduled_at_utc' => '2026-06-01 10:00:00+00']);
    $sessionB = $this->createSession($this->academy, $studentB, $teacherB, [
        'scheduled_at_utc' => '2026-06-02 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceCount = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('guardian_id', $this->guardian)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->count();

    expect($invoiceCount)->toBe(1);
});

// ─── TC-7.30 ─────────────────────────────────────────────────────────────────

it('TC-7.30: PER_GUARDIAN, mixed currencies (EGP + SAR) → one guardian invoice per currency', function () {
    $studentB = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    // Student B has a SAR subscription.
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $studentB,
        'plan_label' => '1:1 SAR',
        'price_minor' => 5000,
        'currency' => 'SAR',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    $teacherB = $this->createTeacher($this->academy);
    $sessionA = ($this->juneSession)(['scheduled_at_utc' => '2026-06-01 10:00:00+00']);
    $sessionB = $this->createSession($this->academy, $studentB, $teacherB, [
        'scheduled_at_utc' => '2026-06-02 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    // Mixed currencies → the parent is billed on one guardian invoice per currency.
    $guardianInvoices = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('guardian_id', $this->guardian)
        ->whereNull('student_id')
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->get();

    // No per-student invoices are created — bills are always for the parent.
    $studentInvoices = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->whereNotNull('student_id')
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->count();

    // Two guardian invoices (one EGP, one SAR), each in its child's subscription currency.
    expect($guardianInvoices)->toHaveCount(2);
    expect($guardianInvoices->pluck('currency')->sort()->values()->all())->toBe(['EGP', 'SAR']);
    expect($studentInvoices)->toBe(0);
});

// ─── TC-7.30b ────────────────────────────────────────────────────────────────

it('TC-7.30b: invoice currency follows the student subscription, not the guardian stored currency', function () {
    // The guardian's stored currency is EGP, but the child is billed in USD. The invoice and its
    // line item must both be USD so the amount and currency agree (regression: USD lessons were
    // being billed under an EGP guardian invoice).
    $studentUsd = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $studentUsd,
        'plan_label' => '1:1 USD',
        'price_minor' => 4000,
        'currency' => 'USD',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    $session = $this->createSession($this->academy, $studentUsd, $this->teacher, [
        'scheduled_at_utc' => '2026-06-03 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('guardian_id', $this->guardian)
        ->where('currency', 'USD')
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->first();

    expect($invoice)->not->toBeNull()
        ->and($invoice->student_id)->toBeNull();

    $line = DB::table('invoice_line_items')->where('session_id', $session)->first();
    expect($line->currency)->toBe('USD')
        ->and((int) $line->amount_minor)->toBe(4000);
});

// ─── TC-7.31 ─────────────────────────────────────────────────────────────────

it('TC-7.31: Owner of academy A cannot read or mark-paid academy B invoices (RLS + 404)', function () {
    // Create academy B with its own invoice.
    $academyB = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $guardianB = $this->createGuardian($academyB);
    [$invoiceIdB] = $this->createInvoice($academyB, $guardianB, [
        'period_year' => 2026,
        'period_month' => 6,
        'status' => 'CLOSED',
        'closed_at' => now(),
        'currency' => 'EGP',
        'subtotal_minor' => 0,
        'total_minor' => 0,
    ]);

    // Academy A owner tries to read academy B's invoice.
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/invoices/{$invoiceIdB}")->assertNotFound();

    // Academy A owner tries to mark-paid academy B's invoice.
    $this->postJson("/api/invoices/{$invoiceIdB}/mark-paid", [
        'payment_method' => 'CASH',
    ])->assertNotFound();
});

// ─── TC-7.32 ─────────────────────────────────────────────────────────────────

it('TC-7.32: TEACHER role gets 403 on invoice list and mark-paid endpoints', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('id');

    // Close it so mark-paid would otherwise succeed for an owner.
    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/invoices')->assertForbidden();
    $this->postJson("/api/invoices/{$invoiceId}/mark-paid", ['payment_method' => 'CASH'])->assertForbidden();
    $this->postJson("/api/invoices/{$invoiceId}/send-link")->assertForbidden();
});

// ─── TC-7.33 ─────────────────────────────────────────────────────────────────

it('TC-7.33: Line add, line remove, close, mark-paid, and send-link each write audit_log entries', function () {
    $sessionA = ($this->juneSession)(['scheduled_at_utc' => '2026-06-01 10:00:00+00']);
    $sessionB = ($this->juneSession)(['scheduled_at_utc' => '2026-06-02 10:00:00+00']);
    Sanctum::actingAs($this->owner);

    // Line add.
    $this->postJson("/api/sessions/{$sessionA}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoice_line_items')->where('session_id', $sessionA)->value('invoice_id');

    $lineAddCount = DB::table('audit_log')
        ->where('action', 'invoice.line_added')
        ->where('entity_id', $invoiceId)
        ->count();
    expect($lineAddCount)->toBe(2);

    // Line remove.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$sessionB}/attendance", ['status' => 'CANCELLED_BY_STUDENT', 'reason' => 'sick'])->assertOk();

    $this->asAcademy($this->academy);
    $lineRemoveCount = DB::table('audit_log')
        ->where('action', 'invoice.line_removed')
        ->where('entity_id', $invoiceId)
        ->count();
    expect($lineRemoveCount)->toBe(1);

    // Close.
    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    $closeCount = DB::table('audit_log')
        ->where('action', 'invoice.closed')
        ->where('entity_id', $invoiceId)
        ->count();
    expect($closeCount)->toBe(1);

    // Mark-paid.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$invoiceId}/mark-paid", ['payment_method' => 'CASH'])->assertOk();

    $this->asAcademy($this->academy);
    $paidCount = DB::table('audit_log')
        ->where('action', 'invoice.marked_paid')
        ->where('entity_id', $invoiceId)
        ->count();
    expect($paidCount)->toBe(1);

    // Send-link (invoice is now PAID; send-link does not require a specific status).
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$invoiceId}/send-link")->assertOk();

    $this->asAcademy($this->academy);
    $sendCount = DB::table('audit_log')
        ->where('action', 'invoice.link_sent')
        ->where('entity_id', $invoiceId)
        ->count();
    expect($sendCount)->toBe(1);
});

// ─── TC-7.34 ─────────────────────────────────────────────────────────────────

it('TC-7.34: list returns payer_type uppercase and is searchable by payer name', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // PER_GUARDIAN academy → payer_type must be the uppercase the frontend compares against.
    $res = $this->getJson('/api/invoices')->assertOk();
    expect($res->json('rows.0.payer_type'))->toBe('GUARDIAN');

    // Free-text search matches the guardian's full name (ILIKE on g.full_name / s.full_name).
    $name = DB::table('guardians')->where('id', $this->guardian)->value('full_name');
    $hit = $this->getJson('/api/invoices?search='.urlencode((string) $name))->assertOk();
    expect($hit->json('total'))->toBeGreaterThanOrEqual(1);

    $miss = $this->getJson('/api/invoices?search=zzz-no-such-payer-zzz')->assertOk();
    expect($miss->json('total'))->toBe(0);
});

// ─── TC-7.35 ─────────────────────────────────────────────────────────────────

it('TC-7.35: summary returns status counts and per-currency money roll-up', function () {
    // One billed + closed + fully-paid invoice this period.
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('id');

    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$invoiceId}/mark-paid", ['payment_method' => 'CASH'])->assertOk();

    $res = $this->getJson('/api/invoices/summary')->assertOk();

    expect($res->json('counts.all'))->toBe(1)
        ->and($res->json('counts.PAID'))->toBe(1)
        ->and($res->json('counts.OPEN'))->toBe(0);

    // Money is grouped per currency; the single EGP invoice is billed 10000 and fully collected.
    $bucket = collect($res->json('money'))->firstWhere('currency', 'EGP');
    expect($bucket)->not->toBeNull()
        ->and((int) $bucket['billed_minor'])->toBe(10000)
        ->and((int) $bucket['collected_minor'])->toBe(10000)
        ->and((int) $bucket['outstanding_minor'])->toBe(0);

    // Period filter that matches nothing → zeroed counts.
    $empty = $this->getJson('/api/invoices/summary?period_year=2099&period_month=1')->assertOk();
    expect($empty->json('counts.all'))->toBe(0);
});

// ─── TC-7.36 ─────────────────────────────────────────────────────────────────

it('TC-7.36: summary outstanding reflects the unpaid balance of CLOSED invoices', function () {
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->value('id');

    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    // CLOSED but unpaid → the full 10000 is outstanding.
    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/invoices/summary')->assertOk();
    $bucket = collect($res->json('money'))->firstWhere('currency', 'EGP');
    expect((int) $bucket['outstanding_minor'])->toBe(10000)
        ->and($res->json('counts.CLOSED'))->toBe(1);

    // Partial payment → outstanding drops to the remaining balance.
    $this->postJson("/api/invoices/{$invoiceId}/mark-paid", [
        'payment_method' => 'BANK_TRANSFER',
        'amount_paid_minor' => 4000,
    ])->assertOk();

    $res2 = $this->getJson('/api/invoices/summary')->assertOk();
    $bucket2 = collect($res2->json('money'))->firstWhere('currency', 'EGP');
    expect((int) $bucket2['outstanding_minor'])->toBe(6000)
        ->and($res2->json('counts.PARTIALLY_PAID'))->toBe(1);
});

// ─── TC-7.36b ────────────────────────────────────────────────────────────────

it('TC-7.36b: summary due_minor counts unpaid OPEN invoices, which outstanding_minor excludes', function () {
    // An attended session leaves an OPEN (un-closed) invoice for 10000.
    $session = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $res = $this->getJson('/api/invoices/summary')->assertOk();
    $bucket = collect($res->json('money'))->firstWhere('currency', 'EGP');

    // The bill is OPEN, so it is NOT outstanding (closed-only) but IS due (everything owed).
    expect($res->json('counts.OPEN'))->toBe(1)
        ->and((int) $bucket['outstanding_minor'])->toBe(0)
        ->and((int) $bucket['due_minor'])->toBe(10000);
});

// ─── TC-7.37 ─────────────────────────────────────────────────────────────────

it('TC-7.37: TEACHER role gets 403 on the invoices summary endpoint', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/invoices/summary')->assertStatus(403);
});

// ─── TC-7.38 ─────────────────────────────────────────────────────────────────

it('TC-7.38: a TRIAL session is free (no invoice); converting to REGULAR keeps the parent to one row', function () {
    // A trial learner under the SAME guardian: a free taster that must never be billed, and must
    // never split off a second invoice row once the student converts (the reported bug).
    $trialStudent = $this->createStudent($this->academy, $this->guardian, ['status' => 'TRIAL']);

    $trialSession = $this->createSession($this->academy, $trialStudent, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$trialSession}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);

    // The trial attended but produced NO line item and NO invoice of its own.
    expect(DB::table('invoice_line_items')->where('session_id', $trialSession)->count())->toBe(0)
        ->and(DB::table('invoices')->where('academy_id', $this->academy)->where('student_id', $trialStudent)->count())->toBe(0);

    // Convert: an ACTIVE subscription in a currency that differs from the academy default (EGP),
    // proving the trial never opened a default-currency invoice that would now fail to merge.
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $trialStudent,
        'plan_label' => '1:1 USD',
        'price_minor' => 5000,
        'currency' => 'USD',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);
    DB::table('students')->where('id', $trialStudent)->update(['status' => 'REGULAR']);

    $regularSession = $this->createSession($this->academy, $trialStudent, $this->teacher, [
        'scheduled_at_utc' => '2026-06-03 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$regularSession}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);

    // Exactly ONE invoice for this guardian in the period — the trial did not create a second row.
    $invoices = DB::table('invoices')
        ->where('academy_id', $this->academy)
        ->where('guardian_id', $this->guardian)
        ->where('period_year', 2026)
        ->where('period_month', 6)
        ->get();

    expect($invoices)->toHaveCount(1)
        ->and($invoices->first()->currency)->toBe('USD');

    $lineItems = DB::table('invoice_line_items')->where('invoice_id', $invoices->first()->id)->get();
    expect($lineItems)->toHaveCount(1)
        ->and((int) $lineItems->first()->amount_minor)->toBe(5000);
});

// ─── #12 — cancelled lessons listed for the record, never charged ─────────────

it('#12: cancelled lessons appear as zero-amount rows on the invoice detail without changing the total', function () {
    // One ATTENDED lesson opens the invoice and is the only charge (100 EGP).
    $attended = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$attended}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // Two cancelled lessons in the same period for the same student — one by each side.
    ($this->juneSession)(['scheduled_at_utc' => '2026-06-05 10:00:00+00', 'status' => 'CANCELLED_BY_STUDENT']);
    ($this->juneSession)(['scheduled_at_utc' => '2026-06-07 10:00:00+00', 'status' => 'CANCELLED_BY_TEACHER']);

    $invoice = ($this->openInvoice)();
    expect($invoice)->not->toBeNull();

    // No stored line items for the cancelled lessons — billing is untouched.
    $this->asAcademy($this->academy);
    $stored = DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->get();
    expect($stored)->toHaveCount(1)
        ->and((int) $invoice->total_minor)->toBe(10000)
        ->and((int) $invoice->subtotal_minor)->toBe(10000);

    // Internal detail surfaces all three lessons; the two cancelled ones are zero-amount.
    Sanctum::actingAs($this->owner);
    $res = $this->getJson("/api/invoices/{$invoice->id}")->assertOk();

    $lines = collect($res->json('lineItems'));
    expect($lines)->toHaveCount(3)
        ->and((int) $res->json('invoice.total_minor'))->toBe(10000);

    $cancelled = $lines->whereIn('session_status', ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_TEACHER'])->values();
    expect($cancelled)->toHaveCount(2)
        ->and($cancelled->every(fn ($li) => (int) $li['amount_minor'] === 0))->toBeTrue();
});

it('#12: cancelled lessons are listed on the public invoice page too', function () {
    $attended = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$attended}/attendance", ['status' => 'ATTENDED'])->assertOk();

    ($this->juneSession)(['scheduled_at_utc' => '2026-06-09 10:00:00+00', 'status' => 'CANCELLED_BY_STUDENT']);

    $this->asAcademy($this->academy);
    $token = ($this->openInvoice)()->public_token;

    $this->clearTenantContext();
    $res = $this->getJson("/api/i/{$token}")->assertOk();

    $items = collect($res->json('line_items'));
    expect($items)->toHaveCount(2)
        ->and((int) $res->json('total_minor'))->toBe(10000);

    $cancelled = $items->firstWhere('session_status', 'CANCELLED_BY_STUDENT');
    expect($cancelled)->not->toBeNull()
        ->and((int) $cancelled['amount_minor'])->toBe(0);
});

it('#12: a cancelled lesson in a different currency does not attach to an EGP invoice', function () {
    $attended = ($this->juneSession)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$attended}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // A second child of the same guardian billed in USD, with a cancelled USD lesson in the period.
    $usdStudent = $this->createStudent($this->academy, $this->guardian);
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $usdStudent,
        'plan_label' => '1:1 USD',
        'price_minor' => 5000,
        'currency' => 'USD',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);
    $this->createSession($this->academy, $usdStudent, $this->teacher, [
        'scheduled_at_utc' => '2026-06-08 10:00:00+00',
        'status' => 'CANCELLED_BY_STUDENT',
    ]);

    // The EGP invoice lists only its own lesson — the USD cancelled lesson stays off it.
    $egpInvoice = ($this->openInvoice)();
    Sanctum::actingAs($this->owner);
    $lines = collect($this->getJson("/api/invoices/{$egpInvoice->id}")->assertOk()->json('lineItems'));
    expect($lines)->toHaveCount(1)
        ->and($lines->pluck('student_id'))->not->toContain($usdStudent)
        ->and($lines->every(fn ($li) => $li['currency'] === 'EGP'))->toBeTrue();
});

// ─── Repricing an OPEN invoice after a mistyped rate ──────────────────────────

it('reprices already-billed sessions on an OPEN invoice when the hourly rate is corrected', function () {
    Sanctum::actingAs($this->owner);

    // The academy types the rate in wrong: 60.00 EGP/hr when it should be 100.00.
    $this->asAcademy($this->academy);
    DB::table('subscriptions')
        ->where('student_id', $this->student)
        ->update(['price_basis' => 'PER_HOUR', 'price_minor' => 6000]);

    // Two lessons get billed at the wrong rate: 60 min → 6 000, 90 min → 9 000.
    foreach ([['01', 60], ['02', 90]] as [$day, $duration]) {
        Sanctum::actingAs($this->owner);
        $s = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => "2026-06-{$day} 10:00:00+00",
            'duration_minutes' => $duration,
            'status' => 'SCHEDULED',
        ]);
        $this->postJson("/api/sessions/{$s}/attendance", ['status' => 'ATTENDED'])->assertOk();
    }

    expect((int) ($this->openInvoice)()->total_minor)->toBe(15000);

    // The mistake is spotted. Correct the rate to 100.00 EGP/hr, asking for the open invoice to
    // be recalculated too.
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/students/{$this->student}/subscription/price", [
        'price_minor' => 10000,
        'price_basis' => 'PER_HOUR',
        'reprice_open' => true,
    ])->assertOk()->assertJsonPath('repriced.sessions', 2)->assertJsonPath('repriced.invoices', 1);

    // 60 min → 10 000, 90 min → 15 000. The stale 15 000 total is gone.
    $this->asAcademy($this->academy);
    $invoice = ($this->openInvoice)();
    expect((int) $invoice->total_minor)->toBe(25000)
        ->and((int) $invoice->subtotal_minor)->toBe(25000)
        ->and((int) DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->sum('amount_minor'))->toBe(25000)
        ->and(DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->count())->toBe(2);
});

it('leaves already-billed sessions untouched when the rate changes without reprice_open', function () {
    Sanctum::actingAs($this->owner);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')
        ->where('student_id', $this->student)
        ->update(['price_basis' => 'PER_HOUR', 'price_minor' => 6000]);

    Sanctum::actingAs($this->owner);
    $s = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);
    $this->postJson("/api/sessions/{$s}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // A genuine mid-term rate rise: the lesson already taught keeps the price it was taught at.
    $this->patchJson("/api/students/{$this->student}/subscription/price", [
        'price_minor' => 10000,
        'price_basis' => 'PER_HOUR',
    ])->assertOk()->assertJsonPath('repriced.sessions', 0);

    $this->asAcademy($this->academy);
    expect((int) ($this->openInvoice)()->total_minor)->toBe(6000);
});

it('never reprices a CLOSED invoice, and reports how much a reprice would touch', function () {
    Sanctum::actingAs($this->owner);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')
        ->where('student_id', $this->student)
        ->update(['price_basis' => 'PER_HOUR', 'price_minor' => 6000]);

    Sanctum::actingAs($this->owner);
    $s = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);
    $this->postJson("/api/sessions/{$s}/attendance", ['status' => 'ATTENDED'])->assertOk();

    // While the invoice is OPEN the preview offers to recalculate the one billed session.
    $this->getJson("/api/students/{$this->student}/subscription/reprice-preview")
        ->assertOk()->assertJsonPath('sessions', 1)->assertJsonPath('invoices', 1);

    // Close it — the parent has now been sent this bill.
    $invoiceId = ($this->openInvoice)()->id;
    Sanctum::actingAs($this->owner);
    app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, $this->owner->id, 'ACADEMY_OWNER');

    // A closed bill is immutable: nothing left to reprice, and the total holds at the old rate.
    $this->getJson("/api/students/{$this->student}/subscription/reprice-preview")
        ->assertOk()->assertJsonPath('sessions', 0)->assertJsonPath('invoices', 0);

    $this->patchJson("/api/students/{$this->student}/subscription/price", [
        'price_minor' => 10000,
        'price_basis' => 'PER_HOUR',
        'reprice_open' => true,
    ])->assertOk()->assertJsonPath('repriced.sessions', 0);

    $this->asAcademy($this->academy);
    expect((int) DB::table('invoices')->where('id', $invoiceId)->value('total_minor'))->toBe(6000);
});
