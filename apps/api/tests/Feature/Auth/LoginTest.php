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

// ── Refusals that name their reason (the account exists; nothing to hide) ─────

it('refuses a user who has no role at all, with a code the sign-in screen can explain', function () {
    $orphan = $this->makeUser($this->academy, 'TEACHER', ['email' => 'orphan@test.local']);
    $this->asAcademy($this->academy);
    DB::table('user_roles')->where('user_id', $orphan->id)->delete();
    $this->clearTenantContext();

    fromFrontend()
        ->postJson('/api/auth/login', ['email' => 'orphan@test.local', 'password' => 'password'])
        ->assertStatus(403)
        ->assertJsonPath('code', 'no_role');

    // No session was left behind.
    $this->getJson('/api/auth/me')->assertStatus(401);
});

it('tells the owner of a suspended academy why they cannot sign in', function () {
    $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-susp@test.local']);
    $this->asSuperAdmin();
    DB::table('academies')->where('id', $this->academy)->update(['status' => 'SUSPENDED']);
    $this->clearTenantContext();

    fromFrontend()
        ->postJson('/api/auth/login', ['email' => 'owner-susp@test.local', 'password' => 'password'])
        ->assertStatus(403)
        ->assertJsonPath('code', 'academy_suspended');
});

it('locks out the holders of a custom role the academy switched off, at login and mid-session', function () {
    $roleId = (string) Str::uuid();
    $code = 'CR_'.str_replace('-', '', $roleId);
    $this->asAcademy($this->academy);
    DB::table('academy_roles')->insert([
        'id' => $roleId, 'academy_id' => $this->academy, 'code' => $code, 'name' => 'Front desk',
        'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
    ]);
    $permId = DB::table('permissions')->where('code', 'student.read')->value('id');
    DB::table('academy_role_permissions')->insert(['academy_id' => $this->academy, 'role_id' => $roleId, 'permission_id' => $permId]);
    $this->clearTenantContext();

    $clerk = $this->makeUser($this->academy, $code, ['email' => 'clerk@test.local']);

    // Active: signs in, holds the role's capability, and /auth/me carries the role's NAME.
    fromFrontend()
        ->postJson('/api/auth/login', ['email' => 'clerk@test.local', 'password' => 'password'])
        ->assertOk()
        ->assertJsonPath('role', $code);
    Sanctum::actingAs($clerk);
    $this->getJson('/api/auth/me')->assertOk()
        ->assertJsonPath('roleName', 'Front desk')
        ->assertJsonPath('permissions.0', 'student.read');

    // Switched off: the live session dies with a reason…
    $this->asAcademy($this->academy);
    DB::table('academy_roles')->where('id', $roleId)->update(['is_active' => false]);
    $this->clearTenantContext();
    $this->getJson('/api/auth/me')->assertStatus(401);

    // …and a fresh sign-in is refused with the same reason.
    fromFrontend()
        ->postJson('/api/auth/login', ['email' => 'clerk@test.local', 'password' => 'password'])
        ->assertStatus(403)
        ->assertJsonPath('code', 'role_inactive');
});
