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
});

it('subscription overview lists academies and the pending-proof queue', function () {
    $academyId = $this->createAcademy(overrides: ['status' => 'TRIAL']);
    // An OPEN bill + a PENDING payment proof.
    $billId = (string) Str::uuid();
    $this->asAcademy($academyId);
    DB::table('academy_invoices')->insert([
        'id' => $billId, 'academy_id' => $academyId,
        'period_start' => '2026-06-01', 'period_end' => '2026-06-30',
        'status' => 'OPEN', 'currency' => 'EGP', 'total_minor' => 50000,
        'due_date' => '2026-07-07', 'public_token' => Str::random(48),
    ]);
    DB::table('academy_payment_submissions')->insert([
        'id' => (string) Str::uuid(), 'academy_invoice_id' => $billId, 'academy_id' => $academyId,
        'method' => 'INSTAPAY', 'screenshot_path' => 'x/y.jpg', 'review_status' => 'PENDING',
    ]);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/subscriptions')->assertOk();

    $row = collect($res->json('academies'))->firstWhere('academy_id', $academyId);
    expect($row)->not->toBeNull();
    expect((int) $row['outstanding_minor'])->toBe(50000);
    expect(collect($res->json('pending_proofs'))->pluck('bill_id'))->toContain($billId);
});

it('automation overview reports toggles + has_token without leaking the token', function () {
    $academyId = $this->createAcademy();
    $this->asAcademy($academyId);
    DB::table('academy_automation_settings')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId,
        'wasender_token' => \Illuminate\Support\Facades\Crypt::encryptString('secret-token-xyz'),
        'type1_billing_enabled' => true,
        'created_at' => now(), 'updated_at' => now(),
    ]);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/automation')->assertOk();

    $row = collect($res->json('academies'))->firstWhere('academy_id', $academyId);
    expect($row['has_token'])->toBeTrue();
    expect($row['type1_billing_enabled'])->toBeTrue();
    expect(json_encode($res->json()))->not->toContain('secret-token-xyz');
});

it('forbids a non-admin from both overviews', function () {
    $academyId = $this->createAcademy();
    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->getJson('/api/admin/subscriptions')->assertForbidden();
    $this->getJson('/api/admin/automation')->assertForbidden();
});
