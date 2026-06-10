<?php

declare(strict_types=1);

use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * A test-only probe behind the real authenticated middleware stack. It reports the live
 * GUC values (read from inside the request's transaction) and a tenant row count, so we can
 * observe exactly what RLS sees during an authenticated request — without leaking such a
 * route into the production surface.
 */
beforeEach(function () {
    Route::middleware(['auth:sanctum', 'tenant.context'])->get('/api/_probe/context', function () {
        return response()->json([
            'academy_id' => DB::selectOne("select current_setting('app.current_academy_id', true) as v")->v,
            'role' => DB::selectOne("select current_setting('app.current_role', true) as v")->v,
            'in_transaction' => DB::transactionLevel() > 0,
            'students' => DB::table('students')->count(),
        ]);
    });

    $this->A = $this->createAcademy();
    $this->B = $this->createAcademy();
    $this->createStudent($this->A);
    $this->createStudent($this->A);
    $this->createStudent($this->B);
    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER');
    $this->ownerB = $this->makeUser($this->B, 'ACADEMY_OWNER');
});

// ── TC-2.7 / AC-2.3: Owner of A sees only A's students under real auth ────────
it('scopes tenant reads to the logged-in Owner\'s academy', function () {
    Sanctum::actingAs($this->ownerA);

    $this->getJson('/api/_probe/context')
        ->assertOk()
        ->assertJsonPath('students', 2)
        ->assertJsonPath('academy_id', $this->A);
});

// ── TC-2.8 / AC-2.2: GUCs are set transaction-locally during the request ─────
it('sets the GUCs transaction-locally for the duration of the request', function () {
    // Baseline (outside any request): context is unset → fail-closed default.
    $this->clearTenantContext();
    expect(DB::selectOne("select current_setting('app.current_academy_id', true) as v")->v)->toBe('');

    Sanctum::actingAs($this->ownerA);
    $this->getJson('/api/_probe/context')
        ->assertJsonPath('academy_id', $this->A)   // set during the request
        ->assertJsonPath('in_transaction', true);  // inside the request transaction
    // In production the request transaction is top-level, so the GUC vanishes on commit
    // (set_config local => true). Under RefreshDatabase the request runs in a savepoint, so
    // we assert the during-request value rather than the post-commit teardown.
});

// ── TC-2.9 / AC-2.9: two different authenticated users never see each other ──
it('keeps two interleaved authenticated requests isolated (no GUC leakage)', function () {
    Sanctum::actingAs($this->ownerA);
    $this->getJson('/api/_probe/context')
        ->assertJsonPath('students', 2)
        ->assertJsonPath('academy_id', $this->A);

    // A fresh request as Owner B sets its own context, overwriting — it sees only B.
    Sanctum::actingAs($this->ownerB);
    $this->getJson('/api/_probe/context')
        ->assertJsonPath('students', 1)
        ->assertJsonPath('academy_id', $this->B);
});

// ── TC-2.12 / AC-2.2: only the sanctioned context path can read tenant rows ──
it('returns zero rows with no context and A\'s rows only via Tenancy::withContext', function () {
    $this->clearTenantContext();
    expect(DB::table('students')->count())->toBe(0); // background/no-context code → nothing

    $ctx = new AuthContext($this->ownerA->id, $this->A, 'ACADEMY_OWNER', []);
    $count = Tenancy::withContext($ctx, fn () => DB::table('students')->count());
    expect($count)->toBe(2);
});
