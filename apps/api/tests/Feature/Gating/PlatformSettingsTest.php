<?php

declare(strict_types=1);

use App\Support\AuthContext;
use App\Support\Entitlement;
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

    // A PRO-style plan that grants audit.full, assigned to an academy.
    $this->plan = (string) Str::uuid();
    $this->asSuperAdmin();
    DB::table('plans')->insert([
        'id' => $this->plan, 'code' => 'PRO2', 'name' => 'Pro 2', 'price_minor' => 9900,
        'currency' => 'USD',
        'features' => json_encode(['capabilities' => ['audit.full'], 'limits' => []]),
        'is_active' => true,
    ]);
    $this->academy = $this->createAcademy(null, null, ['plan_id' => $this->plan, 'status' => 'ACTIVE']);
});

/** Resolve the academy's capabilities under a context that can read the catalogs. */
function resolveCaps(string $academyId): array
{
    test()->enterAcademyAsSuperAdmin($academyId);

    return Entitlement::resolve($academyId)['capabilities'];
}

// ── A disabled flag removes a plan-granted capability platform-wide ───────────
it('kill-switches a capability the plan grants when its flag is disabled', function () {
    // Granted while the flag is on (seeded enabled).
    expect(resolveCaps($this->academy))->toContain('audit.full');

    // Disable the flag via the API.
    Sanctum::actingAs($this->admin);
    $this->patchJson('/api/admin/feature-flags/audit.full', ['enabled' => false])->assertOk();

    // Now resolution excludes it even though the plan still lists it.
    expect(resolveCaps($this->academy))->not->toContain('audit.full');

    // Re-enabling restores it.
    Sanctum::actingAs($this->admin);
    $this->patchJson('/api/admin/feature-flags/audit.full', ['enabled' => true])->assertOk();
    expect(resolveCaps($this->academy))->toContain('audit.full');
});

// ── Flag list + audit ─────────────────────────────────────────────────────────
it('lists seeded feature flags and audits a toggle', function () {
    Sanctum::actingAs($this->admin);
    $flags = $this->getJson('/api/admin/feature-flags')->assertOk()->json('flags');
    expect(collect($flags)->pluck('key'))->toContain('audit.full')->toContain('report_field.custom');

    Sanctum::actingAs($this->admin);
    $this->patchJson('/api/admin/feature-flags/audit.full', ['enabled' => false])->assertOk();
    $this->asSuperAdmin();
    expect(DB::table('audit_log')->where('action', 'platform.feature_flag')->exists())->toBeTrue();
});

// ── Platform settings round-trip + audit ──────────────────────────────────────
it('upserts platform settings and reads them back', function () {
    Sanctum::actingAs($this->admin);
    $this->patchJson('/api/admin/settings', [
        'settings' => ['smtp_host' => 'mail.example.com', 'support_email' => 'help@x.test'],
    ])->assertOk();

    Sanctum::actingAs($this->admin);
    $settings = $this->getJson('/api/admin/settings')->assertOk()->json('settings');
    expect($settings['smtp_host'])->toBe('mail.example.com')
        ->and($settings['support_email'])->toBe('help@x.test');

    $this->asSuperAdmin();
    expect(DB::table('audit_log')->where('action', 'platform.settings')->exists())->toBeTrue();
});

// ── Two-layer authz: an Owner is forbidden everywhere ─────────────────────────
it('forbids an Owner from settings and feature flags', function () {
    $owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->getJson('/api/admin/feature-flags')->assertForbidden();
    $this->patchJson('/api/admin/feature-flags/audit.full', ['enabled' => false])->assertForbidden();
    $this->getJson('/api/admin/settings')->assertForbidden();
    $this->patchJson('/api/admin/settings', ['settings' => ['x' => 1]])->assertForbidden();
});
