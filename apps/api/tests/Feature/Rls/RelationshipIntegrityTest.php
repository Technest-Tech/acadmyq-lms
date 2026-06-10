<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class);

beforeEach(function () {
    $this->A = $this->createAcademy();
    $this->student = $this->createStudent($this->A);
    $this->teacher = $this->createTeacher($this->A);
    $this->asAcademy($this->A);
});

function insertAssignment(string $academyId, string $studentId, string $teacherId, ?string $endedAt = null): void
{
    DB::table('student_teacher_assignments')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'student_id' => $studentId,
        'teacher_id' => $teacherId,
        'ended_at' => $endedAt,
    ]);
}

// ── TC-1.23 (AC-1.9, R-STU-3): only one active assignment per student ─────────
it('rejects a second active teacher assignment for one student', function () {
    insertAssignment($this->A, $this->student, $this->teacher);
    expect(fn () => insertAssignment($this->A, $this->student, $this->teacher))
        ->toThrow(QueryException::class);
});

// ── TC-1.24 (R-STU-3): closing the old assignment lets a new one be added ─────
it('allows a teacher change once the prior assignment is closed', function () {
    insertAssignment($this->A, $this->student, $this->teacher);
    DB::table('student_teacher_assignments')
        ->where('student_id', $this->student)
        ->update(['ended_at' => now()]);

    $teacher2 = $this->createTeacher($this->A);
    $this->asAcademy($this->A);
    insertAssignment($this->A, $this->student, $teacher2);

    expect(DB::table('student_teacher_assignments')->whereNull('ended_at')->count())->toBe(1);
});

// ── TC-1.25 (AC-1.11, R-BIL-1): idempotent invoice line items ────────────────
it('rejects a duplicate (invoice_id, session_id) line item', function () {
    [$invoiceId] = $this->createInvoice($this->A);
    $session = $this->createSession($this->A, $this->student, $this->teacher);
    $this->asAcademy($this->A);

    $line = fn () => DB::table('invoice_line_items')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'invoice_id' => $invoiceId,
        'session_id' => $session, 'student_id' => $this->student,
        'description' => 'Session', 'amount_minor' => 10000, 'currency' => 'EGP',
    ]);
    $line();
    expect($line)->toThrow(QueryException::class);
});

// ── TC-1.26 (AC-1.11): idempotent payout line items ──────────────────────────
it('rejects a duplicate (payout_id, session_id) payout line item', function () {
    $session = $this->createSession($this->A, $this->student, $this->teacher);
    $payoutId = (string) Str::uuid();
    $this->asAcademy($this->A);
    DB::table('payouts')->insert([
        'id' => $payoutId, 'academy_id' => $this->A, 'teacher_id' => $this->teacher,
        'period_year' => 2026, 'period_month' => 5, 'currency' => 'EGP',
    ]);

    $line = fn () => DB::table('payout_line_items')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'payout_id' => $payoutId,
        'session_id' => $session, 'amount_minor' => 5000, 'currency' => 'EGP',
    ]);
    $line();
    expect($line)->toThrow(QueryException::class);
});

// ── TC-1.27 (R-INV-4): an invoice must have exactly one payer ────────────────
// Split in two: a failing statement aborts the surrounding (RefreshDatabase) Postgres
// transaction, so each rejection case is its own test that ends on the failure.
it('rejects an invoice with neither payer reference', function () {
    expect(fn () => DB::table('invoices')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A,
        'period_year' => 2026, 'period_month' => 6, 'currency' => 'EGP',
        'public_token' => Str::random(40),
    ]))->toThrow(QueryException::class);
});

it('rejects an invoice with both payer references', function () {
    $guardian = $this->createGuardian($this->A);
    $student = $this->createStudent($this->A, $guardian);
    $this->asAcademy($this->A);
    expect(fn () => DB::table('invoices')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A,
        'period_year' => 2026, 'period_month' => 6, 'currency' => 'EGP',
        'public_token' => Str::random(40),
        'guardian_id' => $guardian, 'student_id' => $student,
    ]))->toThrow(QueryException::class);
});

// ── TC-1.28 (R-INV-1): one invoice per payer per period ──────────────────────
it('rejects two invoices for the same payer and period', function () {
    $guardian = $this->createGuardian($this->A);
    $this->createInvoice($this->A, $guardian, ['period_year' => 2026, 'period_month' => 7]);
    $this->asAcademy($this->A);

    expect(fn () => DB::table('invoices')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'guardian_id' => $guardian,
        'period_year' => 2026, 'period_month' => 7, 'currency' => 'EGP',
        'public_token' => Str::random(40),
    ]))->toThrow(QueryException::class);
});
