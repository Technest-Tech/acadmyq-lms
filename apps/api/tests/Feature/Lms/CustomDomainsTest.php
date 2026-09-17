<?php

declare(strict_types=1);

use App\Support\CustomDomain;
use App\Support\LmsSite;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Client custom domains (docs/custom-domains) — a client answering on an address they own.
 *
 * Two halves are tested here because they fail in opposite directions:
 *
 *  - PROVISIONING, which must refuse more than it accepts. A host is unique platform-wide and
 *    resolves to a handle, so the interesting cases are all rejections: no handle to point at, a
 *    host under the platform's own root (two resolvers for one name), a host already claimed.
 *  - RESOLUTION, which must answer for LIVE rows and nothing else. A row is created long before it
 *    works, and a half-configured address that resolved anyway would render a client's site on a
 *    connection the browser rejects.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    config([
        'custom_domains.enabled' => true,
        'custom_domains.origin_ip' => '203.0.113.10',
        'custom_domains.cname_target' => 'connect.acadmyq.com',
        'lms.site.root_domain' => 'acadmyq.com',
        'lms.site.scheme' => 'https',
    ]);

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    // A school on the panel — its plan would put its SIGN-IN at the root of its host.
    $this->school = $this->createAcademy(overrides: ['name' => 'Noor', 'subdomain' => 'noorsch']);
    $this->owner = $this->makeUser($this->school, 'ACADEMY_OWNER');

    CustomDomain::forget();
    // No test touches the network: DNS answers whatever the case says it answers.
    CustomDomain::resolveWith(fn (string $host) => false);
});

afterEach(fn () => CustomDomain::resolveWith(null));

/** Read one domain row back, in its own academy's context. */
function readDomain(string $academyId, string $id): object
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $row = DB::table('academy_domains')->where('id', $id)->first();
    test()->clearTenantContext();

    return $row;
}

/** A domain row in whatever state the case needs — LIVE is normally set by the cert cron. */
function domainRow(string $academyId, string $host, string $kind = 'MANAGEMENT', string $status = 'LIVE'): string
{
    $id = (string) Str::uuid();
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('academy_domains')->insert([
        'id' => $id,
        'academy_id' => $academyId,
        'host' => $host,
        'kind' => $kind,
        'status' => $status,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    test()->clearTenantContext();
    CustomDomain::forget($host);

    return $id;
}

// ── Provisioning ─────────────────────────────────────────────────────────────

it('adds a domain, which starts out pointing nowhere', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->postJson("/api/admin/clients/{$this->school}/domains", [
        'host' => 'portal.noor.edu',
        'kind' => 'MANAGEMENT',
    ])->assertCreated();

    expect($res->json('domains.0.host'))->toBe('portal.noor.edu')
        // DNS does not point at 203.0.113.10, so the courtesy check leaves it waiting.
        ->and($res->json('domains.0.status'))->toBe('PENDING_DNS')
        ->and($res->json('domains.0.last_error'))->not->toBeNull()
        // The handle the address resolves to is shown beside it — a custom domain never replaces it.
        ->and($res->json('subdomain'))->toBe('noorsch')
        ->and($res->json('instructions.origin_ip'))->toBe('203.0.113.10');
});

it('refuses a client with no handle for the domain to point at', function () {
    Sanctum::actingAs($this->admin);
    $this->enterAcademyAsSuperAdmin($this->school);
    DB::table('academies')->where('id', $this->school)->update(['subdomain' => null]);
    $this->clearTenantContext();

    $this->postJson("/api/admin/clients/{$this->school}/domains", [
        'host' => 'portal.noor.edu', 'kind' => 'MANAGEMENT',
    ])->assertStatus(422)->assertJsonPath('errors.host.0', 'This client has no subdomain handle yet.');
});

it('refuses a host under the platform root — that address already has a resolver', function () {
    Sanctum::actingAs($this->admin);

    $this->postJson("/api/admin/clients/{$this->school}/domains", [
        'host' => 'noorsch.acadmyq.com', 'kind' => 'MANAGEMENT',
    ])->assertStatus(422)->assertJsonValidationErrors('host');
});

it('refuses a host another client already answers on', function () {
    $other = $this->createAcademy(overrides: ['name' => 'Other', 'subdomain' => 'other']);
    domainRow($other, 'portal.noor.edu');

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$this->school}/domains", [
        'host' => 'portal.noor.edu', 'kind' => 'MANAGEMENT',
    ])->assertStatus(422)->assertJsonValidationErrors('host');
});

