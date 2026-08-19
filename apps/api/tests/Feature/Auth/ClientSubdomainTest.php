<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * A client's own address (docs/lms/02). `<handle>.<root>` serves ONE of two products, and the two
 * halves of that promise are tested here: GET /api/site says which one (and hands the sign-in page
 * the client's branding), and POST /api/auth/login binds an attempt made through that door to the
 * client who owns it.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');

    // A management client: the school runs on the panel.
    $this->school = $this->createAcademy(overrides: [
        'plan_id' => $this->proPlan,
        'subdomain' => 'noorschool',
        'name' => 'Noor Academy',
        'brand_display_name' => 'Noor',
        'brand_logo_url' => 'https://cdn.test/noor.png',
    ]);

    // A course-platform client: the LMS is their whole product. What MARKS one is `lms.only`, and
    // which fact produces that marker is mid-migration — the LMS plan's capabilities today, and
    // `academies.client_type = 'LMS'` under docs/superadmin-modules/05. Set both, so the fixture
    // says "course-platform client" under either model.
    $this->courses = $this->createAcademy(overrides: array_merge([
        'plan_id' => $this->lmsPlan,
        'subdomain' => 'skillshub',
        'name' => 'Skills Hub',
    ], Schema::hasColumn('academies', 'client_type') ? ['client_type' => 'LMS'] : []));
});

/** SPA cookie auth needs the request to look like it came from the stateful frontend. */
function fromClientDoor()
{
    return test()->withHeader('Origin', 'http://localhost:3000');
}

// ── which product answers on the handle ──────────────────────────────────────
it('reports a management client as MANAGEMENT, with the branding its sign-in paints', function () {
    $this->withHeaders(['X-Academy' => 'noorschool'])
        ->getJson('/api/site')
        ->assertOk()
        ->assertJsonPath('kind', 'MANAGEMENT')
        ->assertJsonPath('academy.name', 'Noor Academy')
        ->assertJsonPath('academy.display_name', 'Noor')
        ->assertJsonPath('academy.logo_url', 'https://cdn.test/noor.png')
        ->assertJsonPath('academy.subdomain', 'noorschool');
});

it('reports a course-platform client as LMS', function () {
    $this->withHeaders(['X-Academy' => 'skillshub'])
        ->getJson('/api/site')
        ->assertOk()
        ->assertJsonPath('kind', 'LMS')
        // No brand name set ⇒ the display name falls back to the academy's own name.
        ->assertJsonPath('academy.display_name', 'Skills Hub');
});

it('404s a handle that belongs to no client', function () {
    $this->withHeaders(['X-Academy' => 'nobody'])->getJson('/api/site')->assertNotFound();
    $this->getJson('/api/site')->assertNotFound(); // no handle at all
});

// ── the door only opens for the client who owns it ───────────────────────────
it('signs in a client user through their own door', function () {
    $this->makeUser($this->school, 'ACADEMY_OWNER', ['email' => 'owner@noorschool.test']);

    fromClientDoor()
        ->postJson('/api/auth/login', [
            'email' => 'owner@noorschool.test', 'password' => 'password', 'subdomain' => 'noorschool',
        ])
        ->assertOk()
        ->assertJsonPath('academyId', $this->school);
});

it('refuses a valid user of another client at this door, and audits nothing', function () {
    $this->makeUser($this->courses, 'ACADEMY_OWNER', ['email' => 'owner@skillshub.test']);

    fromClientDoor()
        ->postJson('/api/auth/login', [
            'email' => 'owner@skillshub.test', 'password' => 'password', 'subdomain' => 'noorschool',
        ])
        ->assertStatus(422);

    $this->asAcademy($this->courses);
    expect(DB::table('audit_log')->where('action', 'auth.login')->count())->toBe(0);
});

it('refuses everyone at a handle that belongs to no client', function () {
    $this->makeUser($this->school, 'ACADEMY_OWNER', ['email' => 'owner2@noorschool.test']);

    fromClientDoor()
        ->postJson('/api/auth/login', [
            'email' => 'owner2@noorschool.test', 'password' => 'password', 'subdomain' => 'nobody',
        ])
        ->assertStatus(422);
});

it('lets a platform admin in at any door', function () {
    $this->makeUser(null, 'SUPER_ADMIN', ['email' => 'admin@platform.test']);

    fromClientDoor()
        ->postJson('/api/auth/login', [
            'email' => 'admin@platform.test', 'password' => 'password', 'subdomain' => 'noorschool',
        ])
        ->assertOk()
        ->assertJsonPath('role', 'SUPER_ADMIN');
});

it('leaves the platform login untouched when no handle is posted', function () {
    $this->makeUser($this->school, 'ACADEMY_OWNER', ['email' => 'owner3@noorschool.test']);

    fromClientDoor()
        ->postJson('/api/auth/login', ['email' => 'owner3@noorschool.test', 'password' => 'password'])
        ->assertOk();
});
