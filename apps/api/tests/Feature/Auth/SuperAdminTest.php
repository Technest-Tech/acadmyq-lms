<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    // The 'api' group carries Sanctum's stateful (session) middleware, which the
    // entered-academy flow relies on; a bare middleware list would never start a session.
    Route::middleware(['api', 'auth:sanctum', 'tenant.context'])->get('/api/_probe/context', function () {
        return response()->json(['students' => DB::table('students')->count()]);
    });

    // Seed the capability catalog so SUPER_ADMIN actually has academy.enter / academy.read.
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->A = $this->createAcademy();
    $this->createStudent($this->A);
    $this->createStudent($this->A);

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER');
});

/** Stateful (session-bearing) request as a given user. */
function actingFrontend($user)
{
    Sanctum::actingAs($user);

    return test()->withHeader('Origin', 'http://localhost:3000');
}

// ── TC-2.19 / AC-2.6: Super Admin with no academy entered sees zero rows ─────
it('shows a Super Admin no tenant rows before entering an academy', function () {
    Sanctum::actingAs($this->admin);

    $this->getJson('/api/_probe/context')->assertOk()->assertJsonPath('students', 0);
});

// ── TC-2.20 / AC-2.6, AC-2.7: entering A grants A's rows + audits the action ─
it('lets a Super Admin enter academy A, see A\'s rows, and audits it', function () {
    // The enter action sets the session key and writes the audit entry.
    actingFrontend($this->admin)
        ->postJson("/api/admin/academies/{$this->A}/enter")
        ->assertOk()
        ->assertJsonPath('enteredAcademyId', $this->A);

    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('audit_log')
        ->where('action', 'admin.enter_academy')
        ->where('actor_user_id', $this->admin->id)
        ->where('entity_id', $this->A)
        ->exists())->toBeTrue();

    // With the academy "entered" (session), tenant queries now see A's rows.
    actingFrontend($this->admin)
        ->withSession(['entered_academy_id' => $this->A])
        ->getJson('/api/_probe/context')
        ->assertJsonPath('students', 2);
});

// ── TC-2.21 / AC-2.6: exiting returns to the no-tenant view ──────────────────
it('returns a Super Admin to zero rows after exiting', function () {
    // Entered → sees A.
    actingFrontend($this->admin)
        ->withSession(['entered_academy_id' => $this->A])
        ->getJson('/api/_probe/context')
        ->assertJsonPath('students', 2);

    actingFrontend($this->admin)->postJson('/api/admin/academies/exit')->assertOk();

    // No entered academy in session → back to zero.
    Sanctum::actingAs($this->admin);
    $this->getJson('/api/_probe/context')->assertJsonPath('students', 0);
});

// ── TC-2.22 / §4.4: academy list is Super-Admin-only, via the audited fn ─────
it('lists all academies for a Super Admin and 403s for an Owner', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/admin/academies')->assertForbidden();

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/academies')->assertOk();
    expect(collect($res->json('academies'))->pluck('id'))->toContain($this->A);
});
