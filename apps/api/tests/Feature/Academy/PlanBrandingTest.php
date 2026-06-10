<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->quranType = DB::table('academy_types')->where('code', 'QURAN')->value('id');
    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
});

// ── TC-3.23 / AC-3.8: selecting PRO stores plan_id (no gating yet) ────────────
it('stores the selected plan on the academy without gating any feature', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', [
        'name' => 'Plan Academy', 'academy_type_id' => $this->quranType, 'plan_id' => $this->proPlan,
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'owner_full_name' => 'O', 'owner_email' => 'plan-owner@t.test',
    ])->assertCreated()->json('academyId');

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $id)->value('plan_id'))->toBe($this->proPlan);
});

// ── TC-3.25 / AC-3.11: currency change warns; existing money is untouched ─────
it('warns on a currency change and never alters existing subscriptions or invoices', function () {
    $A = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $student = $this->createStudent($A);

    // An existing subscription and a closed invoice, both in EGP.
    $this->asAcademy($A);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $A, 'student_id' => $student,
        'plan_label' => '8/mo', 'price_minor' => 80000, 'currency' => 'EGP',
        'price_basis' => 'PER_MONTH', 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);
    [$invoiceId] = $this->createInvoice($A);
    $this->asAcademy($A);
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    Sanctum::actingAs($this->admin);
    $res = $this->patchJson("/api/admin/academies/{$A}", ['default_currency' => 'USD'])->assertOk();
    expect($res->json('warning'))->not->toBeNull();

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $A)->value('default_currency'))->toBe('USD');
    $this->asAcademy($A);
    expect(DB::table('subscriptions')->where('academy_id', $A)->value('currency'))->toBe('EGP');
    expect(DB::table('invoices')->where('id', $invoiceId)->value('currency'))->toBe('EGP');
});

// ── TC-3.26 / AC-3.7: branding fields persist and read back ───────────────────
it('persists branding fields and reads them back', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', [
        'name' => 'Branded', 'academy_type_id' => $this->quranType,
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'brand_display_name' => 'Noor Academy', 'brand_logo_url' => 'https://cdn.test/logo.png',
        'subdomain' => 'branded-noor',
        'owner_full_name' => 'O', 'owner_email' => 'brand-owner@t.test',
    ])->assertCreated()->json('academyId');

    $res = $this->getJson("/api/admin/academies/{$id}")->assertOk()->json('academy');
    expect($res['brand_display_name'])->toBe('Noor Academy');
    expect($res['brand_logo_url'])->toBe('https://cdn.test/logo.png');
    expect($res['subdomain'])->toBe('branded-noor');
});