it('refuses something that is not a hostname at all', function () {
    Sanctum::actingAs($this->admin);

    foreach (['not a host', 'localhost', 'noorsch', 'http://'] as $bad) {
        $this->postJson("/api/admin/clients/{$this->school}/domains", [
            'host' => $bad, 'kind' => 'MANAGEMENT',
        ])->assertStatus(422);
    }
});

it('is Super-Admin only', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/admin/clients/{$this->school}/domains")->assertForbidden();
    $this->postJson("/api/admin/clients/{$this->school}/domains", [
        'host' => 'portal.noor.edu', 'kind' => 'MANAGEMENT',
    ])->assertForbidden();
});

it('removes a domain, and the address stops resolving with it', function () {
    $id = domainRow($this->school, 'portal.noor.edu');
    expect(CustomDomain::resolve('portal.noor.edu'))->not->toBeNull();

    Sanctum::actingAs($this->admin);
    $this->deleteJson("/api/admin/clients/{$this->school}/domains/{$id}")
        ->assertOk()->assertJsonPath('domains', []);

    expect(CustomDomain::resolve('portal.noor.edu'))->toBeNull();
});

it('will not make a domain canonical before it is live', function () {
    $id = domainRow($this->school, 'portal.noor.edu', status: 'VERIFIED');

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$this->school}/domains/{$id}/primary")->assertStatus(422);
});

// ── Resolution ───────────────────────────────────────────────────────────────

it('resolves a live host to its client, and only while it is live', function () {
    domainRow($this->school, 'portal.noor.edu');

    expect(CustomDomain::resolve('portal.noor.edu')['academy_id'])->toBe($this->school)
        // The handle is the ANSWER — it is what every surface downstream carries on with.
        ->and(CustomDomain::resolve('portal.noor.edu')['subdomain'])->toBe('noorsch');

    $this->enterAcademyAsSuperAdmin($this->school);
    DB::table('academy_domains')->where('host', 'portal.noor.edu')->update(['status' => 'PENDING_DNS']);
    $this->clearTenantContext();
    CustomDomain::forget('portal.noor.edu');

    expect(CustomDomain::resolve('portal.noor.edu'))->toBeNull();
});

it('serves /api/site from a host, and lets the domain decide which product answers', function () {
    // The academy's PLAN says MANAGEMENT (it is not an lms.only client), but this address was
    // bought to be their course site — so the domain wins.
    domainRow($this->school, 'courses.noor.edu', kind: 'LMS');

    $res = $this->getJson('/api/site', ['X-Academy-Host' => 'courses.noor.edu'])->assertOk();

    expect($res->json('kind'))->toBe('LMS')
        ->and($res->json('academy.subdomain'))->toBe('noorsch');

    // Same client, reached by handle: the plan decides again, and says MANAGEMENT.
    expect($this->getJson('/api/site', ['X-Academy' => 'noorsch'])->assertOk()->json('kind'))
        ->toBe('MANAGEMENT');
});

it('404s a host nobody has claimed', function () {
    $this->getJson('/api/site', ['X-Academy-Host' => 'someone-elses.example'])->assertNotFound();
});

it('binds a sign-in on a custom domain to that client', function () {
    domainRow($this->school, 'portal.noor.edu');

    // The whole point: without this the branded door falls through to the PLATFORM login, where a
    // user of any academy could sign in on this client's page.
    expect(LmsSite::handleFromHost('portal.noor.edu'))->toBe('noorsch')
        ->and(LmsSite::handleFromHost('noorsch.acadmyq.com'))->toBe('noorsch')
        ->and(LmsSite::handleFromHost('someone-elses.example'))->toBeNull();
});

