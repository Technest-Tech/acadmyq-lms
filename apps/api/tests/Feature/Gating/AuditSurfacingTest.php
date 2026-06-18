<?php

declare(strict_types=1);

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
 * Sprint 9 §5 — audit log surfacing (TC-9.7–9.10). The read UI over the append-only
 * audit_log: owner sees own academy, Super Admin sees all, depth is plan-gated, and the
 * trail stays append-only on every path.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    $this->A = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER');

    $this->B = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->ownerB = $this->makeUser($this->B, 'ACADEMY_OWNER');
});

/** Insert an audit row directly in an academy's context (for date-depth fixtures). */
function seedAudit(string $academyId, string $action, ?string $actorId, $createdAt): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('audit_log')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'actor_user_id' => $actorId,
        'actor_role' => 'ACADEMY_OWNER',
        'action' => $action,
        'entity_type' => 'student',
        'entity_id' => (string) Str::uuid(),
        'after' => json_encode(['x' => 1]),
        'created_at' => $createdAt,
    ]);
    test()->clearTenantContext();
}

// ── TC-9.7: a sensitive action surfaces with actor/time/diff ─────────────────────
it('surfaces a price change in the audit UI with actor, time and before/after diff', function () {
    $guardian = $this->createGuardian($this->A);
    $student = $this->createStudent($this->A, $guardian);

    Sanctum::actingAs($this->ownerA);
    $this->putJson("/api/students/{$student}/subscription", [
        'plan_label' => 'Monthly', 'sessions_per_month' => 8, 'price_minor' => 80000,
        'currency' => 'EGP', 'price_basis' => 'PER_MONTH', 'start_date' => '2026-01-01',
    ])->assertOk();
    $this->patchJson("/api/students/{$student}/subscription/price", ['price_minor' => 95000])->assertOk();

    $rows = $this->getJson('/api/audit?action=subscription.price_changed')->assertOk()->json('rows');
    expect($rows)->not->toBeEmpty();
    $entry = $rows[0];
    expect($entry['action'])->toBe('subscription.price_changed');
    expect($entry['actor_user_id'])->toBe($this->ownerA->id);
    expect($entry['actor_name'])->toBe($this->ownerA->full_name);
    expect($entry['before']['price_minor'])->toBe(80000);
    expect($entry['after']['price_minor'])->toBe(95000);
    expect($entry['created_at'])->not->toBeNull();
});

// ── TC-9.8: owner sees only own academy; Super Admin sees all; no cross-leak ──────
it('scopes the owner audit to their academy while the Super Admin sees all', function () {
    // Each owner generates an audit row by creating a student.
    Sanctum::actingAs($this->ownerA);
    $gA = $this->createGuardian($this->A);
    Sanctum::actingAs($this->ownerA);
    $this->postJson('/api/students', ['full_name' => 'A-Stu', 'guardian_id' => $gA])->assertCreated();

    Sanctum::actingAs($this->ownerB);
    $gB = $this->createGuardian($this->B);
    Sanctum::actingAs($this->ownerB);
    $this->postJson('/api/students', ['full_name' => 'B-Stu', 'guardian_id' => $gB])->assertCreated();

    // Owner A sees only A's rows — never B's.
    Sanctum::actingAs($this->ownerA);
    $aRows = $this->getJson('/api/audit')->assertOk()->json('rows');
    expect($aRows)->not->toBeEmpty();
    expect(collect($aRows)->pluck('academy_id')->unique()->all())->toBe([$this->A]);

    // Super Admin (no entered academy) sees the whole platform via the audited escape hatch.
    Sanctum::actingAs($this->admin);
    $allAcademies = collect($this->getJson('/api/audit?action=student.create')->assertOk()->json('rows'))
        ->pluck('academy_id')->unique();
    expect($allAcademies)->toContain($this->A);
    expect($allAcademies)->toContain($this->B);
});

// ── TC-9.9: BASIC depth = last 30 days; PRO/audit.full = full history ─────────────
it('limits BASIC audit depth to 30 days and unlocks full history on PRO', function () {
    $basic = $this->createAcademy(overrides: ['plan_id' => $this->basicPlan]);
    $basicOwner = $this->makeUser($basic, 'ACADEMY_OWNER');

    seedAudit($basic, 'student.create', $basicOwner->id, now()->subDays(5));   // recent
    seedAudit($basic, 'student.create', $basicOwner->id, now()->subDays(60));  // old

    Sanctum::actingAs($basicOwner);
    $res = $this->getJson('/api/audit')->assertOk();
    expect($res->json('depthLimitedDays'))->toBe(30);
    expect($res->json('total'))->toBe(1); // only the recent row is visible to BASIC

    // PRO academy with an equally-old row → full history (no depth limit).
    seedAudit($this->A, 'student.create', $this->ownerA->id, now()->subDays(60));
    Sanctum::actingAs($this->ownerA);
    $proRes = $this->getJson('/api/audit?action=student.create')->assertOk();
    expect($proRes->json('depthLimitedDays'))->toBeNull();
    expect($proRes->json('total'))->toBeGreaterThanOrEqual(1);
});

// ── TC-9.10: the audit read path is read-only (append-only forever) ──────────────
it('exposes no write path on the audit endpoint', function () {
    Sanctum::actingAs($this->ownerA);
    $this->postJson('/api/audit', [])->assertStatus(405);
    $this->patchJson('/api/audit', [])->assertStatus(405);
    $this->deleteJson('/api/audit')->assertStatus(405);
});

// ── audit.read is required: a Teacher cannot read the audit log ──────────────────
it('forbids a Teacher from reading the audit log', function () {
    $teacher = $this->makeUser($this->A, 'TEACHER');
    Sanctum::actingAs($teacher);
    $this->getJson('/api/audit')->assertForbidden();
});
