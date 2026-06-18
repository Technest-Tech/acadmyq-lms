<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Sprint 9 §6.1/§6.4/§6.7 — adversarial tenant isolation on the FINAL schema (TC-9.13,
 * TC-9.14), plus a release-gate re-assertion of closed-invoice & finalized-payout
 * immutability (TC-9.21/9.22). Cross-tenant invoice access (TC-9.13) is also covered by the
 * Sprint-7 suite (TC-7.31); here we extend the attack surface to the resources Sprint 9 added
 * (audit, academy_addons) and re-assert GUC no-leakage under in-connection context switching.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class); // seeds the permission catalog the HTTP gates need
    $this->clearTenantContext();

    $this->A = $this->createAcademy();
    $this->B = $this->createAcademy();

    // An add-on the platform offers, granted to A only.
    $this->addOnId = (string) Str::uuid();
    $this->asSuperAdmin();
    DB::table('add_ons')->insert([
        'id' => $this->addOnId, 'code' => 'WA', 'name' => 'WhatsApp',
        'price_minor' => 0, 'currency' => 'USD', 'feature_key' => 'whatsapp.auto',
    ]);
    $this->enterAcademyAsSuperAdmin($this->A);
    DB::table('academy_addons')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A,
        'add_on_id' => $this->addOnId, 'is_active' => true, 'granted_at' => now(),
    ]);
    $this->clearTenantContext();
});

// ── TC-9.14: GUC no-leakage under in-connection context switching ────────────────
it('never leaks rows across academies when the GUC context switches', function () {
    $this->createStudent($this->A);
    $this->createStudent($this->A);
    $this->createStudent($this->B);

    $this->asAcademy($this->A);
    expect(DB::table('students')->count())->toBe(2);

    $this->asAcademy($this->B);          // same connection, switched GUC
    expect(DB::table('students')->count())->toBe(1);

    $this->clearTenantContext();          // no context → fail closed
    expect(DB::table('students')->count())->toBe(0);
    expect(DB::table('academy_addons')->count())->toBe(0);
});

// ── TC-9.13: academy_addons is tenant-isolated (read + crafted write) ────────────
it('isolates academy_addons: B cannot read or forge A\'s add-on grants', function () {
    // A sees its grant; B sees none.
    $this->asAcademy($this->A);
    expect(DB::table('academy_addons')->count())->toBe(1);

    $this->asAcademy($this->B);
    expect(DB::table('academy_addons')->count())->toBe(0);
    // Even an explicit cross-tenant filter yields nothing (RLS, not an app where()).
    expect(DB::table('academy_addons')->where('academy_id', $this->A)->count())->toBe(0);

    // Forging a grant tagged for A while in B's context is rejected by `with check`.
    expect(fn () => DB::table('academy_addons')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A,
        'add_on_id' => $this->addOnId, 'is_active' => true, 'granted_at' => now(),
    ]))->toThrow(QueryException::class);
});

// ── TC-9.13: an owner's audit read never leaks another academy's entries ─────────
it('keeps an owner\'s audit read scoped even when filtering by another academy\'s actor', function () {
    $ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER');
    $ownerB = $this->makeUser($this->B, 'ACADEMY_OWNER');

    // B generates an audit row.
    Sanctum::actingAs($ownerB);
    $gB = $this->createGuardian($this->B);
    Sanctum::actingAs($ownerB);
    $this->postJson('/api/students', ['full_name' => 'B', 'guardian_id' => $gB])->assertCreated();

    // Owner A tries to surface B's activity by passing B's actor id — RLS still returns nothing.
    Sanctum::actingAs($ownerA);
    $rows = $this->getJson("/api/audit?actor={$ownerB->id}")->assertOk()->json('rows');
    expect($rows)->toBe([]);
});

// ── TC-9.21 (re-assert): a closed invoice is immutable to a line-item insert ─────
it('rejects adding a line item to a CLOSED invoice (DB trigger, release gate)', function () {
    [$invoice] = $this->createInvoice($this->A, overrides: ['status' => 'CLOSED', 'closed_at' => now()]);

    $this->asAcademy($this->A);
    expect(fn () => DB::table('invoice_line_items')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'invoice_id' => $invoice,
        'description' => 'smuggled', 'amount_minor' => 1, 'currency' => 'EGP',
    ]))->toThrow(QueryException::class, 'non-open invoice');
});

// ── TC-9.22 (re-assert): a finalized payout is immutable to a line-item insert ───
// A payout is finalized when finalized_at is not null (no status column); the DB trigger
// forbids both mutating the payout and adding/removing its line items once finalized.
it('rejects adding a line item to a FINALIZED payout (DB trigger, release gate)', function () {
    $teacher = $this->createTeacher($this->A);
    $payoutId = (string) Str::uuid();
    $this->asAcademy($this->A);
    DB::table('payouts')->insert([
        'id' => $payoutId, 'academy_id' => $this->A, 'teacher_id' => $teacher,
        'period_year' => 2026, 'period_month' => 5, 'total_minor' => 0,
        'currency' => 'EGP', 'finalized_at' => now(),
    ]);

    expect(fn () => DB::table('payout_line_items')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'payout_id' => $payoutId,
        'amount_minor' => 1, 'currency' => 'EGP',
    ]))->toThrow(QueryException::class, 'finalized payout');
});
