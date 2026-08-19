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
});

// ── Phase 1 / AC: the dashboard returns the platform KPI bundle ───────────────
it('returns platform stats and recent activity for a Super Admin', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->getJson('/api/admin/dashboard')->assertOk();

    $res->assertJsonStructure([
        'stats' => [
            'academies' => ['total', 'active', 'trial', 'suspended', 'recent'],
            'people' => ['students', 'teachers', 'guardians'],
            'module_distribution',
            'type_distribution',
        ],
        'recentActivity',
    ]);

    // Counts reconcile with the database (RLS-bypassing aggregate, super-admin view).
    $this->asSuperAdmin();
    expect($res->json('stats.academies.total'))
        ->toBe(DB::table('academies')->count());
});

// ── Revenue & subscription signals are bundled into the same single read ──────
it('bundles revenue, subscription and payment-review signals', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->getJson('/api/admin/dashboard')->assertOk();

    $res->assertJsonStructure([
        'billing' => ['mrr'],
        'subscriptions' => [
            'endingSoon',
            'endingSoonCount',
            'outstanding' => ['academies', 'totals'],
            'pendingProofs' => ['count', 'items'],
        ],
    ]);

    // The capped "ending soon" preview never exceeds its budget and is bounded by the full count.
    expect(count($res->json('subscriptions.endingSoon')))->toBeLessThanOrEqual(8)
        ->and($res->json('subscriptions.endingSoonCount'))
        ->toBeGreaterThanOrEqual(count($res->json('subscriptions.endingSoon')));
});

// ── The aggregate matches the academy-status breakdown exactly ────────────────
it('breaks academies down by status correctly', function () {
    $this->asSuperAdmin();
    $byStatus = DB::table('academies')
        ->selectRaw('status, count(*) as c')
        ->groupBy('status')
        ->pluck('c', 'status');

    Sanctum::actingAs($this->admin);
    $stats = $this->getJson('/api/admin/dashboard')->assertOk()->json('stats');

    expect($stats['academies']['active'])->toBe((int) ($byStatus['ACTIVE'] ?? 0))
        ->and($stats['academies']['trial'])->toBe((int) ($byStatus['TRIAL'] ?? 0))
        ->and($stats['academies']['suspended'])->toBe((int) ($byStatus['SUSPENDED'] ?? 0));
});

// ── Two-layer authz: non-super roles are forbidden ───────────────────────────
it('forbids an Owner from the platform dashboard', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/admin/dashboard')->assertForbidden();
});

it('forbids a Teacher from the platform dashboard', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/admin/dashboard')->assertForbidden();
});
