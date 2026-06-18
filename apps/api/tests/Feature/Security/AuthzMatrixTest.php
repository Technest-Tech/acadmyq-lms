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

/**
 * Sprint 9 §6.3 — the authorization matrix (TC-9.19) and injection allowlists (TC-9.20).
 *
 * Every endpoint is asserted to have a guard: an unauthenticated caller is 401, and each role
 * is explicitly classified allow/deny. We assert the GUARD, not the happy-path payload: an
 * "allow" means the request gets PAST the auth/permission/entitlement layers (so a 422 for a
 * missing body still counts — the guard let it through), while a "deny" is 401/402/403. This
 * keeps the matrix about access control, not fixtures.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->A = $this->createAcademy(overrides: ['plan_id' => $proPlan]);

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER');
    $this->teacher = $this->makeUser($this->A, 'TEACHER');
});

dataset('endpoints', function () {
    // [method, uri(:A), expectations[role => allow|deny]]
    return [
        'audit read' => ['get', '/api/audit', ['owner' => 'allow', 'teacher' => 'deny', 'super' => 'allow']],
        'entitlements' => ['get', '/api/entitlements', ['owner' => 'allow', 'teacher' => 'allow', 'super' => 'allow']],
        'admin academies list' => ['get', '/api/admin/academies', ['owner' => 'deny', 'teacher' => 'deny', 'super' => 'allow']],
        'admin plans catalog' => ['get', '/api/admin/plans', ['owner' => 'deny', 'teacher' => 'deny', 'super' => 'allow']],
        'set academy plan' => ['post', '/api/admin/academies/:A/plan', ['owner' => 'deny', 'teacher' => 'deny', 'super' => 'allow']],
        'set academy addon' => ['post', '/api/admin/academies/:A/addons', ['owner' => 'deny', 'teacher' => 'deny', 'super' => 'allow']],
        'students list' => ['get', '/api/students', ['owner' => 'allow', 'teacher' => 'allow']],
        'students create' => ['post', '/api/students', ['owner' => 'allow', 'teacher' => 'deny']],
        'teachers list' => ['get', '/api/teachers', ['owner' => 'allow', 'teacher' => 'deny']],
        'teachers create' => ['post', '/api/teachers', ['owner' => 'allow', 'teacher' => 'deny']],
        'guardians list' => ['get', '/api/guardians', ['owner' => 'allow', 'teacher' => 'deny']],
        'invoices list' => ['get', '/api/invoices', ['owner' => 'allow', 'teacher' => 'deny']],
        'invoices close' => ['post', '/api/invoices/close', ['owner' => 'allow', 'teacher' => 'deny']],
        'payouts list' => ['get', '/api/payouts', ['owner' => 'allow', 'teacher' => 'deny']],
        'payouts finalize' => ['post', '/api/payouts/finalize', ['owner' => 'allow', 'teacher' => 'deny']],
        'my payouts (own)' => ['get', '/api/me/payouts', ['owner' => 'deny', 'teacher' => 'allow']],
        'profit summary' => ['get', '/api/reports/profit-summary', ['owner' => 'allow', 'teacher' => 'deny']],
        'specializations' => ['get', '/api/specializations', ['owner' => 'allow', 'teacher' => 'deny']],
    ];
});

it('enforces a guard on every endpoint for every role', function (string $method, string $uri, array $expect) {
    $uri = str_replace(':A', $this->A, $uri);
    $denied = [401, 402, 403];

    // Unauthenticated → always 401 (the auth layer fires before anything else).
    expect($this->json(strtoupper($method), $uri)->getStatusCode())->toBe(401, "unauth allowed into {$uri}");

    $users = ['owner' => $this->owner, 'teacher' => $this->teacher, 'super' => $this->admin];

    foreach ($expect as $role => $verdict) {
        Sanctum::actingAs($users[$role]);
        $status = $this->json(strtoupper($method), $uri)->getStatusCode();

        if ($verdict === 'deny') {
            expect($status)->toBeIn($denied, "{$role} should be DENIED {$method} {$uri} (got {$status})");
        } else {
            expect($status)->not->toBeIn($denied, "{$role} should be ALLOWED {$method} {$uri} (got {$status})");
        }
    }
})->with('endpoints');

// ── TC-9.20: sort/filter injection is rejected by the allowlist ──────────────────
it('rejects an unknown or crafted sort key with 422 (no SQL executes)', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/students?sort=not_a_column')->assertStatus(422);
    $this->getJson('/api/students?sort='.urlencode('full_name);drop table students;--'))->assertStatus(422);
});

it('ignores an unknown filter key instead of binding it into SQL', function () {
    Sanctum::actingAs($this->owner);
    // An unknown filter is silently dropped — the request still succeeds, no error, no SQL.
    $this->getJson('/api/students?filter[evil]='.urlencode("1' OR '1'='1"))->assertOk();
});

// ── TC-9.20: money inputs are integer-minor and range-checked ────────────────────
it('rejects non-integer / malicious money inputs on a teacher rate', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/teachers', [
        'full_name' => 'X', 'session_rate_minor' => '50; DROP TABLE teachers', 'currency' => 'EGP',
    ])->assertStatus(422);
    $this->postJson('/api/teachers', [
        'full_name' => 'X', 'session_rate_minor' => -5, 'currency' => 'EGP',
    ])->assertStatus(422);
});
