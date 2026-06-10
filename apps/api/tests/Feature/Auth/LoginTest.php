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
    $this->academy = $this->createAcademy();
});

/** SPA cookie auth needs the request to look like it came from the stateful frontend. */
function fromFrontend()
{
    return test()->withHeader('Origin', 'http://localhost:3000');
}

// ── TC-2.1 / AC-2.1: valid Owner credentials → 200 + role, audits auth.login ──
it('logs in an Owner with valid credentials and audits auth.login', function () {
    $owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-login@test.local']);

    fromFrontend()
        ->postJson('/api/auth/login', ['email' => 'owner-login@test.local', 'password' => 'password'])
        ->assertOk()
        ->assertJsonPath('role', 'ACADEMY_OWNER')
        ->assertJsonPath('academyId', $this->academy);

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')
        ->where('action', 'auth.login')
        ->where('actor_user_id', $owner->id)
        ->exists())->toBeTrue();
});

// ── TC-2.2 / AC-2.1, AC-2.13: wrong password → rejected, no session/context ───
it('rejects an invalid password with no session and no audit', function () {
    $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner2@test.local']);

    fromFrontend()
        ->postJson('/api/auth/login', ['email' => 'owner2@test.local', 'password' => 'wrong'])
        ->assertStatus(422);

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'auth.login')->count())->toBe(0);
});

// ── TC-2.11 / AC-2.13: an inactive account cannot log in (fail closed) ────────
it('refuses login for an inactive account', function () {
    $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'inactive@test.local', 'is_active' => false]);

    fromFrontend()
        ->postJson('/api/auth/login', ['email' => 'inactive@test.local', 'password' => 'password'])
        ->assertStatus(403);
});

// ── TC-2.3 / TC-2.27 / AC-2.7: logout invalidates session and audits ─────────
it('logs out and writes an auth.logout audit entry', function () {
    $owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    fromFrontend()->postJson('/api/auth/logout')->assertOk()->assertJsonPath('ok', true);

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')
        ->where('action', 'auth.logout')
        ->where('actor_user_id', $owner->id)
        ->exists())->toBeTrue();
});