it('points the client at their own address once one is live', function () {
    domainRow($this->school, 'courses.noor.edu', kind: 'LMS');

    $this->enterAcademyAsSuperAdmin($this->school);
    $origin = CustomDomain::primaryOrigin($this->school, 'LMS');
    $this->clearTenantContext();

    expect($origin)->toBe('https://courses.noor.edu')
        // A domain bought to BE the course site owns the root of its host — no /learn/ suffix,
        // whatever the plan says about the platform subdomain.
        ->and(LmsSite::url('noorsch', false, $origin))->toBe('https://courses.noor.edu')
        ->and(LmsSite::url('noorsch', false))->toBe('https://noorsch.acadmyq.com/learn/noorsch');
});

it('stays invisible while the feature is switched off', function () {
    domainRow($this->school, 'portal.noor.edu');
    config(['custom_domains.enabled' => false]);
    CustomDomain::forget();

    expect(CustomDomain::resolve('portal.noor.edu'))->toBeNull()
        ->and(CustomDomain::liveHosts())->toBe([]);

    $this->getJson('/api/site', ['X-Academy-Host' => 'portal.noor.edu'])->assertNotFound();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$this->school}/domains", [
        'host' => 'new.noor.edu', 'kind' => 'MANAGEMENT',
    ])->assertStatus(422);
});

// ── The sweep that turns a waiting domain into a ready one ───────────────────

it('marks a waiting domain VERIFIED once it resolves to this server', function () {
    $id = domainRow($this->school, 'portal.noor.edu', status: 'PENDING_DNS');

    // Still pointing somewhere else: the sweep says so, in a sentence, and moves nothing.
    CustomDomain::resolveWith(fn () => ['198.51.100.7']);
    $this->artisan('domains:verify')->assertSuccessful();

    $row = readDomain($this->school, $id);
    expect($row->status)->toBe('PENDING_DNS')
        ->and($row->last_error)->toContain('198.51.100.7')
        ->and($row->last_checked_at)->not->toBeNull();

    // Now it points here — VERIFIED, which is the signal the certificate cron waits for.
    CustomDomain::resolveWith(fn () => ['203.0.113.10']);
    $this->artisan('domains:verify')->assertSuccessful();

    $row = readDomain($this->school, $id);
    expect($row->status)->toBe('VERIFIED')
        ->and($row->last_error)->toBeNull()
        ->and($row->verified_at)->not->toBeNull();

    // VERIFIED is not LIVE: nothing resolves until a certificate exists.
    expect(CustomDomain::resolve('portal.noor.edu'))->toBeNull();
});

it('does not walk a live domain backwards when DNS hiccups', function () {
    $id = domainRow($this->school, 'portal.noor.edu');

    CustomDomain::resolveWith(fn () => false);
    $this->artisan('domains:verify')->assertSuccessful();

    // A resolver blip must never take a working client site down.
    expect(readDomain($this->school, $id)->status)->toBe('LIVE');
});

it('retries a failed issuance only once an hour, to protect the ACME budget', function () {
    $id = domainRow($this->school, 'portal.noor.edu', status: 'FAILED');
    test()->enterAcademyAsSuperAdmin($this->school);
    DB::table('academy_domains')->where('id', $id)->update(['last_checked_at' => now()->subMinutes(5)]);
    test()->clearTenantContext();

    CustomDomain::resolveWith(fn () => ['203.0.113.10']);
    $this->artisan('domains:verify')->assertSuccessful();
    expect(readDomain($this->school, $id)->status)->toBe('FAILED');

    test()->enterAcademyAsSuperAdmin($this->school);
    DB::table('academy_domains')->where('id', $id)->update(['last_checked_at' => now()->subHours(2)]);
    test()->clearTenantContext();

    $this->artisan('domains:verify')->assertSuccessful();
    expect(readDomain($this->school, $id)->status)->toBe('VERIFIED');
});
