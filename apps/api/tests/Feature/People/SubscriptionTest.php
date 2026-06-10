<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-sub@test.local']);
    $this->guardian = $this->createGuardian($this->academy);
    $this->student = $this->createStudent($this->academy, $this->guardian);
});

function setSub(string $student, array $overrides = [])
{
    return test()->putJson("/api/students/{$student}/subscription", array_merge([
        'plan_label' => '8 sessions/month',
        'sessions_per_month' => 8,
        'price_minor' => 10000,        // 100.00 EGP
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'start_date' => '2026-06-01',
    ], $overrides));
}

// ── TC-4.7 / AC-4.1: price stored exactly in minor units, readable back ──────
it('stores a subscription price exactly in minor units', function () {
    Sanctum::actingAs($this->owner);

    setSub($this->student)->assertOk();

    $this->asAcademy($this->academy);
    $sub = DB::table('subscriptions')->where('student_id', $this->student)->where('status', 'ACTIVE')->first();
    expect($sub->price_minor)->toBe(10000);
    expect($sub->price_basis)->toBe('PER_SESSION');
    expect((int) $sub->sessions_per_month)->toBe(8);

    Sanctum::actingAs($this->owner);
    expect($this->getJson("/api/students/{$this->student}")->json('subscription.price_minor'))->toBe(10000);
});

// ── TC-4.8 / AC-4.4: price change audits before/after, no back-dating ────────
it('changes the price with a before/after audit and never back-dates the start', function () {
    Sanctum::actingAs($this->owner);
    setSub($this->student)->assertOk();

    $this->patchJson("/api/students/{$this->student}/subscription/price", ['price_minor' => 12000])->assertOk();

    $this->asAcademy($this->academy);
    $sub = DB::table('subscriptions')->where('student_id', $this->student)->where('status', 'ACTIVE')->first();
    expect($sub->price_minor)->toBe(12000);
    expect((string) $sub->start_date)->toContain('2026-06-01');   // start untouched (forward-only)

    $audit = DB::table('audit_log')->where('action', 'subscription.price_changed')->where('entity_id', $sub->id)->first();
    expect(json_decode($audit->before, true)['price_minor'])->toBe(10000);
    expect(json_decode($audit->after, true)['price_minor'])->toBe(12000);
});

// ── TC-4.9 / AC-4.1: a second active subscription replaces, never duplicates ─
it('replaces rather than duplicates the active subscription', function () {
    Sanctum::actingAs($this->owner);
    setSub($this->student)->assertOk();
    setSub($this->student, ['plan_label' => '12 sessions/month', 'price_minor' => 13000])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('subscriptions')->where('student_id', $this->student)->where('status', 'ACTIVE')->count())->toBe(1);
    expect(DB::table('subscriptions')->where('student_id', $this->student)->where('status', 'ENDED')->count())->toBe(1);
    expect(DB::table('subscriptions')->where('student_id', $this->student)->where('status', 'ACTIVE')->value('price_minor'))->toBe(13000);
});

// ── TC-4.10 / AC-4.6: a subscription currency differing from the academy ─────
it('allows a subscription currency that differs from the academy default', function () {
    Sanctum::actingAs($this->owner);

    setSub($this->student, ['currency' => 'SAR'])->assertOk();   // SAR student in an EGP academy

    $this->asAcademy($this->academy);
    expect(DB::table('subscriptions')->where('student_id', $this->student)->where('status', 'ACTIVE')->value('currency'))->toBe('SAR');
});
