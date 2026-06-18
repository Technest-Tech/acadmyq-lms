<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

// ─── Shared setup ────────────────────────────────────────────────────────────

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone'         => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
    ]);
    $this->owner       = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-man@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-man@test.local']);
    $this->teacher     = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id]);

    $this->guardian = $this->createGuardian($this->academy, [
        'whatsapp_phone' => '+201001234567',
        'currency'       => 'EGP',
    ]);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    // PER_HOUR subscription: 50 EGP / hour (5000 piastres).
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id'                 => (string) Str::uuid(),
        'academy_id'         => $this->academy,
        'student_id'         => $this->student,
        'plan_label'         => 'Hourly EGP',
        'price_minor'        => 5000,
        'currency'           => 'EGP',
        'price_basis'        => 'PER_HOUR',
        'sessions_per_month' => null,
        'status'             => 'ACTIVE',
        'start_date'         => '2026-01-01',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

// ─── Manual itemized invoices ────────────────────────────────────────────────

it('creates a MANUAL itemized invoice as an OPEN draft with summed total', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/invoices', [
        'payer_type'   => 'guardian',
        'payer_id'     => $this->guardian,
        'period_year'  => 2026,
        'period_month' => 6,
        'line_items'   => [
            ['description' => 'Registration fee', 'amount_minor' => 2500],
            ['description' => 'Textbook', 'amount_minor' => 1250],
        ],
    ])->assertCreated();

    $id = $res->json('id');

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $id)->first();

    expect($invoice->kind)->toBe('MANUAL')
        ->and($invoice->status)->toBe('OPEN')
        ->and((int) $invoice->total_minor)->toBe(3750)
        ->and((int) $invoice->subtotal_minor)->toBe(3750)
        ->and($invoice->guardian_id)->toBe($this->guardian)
        ->and($invoice->currency)->toBe('EGP');

    $lines = DB::table('invoice_line_items')->where('invoice_id', $id)->get();
    expect($lines)->toHaveCount(2)
        ->and($lines->whereNotNull('session_id'))->toHaveCount(0);
});

it('marks an OPEN manual bill as paid directly (no close step needed)', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/invoices', [
        'payer_type'   => 'guardian',
        'payer_id'     => $this->guardian,
        'period_year'  => 2026,
        'period_month' => 6,
        'line_items'   => [['description' => 'Registration', 'amount_minor' => 5000]],
    ])->assertCreated()->json('id');

    $this->postJson("/api/invoices/{$id}/mark-paid", [
        'payment_method' => 'CASH',
    ])->assertOk()->assertJson(['status' => 'PAID']);

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $id)->first();

    expect($invoice->status)->toBe('PAID')
        ->and($invoice->payment_method)->toBe('CASH')
        ->and((int) $invoice->amount_paid_minor)->toBe(5000)
        ->and($invoice->paid_at)->not->toBeNull();
});

it('defaults a student-payer manual invoice currency from the active subscription', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/invoices', [
        'payer_type'   => 'student',
        'payer_id'     => $this->student,
        'period_year'  => 2026,
        'period_month' => 6,
        'line_items'   => [['description' => 'Make-up lesson', 'amount_minor' => 6000]],
    ])->assertCreated()->json('id');

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $id)->first();

    expect($invoice->student_id)->toBe($this->student)
        ->and($invoice->guardian_id)->toBeNull()
        ->and($invoice->currency)->toBe('EGP');
});

it('does not collide with an existing AUTO invoice for the same payer/period', function () {
    // Seed an AUTO June invoice for the guardian (the partial unique index covers AUTO only).
    [$autoId] = $this->createInvoice($this->academy, $this->guardian, [
        'kind'         => 'AUTO',
        'period_year'  => 2026,
        'period_month' => 6,
    ]);

    Sanctum::actingAs($this->owner);

    $manualId = $this->postJson('/api/invoices', [
        'payer_type'   => 'guardian',
        'payer_id'     => $this->guardian,
        'period_year'  => 2026,
        'period_month' => 6,
        'line_items'   => [['description' => 'Extra charge', 'amount_minor' => 1000]],
    ])->assertCreated()->json('id');

    expect($manualId)->not->toBe($autoId);
});

