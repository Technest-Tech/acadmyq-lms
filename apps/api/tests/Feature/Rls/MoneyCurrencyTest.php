<?php

declare(strict_types=1);

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
});

// ── TC-1.29 (AC-1.10): minor units round-trip with no precision loss ─────────
it('stores and reads back a subscription price exactly', function () {
    $this->asAcademy($this->A);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'student_id' => $this->student,
        'plan_label' => '8/mo', 'price_minor' => 10000, 'currency' => 'EGP',
        'price_basis' => 'PER_MONTH', 'start_date' => '2026-01-01',
    ]);

    $row = DB::table('subscriptions')->where('student_id', $this->student)->first();
    expect($row->price_minor)->toBe(10000);
    expect($row->currency)->toBe('EGP');
});

// ── TC-1.30 (R-INV-3): a line snapshot is independent of the live price ──────
it('keeps the line-item snapshot when the subscription price later changes', function () {
    [$invoiceId] = $this->createInvoice($this->A);
    $session = $this->createSession($this->A, $this->student, $this->teacher);
    $this->asAcademy($this->A);

    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'student_id' => $this->student,
        'plan_label' => '8/mo', 'price_minor' => 10000, 'currency' => 'EGP',
        'price_basis' => 'PER_MONTH', 'start_date' => '2026-01-01',
    ]);
    DB::table('invoice_line_items')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'invoice_id' => $invoiceId,
        'session_id' => $session, 'student_id' => $this->student,
        'description' => 'Session', 'amount_minor' => 10000, 'currency' => 'EGP',
    ]);

    // Price changes later (Sprint 7 territory); the snapshot must NOT move.
    DB::table('subscriptions')->where('student_id', $this->student)->update(['price_minor' => 20000]);

    expect(DB::table('invoice_line_items')->where('invoice_id', $invoiceId)->value('amount_minor'))
        ->toBe(10000);
});
