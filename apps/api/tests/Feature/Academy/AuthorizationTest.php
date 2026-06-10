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

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->A = $this->createAcademy();
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER');
    $this->teacherUser = $this->makeUser($this->A, 'TEACHER');
    $this->quranType = DB::table('academy_types')->where('code', 'QURAN')->value('id');
});

function createPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'X', 'academy_type_id' => test()->quranType,
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'owner_full_name' => 'O', 'owner_email' => 'x'.bin2hex(random_bytes(3)).'@t.test',
    ], $overrides);
}

// ── TC-3.19 / AC-3.9: an Owner cannot create an academy ───────────────────────
it('forbids an Owner from creating an academy', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/admin/academies', createPayload())->assertForbidden();
});

// ── TC-3.20 / AC-3.9: a Teacher cannot reach any /admin/* endpoint ────────────
it('forbids a Teacher from every admin endpoint', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->getJson('/api/admin/academies')->assertForbidden();
    $this->getJson('/api/admin/academy-types')->assertForbidden();
    $this->postJson('/api/admin/academies', createPayload())->assertForbidden();
    $this->getJson('/api/admin/plans')->assertForbidden();
    $this->postJson("/api/admin/academies/{$this->A}/suspend")->assertForbidden();
});

// ── TC-3.21 / AC-3.9: creating B while "in" A writes nothing into A ───────────
it('creates academy B in B\'s context even when the admin has entered A', function () {
    $usersInABefore = (function () {
        $this->enterAcademyAsSuperAdmin($this->A);

        return DB::table('users')->where('academy_id', $this->A)->count();
    })();

    Sanctum::actingAs($this->admin);
    $id = $this->withSession(['entered_academy_id' => $this->A])
        ->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/admin/academies', createPayload(['name' => 'Academy B']))
        ->assertCreated()->json('academyId');

    expect($id)->not->toBe($this->A);

    // The new owner landed in B, not A.
    $this->enterAcademyAsSuperAdmin($id);
    expect(DB::table('users')->where('academy_id', $id)->count())->toBe(1);

    // Academy A is untouched.
    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('users')->where('academy_id', $this->A)->count())->toBe($usersInABefore);
    expect(DB::table('report_field_definitions')->where('academy_id', $this->A)->count())->toBe(0);
});

// ── TC-3.24 / AC-3.8, AC-3.9: plan catalog CRUD works for admin; Owner 403 ────
it('allows plan catalog CRUD for the Super Admin and forbids the Owner', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/admin/plans')->assertForbidden();
    $this->postJson('/api/admin/plans', ['code' => 'X', 'name' => 'X', 'price_minor' => 0, 'currency' => 'USD'])
        ->assertForbidden();

    Sanctum::actingAs($this->admin);
    $this->getJson('/api/admin/plans')->assertOk()->assertJsonStructure(['plans', 'addOns']);
    $planId = $this->postJson('/api/admin/plans', [
        'code' => 'ENTERPRISE', 'name' => 'Enterprise', 'price_minor' => 9900, 'currency' => 'USD',
        'features' => ['payroll' => true],
    ])->assertCreated()->json('planId');

    $this->patchJson("/api/admin/plans/{$planId}", ['price_minor' => 12000])->assertOk();
    $this->asSuperAdmin();
    expect(DB::table('plans')->where('id', $planId)->value('price_minor'))->toBe(12000);
});
