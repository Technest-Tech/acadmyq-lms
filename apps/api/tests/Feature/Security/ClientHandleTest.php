<?php

declare(strict_types=1);

use App\Support\Subdomain;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * A client handle is a LIVE HOSTNAME, not just a column (docs/lms/02, App\Support\Subdomain).
 *
 * Wildcard DNS means every accepted value immediately answers on the platform's own domain, so a
 * handle that shadows a platform host (`app`, `api`), an explicit DNS record (`media`, `turn`) or a
 * name that reads as the platform speaking (`login`, `billing`) is a defect the moment it is saved.
 * Both write paths — the academy form and the Super Admin's LMS subdomain editor — are covered,
 * because they were separately-written copies of the same rule before this.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->quranType = DB::table('academy_types')->where('code', 'QURAN')->value('id');
    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
});

/** A valid academy-creation payload; override per case. */
function handlePayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'Handle Test Academy',
        'academy_type_id' => test()->quranType,
        'plan_id' => test()->proPlan,
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'billing_day' => 1,
        'email' => 'owner-'.bin2hex(random_bytes(4)).'@handle.test',
        'password' => 'ownerpass123',
    ], $overrides);
}

it('refuses a handle that shadows a platform host', function (string $handle) {
    Sanctum::actingAs($this->admin);

    $this->postJson('/api/admin/academies', handlePayload(['subdomain' => $handle]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('subdomain');
})->with(['app', 'api', 'www', 'admin', 'media', 'turn', 'login', 'billing', 'secure']);

it('refuses a handle too short to be worth reserving, and punycode', function (string $handle) {
    Sanctum::actingAs($this->admin);

    $this->postJson('/api/admin/academies', handlePayload(['subdomain' => $handle]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('subdomain');
})->with(['ab', 'a', 'xn--80ak6aa92e', '-noor', 'noor-', 'No or', 'NOOR']);

it('still accepts an ordinary handle', function () {
    Sanctum::actingAs($this->admin);

    $id = $this->postJson('/api/admin/academies', handlePayload(['subdomain' => 'noor-academy']))
        ->assertCreated()
        ->json('academyId');

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $id)->value('subdomain'))->toBe('noor-academy');
});

it('applies the same rule in the Super Admin subdomain editor', function () {
    $academy = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS']);
    Sanctum::actingAs($this->admin);

    $this->putJson("/api/admin/lms/academies/{$academy}/subdomain", ['subdomain' => 'api'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('subdomain');

    $this->putJson("/api/admin/lms/academies/{$academy}/subdomain", ['subdomain' => 'skills-hub'])
        ->assertOk();

    // Detaching the site is still allowed — null means "no site published".
    $this->putJson("/api/admin/lms/academies/{$academy}/subdomain", ['subdomain' => null])
        ->assertOk();
});

it('keeps the two reserved lists honest about the platform hosts', function () {
    // The web middleware refuses to ROUTE these as tenants; the API must refuse to ISSUE them, or a
    // client ends up with an address that can never resolve and no error explaining why.
    foreach (['www', 'app', 'api', 'admin', 'mail', 'static', 'assets', 'cdn'] as $host) {
        expect(Subdomain::isReserved($host))->toBeTrue("'{$host}' is reserved by the web middleware");
    }
});