it('rejects a manual invoice with no line items', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/invoices', [
        'payer_type'   => 'guardian',
        'payer_id'     => $this->guardian,
        'period_year'  => 2026,
        'period_month' => 6,
        'line_items'   => [],
    ])->assertStatus(422);
});

it('forbids a TEACHER from creating a manual invoice (invoice.create gate)', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->postJson('/api/invoices', [
        'payer_type'   => 'guardian',
        'payer_id'     => $this->guardian,
        'period_year'  => 2026,
        'period_month' => 6,
        'line_items'   => [['description' => 'x', 'amount_minor' => 100]],
    ])->assertStatus(403);
});

// ─── kind filter on the list ─────────────────────────────────────────────────

it('filters the invoice list by kind', function () {
    $this->createInvoice($this->academy, $this->guardian, [
        'kind'         => 'AUTO',
        'period_year'  => 2026,
        'period_month' => 6,
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/invoices', [
        'payer_type'   => 'guardian',
        'payer_id'     => $this->guardian,
        'period_year'  => 2026,
        'period_month' => 6,
        'line_items'   => [['description' => 'Extra', 'amount_minor' => 1000]],
    ])->assertCreated();

    $manual = $this->getJson('/api/invoices?filter[kind]=MANUAL')->assertOk()->json('rows');
    $auto   = $this->getJson('/api/invoices?filter[kind]=AUTO')->assertOk()->json('rows');

    expect($manual)->toHaveCount(1)
        ->and($manual[0]['kind'])->toBe('MANUAL')
        ->and($auto)->toHaveCount(1)
        ->and($auto[0]['kind'])->toBe('AUTO');
});

// ─── Advance payment ─────────────────────────────────────────────────────────

it('quotes only the still-billable sessions from the start date through month end', function () {
    // Two SCHEDULED 60-min sessions after the start date, one before it (excluded).
    $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-15 10:00:00+00',
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 10:00:00+00',
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 10:00:00+00', // before start_date → excluded
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);

    $quote = $this->getJson(
        "/api/invoices/advance-quote?student_id={$this->student}&start_date=2026-06-11",
    )->assertOk()->json();

    // 2 sessions × (5000 × 60/60) = 10000.
    expect($quote['count'])->toBe(2)
        ->and($quote['total_minor'])->toBe(10000)
        ->and($quote['currency'])->toBe('EGP')
        ->and($quote['lines'])->toHaveCount(2);
});

it('creates an advance MANUAL invoice and pre-bills the covered sessions', function () {
    $s1 = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-15 10:00:00+00',
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    $s2 = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 10:00:00+00',
        'duration_minutes' => 30,
        'status'           => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/invoices/advance', [
        'student_id' => $this->student,
        'start_date' => '2026-06-11',
    ])->assertCreated();

    $id = $res->json('id');
    expect($res->json('count'))->toBe(2);

    $this->asAcademy($this->academy);
    $invoice = DB::table('invoices')->where('id', $id)->first();

    // 5000 (60min) + 2500 (30min) = 7500.
    expect($invoice->kind)->toBe('MANUAL')
        ->and($invoice->status)->toBe('OPEN')
        ->and($invoice->student_id)->toBe($this->student)
        ->and((int) $invoice->total_minor)->toBe(7500);

    // Covered sessions are flagged billed=true so the auto hook never re-bills them.
    expect((bool) DB::table('sessions')->where('id', $s1)->value('billed'))->toBeTrue()
        ->and((bool) DB::table('sessions')->where('id', $s2)->value('billed'))->toBeTrue();

    $lines = DB::table('invoice_line_items')->where('invoice_id', $id)->get();
    expect($lines)->toHaveCount(2)
        ->and($lines->whereNotNull('session_id'))->toHaveCount(2);
});

it('returns 422 when there are no billable sessions to advance-bill', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/invoices/advance', [
        'student_id' => $this->student,
        'start_date' => '2026-06-11',
    ])->assertStatus(422);
});
