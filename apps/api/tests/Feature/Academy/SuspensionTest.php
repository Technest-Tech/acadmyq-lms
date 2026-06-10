<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->A = $this->createAcademy();
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER', ['email' => 'susp-owner@test.local']);
});

/** Attempt a stateful login for the academy owner. */
function ownerLogin(): TestResponse
{
    return test()->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => 'susp-owner@test.local', 'password' => 'password']);
}

// ── TC-3.15 / AC-3.6: suspend → status SUSPENDED + metadata, login blocked ────
it('suspends an academy and blocks its owner login', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->A}/suspend", ['reason' => 'non-payment'])
        ->assertOk()->assertJsonPath('status', 'SUSPENDED');

    $this->asSuperAdmin();
    $a = DB::table('academies')->where('id', $this->A)->first();
    expect($a->status)->toBe('SUSPENDED');
    expect($a->suspended_at)->not->toBeNull();
    expect($a->suspended_reason)->toBe('non-payment');

    // The owner's next login attempt is now blocked (clean session — no prior login).
    ownerLogin()->assertStatus(403);
});

// ── TC-3.16 / AC-3.6: suspended data is retained ──────────────────────────────
it('retains all academy data while suspended', function () {
    $this->createStudent($this->A);
    $this->createStudent($this->A);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->A}/suspend")->assertOk();

    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('students')->where('academy_id', $this->A)->count())->toBe(2);
});

// ── TC-3.17 / AC-3.6: reactivate → ACTIVE, login restored ─────────────────────
it('reactivates a suspended academy and restores login', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->A}/suspend")->assertOk();
    ownerLogin()->assertStatus(403);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->A}/reactivate")
        ->assertOk()->assertJsonPath('status', 'ACTIVE');

    $this->asSuperAdmin();
    $a = DB::table('academies')->where('id', $this->A)->first();
    expect($a->status)->toBe('ACTIVE');
    expect($a->suspended_at)->toBeNull();

    ownerLogin()->assertOk();
});

// ── TC-3.18 / §3.1: there is no academy hard-delete endpoint ──────────────────
it('exposes no hard-delete route for academies', function () {
    Sanctum::actingAs($this->admin);
    // GET and PATCH exist on this path; DELETE does not → 405 Method Not Allowed.
    $this->deleteJson("/api/admin/academies/{$this->A}")->assertStatus(405);
});

// ── AC-3.6: an already-open owner session dies the moment the academy suspends ─
it('blocks an authenticated owner request once the academy is suspended', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/auth/me')->assertOk();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->A}/suspend")->assertOk();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/auth/me')->assertStatus(403);
});
