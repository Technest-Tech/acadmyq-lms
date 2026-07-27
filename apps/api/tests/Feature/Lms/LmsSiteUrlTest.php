<?php

declare(strict_types=1);

use App\Support\LmsSite;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The learner-site URL contract (docs/lms/02). `LmsSite` is the single place that turns an academy's
 * `subdomain` handle into a link, and BOTH LMS surfaces (the client's own dashboard and the Super
 * Admin oversight page) must report the same shape — including the `configured` flag that tells the
 * UI whether it is looking at a real origin or the in-app fallback path.
 *
 * The regression this guards: with no root domain configured the API returns `/learn/<handle>`, a
 * path on the MAIN domain. That is correct behaviour, but presented as a site link it reads as
 * "the subdomain silently didn't work" — so `configured` must travel with the URL.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $this->academy = $this->createAcademy(overrides: ['plan_id' => $this->lmsPlan, 'subdomain' => 'coursesite']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

it('falls back to the in-app path when no root domain is configured', function () {
    config(['lms.site.root_domain' => '', 'lms.site.scheme' => 'https']);

    expect(LmsSite::url('coursesite'))->toBe('/learn/coursesite')
        ->and(LmsSite::configured())->toBeFalse()
        ->and(LmsSite::block('coursesite')['root_domain'])->toBeNull();
});

it('builds a real origin once a root domain is configured', function () {
    config(['lms.site.root_domain' => 'acadmyq.com', 'lms.site.scheme' => 'https']);

    expect(LmsSite::url('coursesite'))->toBe('https://coursesite.acadmyq.com')
        ->and(LmsSite::configured())->toBeTrue();
});

it('supports a scheme and a port for local development', function () {
    // What `make it work locally` produces: http + a dev port on the root domain.
    config(['lms.site.root_domain' => 'localhost:3000', 'lms.site.scheme' => 'http']);

    expect(LmsSite::url('coursesite'))->toBe('http://coursesite.localhost:3000');
});

it('never invents a URL for an academy with no handle', function () {
    config(['lms.site.root_domain' => 'acadmyq.com']);

    expect(LmsSite::url(null))->toBeNull()
        ->and(LmsSite::url(''))->toBeNull();
});

it('rejects a bogus scheme rather than emitting it into a link', function () {
    config(['lms.site.root_domain' => 'acadmyq.com', 'lms.site.scheme' => 'javascript']);

    expect(LmsSite::url('coursesite'))->toStartWith('https://');
});

it('reports the same site block on the client dashboard and the admin page', function () {
    config(['lms.site.root_domain' => 'localhost:3000', 'lms.site.scheme' => 'http']);

    Sanctum::actingAs($this->owner);
    $client = $this->getJson('/api/courses/dashboard')->assertOk()->json('site');
    app()['auth']->forgetGuards();

    Sanctum::actingAs($this->admin);
    $admin = $this->getJson("/api/admin/lms/academies/{$this->academy}")->assertOk()->json('site');

    expect($client['url'])->toBe('http://coursesite.localhost:3000')
        ->and($admin['url'])->toBe($client['url'])
        ->and($client['configured'])->toBeTrue()
        ->and($admin['configured'])->toBeTrue()
        ->and($admin['subdomain'])->toBe($client['subdomain']);
});

it('marks the site unconfigured on both surfaces when the root domain is empty', function () {
    config(['lms.site.root_domain' => '']);

    Sanctum::actingAs($this->owner);
    $client = $this->getJson('/api/courses/dashboard')->assertOk()->json('site');
    app()['auth']->forgetGuards();

    Sanctum::actingAs($this->admin);
    $admin = $this->getJson("/api/admin/lms/academies/{$this->academy}")->assertOk()->json('site');

    expect($client['configured'])->toBeFalse()
        ->and($admin['configured'])->toBeFalse()
        ->and($client['url'])->toBe('/learn/coursesite')
        ->and($admin['url'])->toBe('/learn/coursesite');
});
