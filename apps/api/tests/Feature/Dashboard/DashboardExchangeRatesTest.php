<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * GET /api/dashboard/exchange-rates — the home screen's money cards add every currency up in the
 * academy's own currency. The rates are not behind a module (the accounting and statistics routes
 * are), since every academy's dashboard shows money; they are behind a money reader.
 */
beforeEach(function () {
    $this->clearTenantContext();
    Cache::flush();
    // No plan on purpose: the route must answer without the accounting or statistics module.
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-fx@test.local']);
    $this->teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-fx@test.local']);
    $this->clearTenantContext();

    // One fake with a switch: a second Http::fake in a test would be ignored.
    $this->sourceDown = false;
    Http::fake(fn () => $this->sourceDown
        ? Http::response('down', 500)
        : Http::response(['result' => 'success', 'time_last_update_unix' => 1_790_000_000, 'base_code' => 'EGP', 'rates' => ['EGP' => 1, 'USD' => 0.02, 'KWD' => 0.0064]]));
});

it('gives the owner every rate into the home currency, without the accounting or statistics module', function () {
    Sanctum::actingAs($this->owner);

    $body = $this->getJson('/api/dashboard/exchange-rates')->assertOk()->json();

    expect($body['home'])->toBe('EGP')
        ->and($body['available'])->toBeTrue();
    $rates = collect($body['rates'])->pluck('to_home', 'currency');
    expect((float) $rates['USD'])->toBe(50.0)
        // The full list, not the statistics page's short one: a client can bill in anything.
        ->and($rates->has('KWD'))->toBeTrue()
        ->and($rates->has('EGP'))->toBeFalse();
});

it('keeps the rates from someone who reads neither bills nor salaries', function () {
    Sanctum::actingAs($this->teacher);

    $this->getJson('/api/dashboard/exchange-rates')->assertForbidden();
});

it('says the rates are unavailable instead of failing when the source is down', function () {
    $this->sourceDown = true;
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/dashboard/exchange-rates')
        ->assertOk()
        ->assertJson(['available' => false, 'rates' => []]);
});
