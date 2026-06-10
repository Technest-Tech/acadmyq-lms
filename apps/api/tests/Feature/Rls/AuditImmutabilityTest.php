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
});

/** Insert a line item for a fresh session on the given invoice (under academy A context). */
function addLineItem(string $academyId, string $invoiceId, string $studentId, string $teacherId, int $amount = 10000): void
{
    $sessionId = test()->createSession($academyId, $studentId, $teacherId);
    DB::table('invoice_line_items')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'invoice_id' => $invoiceId,
        'session_id' => $sessionId,
        'student_id' => $studentId,
        'description' => 'Session',
        'amount_minor' => $amount,
        'currency' => 'EGP',
    ]);
}

// ── TC-1.17 (AC-1.7): audit_log accepts inserts under academy context ────────
it('accepts an audit_log insert under academy context', function () {
    $this->asAcademy($this->A);
    DB::table('audit_log')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->A,
        'action' => 'student.create',
        'entity_type' => 'student',
    ]);
    expect(DB::table('audit_log')->count())->toBe(1);
});

// ── TC-1.18 (AC-1.7): audit_log rejects UPDATE and DELETE (append-only) ───────
it('denies update and delete on audit_log', function () {
    $this->asAcademy($this->A);
    $id = (string) Str::uuid();
    DB::table('audit_log')->insert([
        'id' => $id, 'academy_id' => $this->A, 'action' => 'x', 'entity_type' => 'y',
    ]);

    // No UPDATE/DELETE policy under FORCE RLS → the rows are not mutable (0 affected).
    expect(DB::table('audit_log')->where('id', $id)->update(['action' => 'tampered']))->toBe(0);
    expect(DB::table('audit_log')->where('id', $id)->delete())->toBe(0);
    expect(DB::table('audit_log')->where('id', $id)->value('action'))->toBe('x');
});

// ── TC-1.19 (AC-1.8 baseline): line item + totals on an OPEN invoice ─────────
it('allows line items and total changes on an OPEN invoice', function () {
    [$invoiceId] = $this->createInvoice($this->A);
    $student = $this->createStudent($this->A);
    $teacher = $this->createTeacher($this->A);

    $this->asAcademy($this->A);
    addLineItem($this->A, $invoiceId, $student, $teacher, 10000);
    expect(DB::table('invoice_line_items')->where('invoice_id', $invoiceId)->count())->toBe(1);

    // OPEN invoices may have their totals maintained (Sprint 7 does this in app code).
    $affected = DB::table('invoices')->where('id', $invoiceId)
        ->update(['subtotal_minor' => 10000, 'total_minor' => 10000]);
    expect($affected)->toBe(1);
});

// ── TC-1.20 (AC-1.8, R-INV-3): no line items on a CLOSED invoice ─────────────
it('forbids adding a line item to a closed invoice', function () {
    [$invoiceId] = $this->createInvoice($this->A);
    $student = $this->createStudent($this->A);
    $teacher = $this->createTeacher($this->A);

    $this->asAcademy($this->A);
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    expect(fn () => addLineItem($this->A, $invoiceId, $student, $teacher))
        ->toThrow(QueryException::class, 'cannot add line item to non-open invoice');
});

// ── TC-1.21 (AC-1.8): a CLOSED invoice's totals are frozen ───────────────────
it('forbids changing totals on a closed invoice', function () {
    [$invoiceId] = $this->createInvoice($this->A);
    $this->asAcademy($this->A);
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    expect(fn () => DB::table('invoices')->where('id', $invoiceId)->update(['total_minor' => 999]))
        ->toThrow(QueryException::class, 'cannot modify totals of a non-open invoice');
});

// ── TC-1.22 (AC-1.8, R-INV-6): CLOSED → PAID is the one permitted move ───────
it('allows the closed-to-paid transition with a payment method', function () {
    [$invoiceId] = $this->createInvoice($this->A);
    $this->asAcademy($this->A);
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    $affected = DB::table('invoices')->where('id', $invoiceId)->update([
        'status' => 'PAID',
        'payment_method' => 'CASH',
        'payment_reason' => 'paid in person',
        'paid_at' => now(),
    ]);
    expect($affected)->toBe(1);
    expect(DB::table('invoices')->where('id', $invoiceId)->value('status'))->toBe('PAID');
});

// ── TC-1.22b (AC-1.15, §7.6): public invoice by token bypasses RLS narrowly ──
it('exposes one invoice by token while normal reads fail closed', function () {
    [$invoiceId, $token] = $this->createInvoice($this->A);
    $student = $this->createStudent($this->A);
    $teacher = $this->createTeacher($this->A);
    $this->asAcademy($this->A);
    addLineItem($this->A, $invoiceId, $student, $teacher, 25000);

    $this->clearTenantContext();

    // Normal read: fail closed.
    expect(DB::table('invoices')->count())->toBe(0);

    // Curated payload for the exact token.
    $payload = json_decode(
        DB::selectOne('select app.public_invoice_by_token(?) as p', [$token])->p,
        true
    );
    expect($payload)->not->toBeNull();
    expect($payload['currency'])->toBe('EGP');
    expect($payload['line_items'])->toHaveCount(1);
    expect($payload)->toHaveKey('academy_name');

    // Wrong token → NULL (no enumeration signal).
    expect(DB::selectOne('select app.public_invoice_by_token(?) as p', ['bogus'])->p)->toBeNull();
});
