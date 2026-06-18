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

/** Insert a catalog plan (Super Admin context) and return its id. */
function makeBillingPlan(string $code, int $price, string $currency): string
{
    $id = (string) Str::uuid();
    test()->asSuperAdmin();
    DB::table('plans')->insert([
        'id' => $id, 'code' => $code, 'name' => $code, 'price_minor' => $price,
        'currency' => $currency, 'features' => json_encode((object) []), 'is_active' => true,
    ]);

    return $id;
}

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    // Plans priced in KWD — a currency the demo data never uses, so the KWD MRR bucket
    // contains exactly these fixtures (clean isolation from seeded academies).
    $this->p5 = makeBillingPlan('KW5', 5000, 'KWD');
    $this->p10 = makeBillingPlan('KW10', 10000, 'KWD');

    $this->a1 = $this->createAcademy(null, null, ['plan_id' => $this->p5, 'status' => 'ACTIVE', 'billing_day' => 5]);
    $this->a2 = $this->createAcademy(null, null, ['plan_id' => $this->p10, 'status' => 'ACTIVE']);
    $this->a3 = $this->createAcademy(null, null, ['plan_id' => $this->p10, 'status' => 'SUSPENDED']);
    $this->a4 = $this->createAcademy(null, null, ['plan_id' => $this->p5, 'status' => 'TRIAL']);

    // A KWD add-on granted (active) to a1 only.
    $this->addOn = (string) Str::uuid();
    $this->asSuperAdmin();
    DB::table('add_ons')->insert([
        'id' => $this->addOn, 'code' => 'KWADD', 'name' => 'KW Add', 'price_minor' => 2000,
        'currency' => 'KWD', 'feature_key' => 'audit.full',
    ]);
    $this->enterAcademyAsSuperAdmin($this->a1);
    DB::table('academy_addons')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->a1, 'add_on_id' => $this->addOn,
        'is_active' => true, 'granted_at' => now(),
    ]);
});

// ── MRR is grouped per currency, ACTIVE academies only, plan + active add-ons ──
it('computes MRR per currency from active academies and their add-ons', function () {
    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/billing/overview')->assertOk();

    $mrr = collect($res->json('mrr'))->firstWhere('currency', 'KWD');
    // a1 (5000 + 2000 add-on) + a2 (10000) = 17000; a3 suspended & a4 trial excluded.
    expect($mrr['amount_minor'])->toBe(17000);
});

// ── Counts reconcile with the status breakdown ────────────────────────────────
it('reports academy counts by status', function () {
    Sanctum::actingAs($this->admin);
    $counts = $this->getJson('/api/admin/billing/overview')->assertOk()->json('counts');

    $this->asSuperAdmin();
    expect($counts['total'])->toBe(DB::table('academies')->count())
        ->and($counts['suspended'])->toBe(DB::table('academies')->where('status', 'SUSPENDED')->count());
});

// ── Per-academy row carries plan + add-on monthly value ───────────────────────
it('returns a per-academy billing row with monthly value', function () {
    Sanctum::actingAs($this->admin);
    $rows = $this->getJson('/api/admin/billing/overview')->assertOk()->json('academies');

    $row = collect($rows)->firstWhere('id', $this->a1);
    expect($row['monthly_minor'])->toBe(7000)
        ->and($row['active_addons'])->toBe(1)
        ->and($row['currency'])->toBe('KWD')
        ->and($row['billing_day'])->toBe(5);
});

// ── Two-layer authz ───────────────────────────────────────────────────────────
it('forbids an Owner from the billing overview', function () {
    $owner = $this->makeUser($this->a1, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);
    $this->getJson('/api/admin/billing/overview')->assertForbidden();
});
