<?php

declare(strict_types=1);

use App\Jobs\ExpireAcademyTrialsJob;
use App\Services\AcademyBilling;
use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
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
});

/** Price the client's management module — where a client's money lives now (05 §5). */
function priceClient(string $academyId, int $priceMinor = 50000, string $currency = 'EGP'): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    app(ModuleBilling::class)->setPricing($academyId, 'MANAGEMENT', priceMinor: $priceMinor, currency: $currency);
    test()->clearTenantContext();
}

it("returns the subscription with the client's own module price", function () {
    $academyId = $this->createAcademy();
    priceClient($academyId, 50000, 'EGP');

    Sanctum::actingAs($this->admin);
    $res = $this->getJson("/api/admin/academies/{$academyId}/subscription")->assertOk();

    expect($res->json('subscription.total_cost_minor'))->toBe(50000);
    expect($res->json('subscription.base_price_minor'))->toBe(50000);
    expect($res->json('subscription.currency'))->toBe('EGP');
});

it('recomputes the total when we reprice a module', function () {
    $academyId = $this->createAcademy();
    priceClient($academyId, 30000, 'EGP');

    Sanctum::actingAs($this->admin);
    $this->getJson("/api/admin/academies/{$academyId}/subscription")->assertOk()
        ->assertJsonPath('subscription.total_cost_minor', 30000);

    $this->putJson("/api/admin/clients/{$academyId}/modules/management/subscription", [
        'price_minor' => 90000,
    ])->assertOk();

    $this->getJson("/api/admin/academies/{$academyId}/subscription")->assertOk()
        ->assertJsonPath('subscription.total_cost_minor', 90000);
});

it('extends a trial and records an audit', function () {
    $academyId = $this->createAcademy(overrides: ['status' => 'TRIAL']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$academyId}/subscription/trial/extend", ['days' => 30])->assertOk();

    $this->enterAcademyAsSuperAdmin($academyId);
    $sub = DB::table('academy_subscriptions')->where('academy_id', $academyId)->first();
    expect($sub->is_trial)->toBeTrue();
    expect(Carbon::parse($sub->trial_end)->isFuture())->toBeTrue();
    expect(DB::table('audit_log')->where('action', 'academy_subscription.trial_extended')->exists())->toBeTrue();
});

it('activates a trial into a paid subscription and flips the academy ACTIVE', function () {
    $academyId = $this->createAcademy(overrides: ['status' => 'TRIAL']);
    priceClient($academyId, 40000, 'EGP');

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$academyId}/subscription/activate")->assertOk()
        ->assertJsonPath('subscription.is_trial', false);

    $this->enterAcademyAsSuperAdmin($academyId);
    $sub = DB::table('academy_subscriptions')->where('academy_id', $academyId)->first();
    expect($sub->is_trial)->toBeFalse();
    expect($sub->activated_at)->not->toBeNull();
    expect($sub->current_period_end)->not->toBeNull();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('ACTIVE');
});

it('expires a lapsed trial: pauses the subscription and suspends the academy (idempotent)', function () {
    $academyId = $this->createAcademy(overrides: [
        'status' => 'TRIAL',
        'created_at' => now()->subDays(30),
    ]);

    // The module's own trial clock is what expires now (M-BILL-2) — lapse it.
    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->where('academy_id', $academyId)->update([
        'is_trial' => true, 'trial_start' => now()->subDays(30), 'trial_end' => now()->subDays(16),
    ]);
    $this->clearTenantContext();

    $job = new ExpireAcademyTrialsJob($academyId);
    $out = $job->handle(app(AcademyBilling::class), app(ModuleBilling::class));
    expect($out[$academyId]['expired'])->toBeTrue();
    expect($out[$academyId]['suspended'])->toBeTrue();

    $this->enterAcademyAsSuperAdmin($academyId);
    expect(DB::table('academy_subscriptions')->where('academy_id', $academyId)->value('status'))->toBe('PAUSED');
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('SUSPENDED');

    // Idempotent: a second run is a no-op (no error, still paused/suspended).
    $out2 = (new ExpireAcademyTrialsJob($academyId))->handle(app(AcademyBilling::class), app(ModuleBilling::class));
    expect($out2[$academyId]['expired'])->toBeFalse();
});

it('lets the owner read their own subscription but forbids the admin endpoint', function () {
    $academyId = $this->createAcademy(overrides: ['status' => 'TRIAL']);
    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->getJson('/api/my-subscription')->assertOk()
        ->assertJsonPath('subscription.academy_id', $academyId);

    // The owner must NOT reach the Super-Admin management endpoint.
    $this->getJson("/api/admin/academies/{$academyId}/subscription")->assertForbidden();
});
