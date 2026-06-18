<?php

declare(strict_types=1);

use App\Jobs\ExpireAcademyTrialsJob;
use App\Services\AcademyBilling;
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
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

/** Create a platform plan (catalog) and return its id. */
function subTestMakePlan(int $priceMinor = 50000, string $currency = 'EGP', array $features = []): string
{
    $id = (string) Str::uuid();
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::table('plans')->insert([
        'id' => $id,
        'code' => 'PLAN-'.substr($id, 0, 8),
        'name' => 'Test Plan',
        'price_minor' => $priceMinor,
        'currency' => $currency,
        'features' => json_encode($features ?: ['capabilities' => [], 'limits' => []]),
        'is_active' => true,
    ]);

    return $id;
}

it('returns the subscription with a plan-based total cost', function () {
    $planId = subTestMakePlan(50000, 'EGP');
    $academyId = $this->createAcademy(overrides: ['plan_id' => $planId, 'status' => 'ACTIVE']);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson("/api/admin/academies/{$academyId}/subscription")->assertOk();

    expect($res->json('subscription.total_cost_minor'))->toBe(50000);
    expect($res->json('subscription.base_price_minor'))->toBe(50000);
    expect($res->json('subscription.currency'))->toBe('EGP');
    expect($res->json('plan.code'))->not->toBeNull();
});

it('recomputes the total when the plan changes', function () {
    $cheap = subTestMakePlan(30000, 'EGP');
    $pricey = subTestMakePlan(90000, 'EGP');
    $academyId = $this->createAcademy(overrides: ['plan_id' => $cheap, 'status' => 'ACTIVE']);

    Sanctum::actingAs($this->admin);
    $this->getJson("/api/admin/academies/{$academyId}/subscription")->assertOk()
        ->assertJsonPath('subscription.total_cost_minor', 30000);

    $this->postJson("/api/admin/academies/{$academyId}/plan", ['plan_id' => $pricey])->assertOk();

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
    expect(\Illuminate\Support\Carbon::parse($sub->trial_end)->isFuture())->toBeTrue();
    expect(DB::table('audit_log')->where('action', 'academy_subscription.trial_extended')->exists())->toBeTrue();
});

it('activates a trial into a paid subscription and flips the academy ACTIVE', function () {
    $planId = subTestMakePlan(40000, 'EGP');
    $academyId = $this->createAcademy(overrides: ['plan_id' => $planId, 'status' => 'TRIAL']);

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
    // created_at 30 days ago → trial_end = created_at + 14 days is in the past.
    $academyId = $this->createAcademy(overrides: [
        'status' => 'TRIAL',
        'created_at' => now()->subDays(30),
    ]);

    $job = new ExpireAcademyTrialsJob($academyId);
    $out = $job->handle(app(AcademyBilling::class));
    expect($out[$academyId]['expired'])->toBeTrue();
    expect($out[$academyId]['suspended'])->toBeTrue();

    $this->enterAcademyAsSuperAdmin($academyId);
    expect(DB::table('academy_subscriptions')->where('academy_id', $academyId)->value('status'))->toBe('PAUSED');
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->value('status'))->toBe('SUSPENDED');

    // Idempotent: a second run is a no-op (no error, still paused/suspended).
    $out2 = (new ExpireAcademyTrialsJob($academyId))->handle(app(AcademyBilling::class));
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
