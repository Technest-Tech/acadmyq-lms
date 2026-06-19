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

/**
 * Sprint 9 §4 — plan/tier feature gating & limits (TC-9.1–9.6, TC-9.27). The revenue model:
 * a PRO-only feature is usable on PRO and a 402-upgrade (never a 403) on BASIC; numeric caps
 * are enforced at create time; add-ons unlock extra capabilities; entitlement fails closed.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');
    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER');

    $this->basic = $this->createAcademy(overrides: ['plan_id' => $this->basicPlan]);
    $this->basicOwner = $this->makeUser($this->basic, 'ACADEMY_OWNER');
});

/** Create a bespoke plan with the given features JSON and return its id (Super Admin write). */
function makePlan(array $features): string
{
    $id = (string) Str::uuid();
    test()->asSuperAdmin();
    DB::table('plans')->insert([
        'id' => $id,
        'code' => 'P-'.substr($id, 0, 8),
        'name' => 'Test Plan',
        'price_minor' => 0,
        'currency' => 'USD',
        'features' => json_encode($features),
        'is_active' => true,
    ]);

    return $id;
}

// ── TC-9.1 + TC-9.5 distinction: PRO-only feature allowed on PRO, 402 on BASIC ──
it('allows a PRO-only feature on PRO and blocks it on BASIC with a distinct upgrade response', function () {
    $field = [
        'key' => 'memorized_pages', 'label_ar' => 'الصفحات', 'label_en' => 'Pages',
        'field_type' => 'NUMBER', 'sort_order' => 9,
    ];

    // PRO academy → allowed.
    Sanctum::actingAs($this->proOwner);
    $this->postJson("/api/academies/{$this->pro}/report-fields", $field)->assertCreated();

    // BASIC academy → 402 upgrade-required, NOT 403 forbidden (AC-9.1 / AC-9.5).
    Sanctum::actingAs($this->basicOwner);
    $res = $this->postJson("/api/academies/{$this->basic}/report-fields", $field)->assertStatus(402);
    expect($res->json('error'))->toBe('upgrade_required');
    expect($res->json('feature'))->toBe('report_field.custom');
    expect($res->json('plan'))->toBe('BASIC');
});

// ── TC-9.6: not-permitted = 403 forbidden; permitted-but-not-entitled = 402 upgrade ──
it('keeps forbidden (permission) and upgrade (entitlement) as distinct responses', function () {
    $teacher = $this->makeUser($this->basic, 'TEACHER');
    $field = ['key' => 'k', 'label_ar' => 'ا', 'label_en' => 'k', 'field_type' => 'TEXT', 'sort_order' => 9];

    // A TEACHER lacks report_field.manage → 403 forbidden (RBAC layer).
    Sanctum::actingAs($teacher);
    $this->postJson("/api/academies/{$this->basic}/report-fields", $field)->assertForbidden();

    // The BASIC owner IS permitted but the plan does not include it → 402 upgrade (entitlement).
    Sanctum::actingAs($this->basicOwner);
    $this->postJson("/api/academies/{$this->basic}/report-fields", $field)->assertStatus(402);
});

// ── TC-9.2: BASIC at student cap is blocked; PRO (unlimited) is not ──────────────
it('enforces the student cap on a capped plan and never on an unlimited one', function () {
    $cappedPlan = makePlan(['capabilities' => [], 'limits' => ['maxStudents' => 1]]);
    $capped = $this->createAcademy(overrides: ['plan_id' => $cappedPlan]);
    $owner = $this->makeUser($capped, 'ACADEMY_OWNER');
    $guardian = $this->createGuardian($capped);

    Sanctum::actingAs($owner);
    // 1st student is under the cap → allowed.
    $this->postJson('/api/students', ['full_name' => 'One', 'guardian_id' => $guardian])->assertCreated();
    // 2nd hits the cap → 422 with an at-limit/upgrade payload (distinct from 403).
    $res = $this->postJson('/api/students', ['full_name' => 'Two', 'guardian_id' => $guardian])->assertStatus(422);
    $payload = json_decode($res->json('errors.students.0'), true);
    expect($payload['error'])->toBe('plan_limit_reached');
    expect($payload['limit'])->toBe(1);
    expect($payload['message_ar'])->not->toBeEmpty();

    // PRO academy is unlimited — adding many never trips a cap.
    Sanctum::actingAs($this->proOwner);
    $g2 = $this->createGuardian($this->pro);
    Sanctum::actingAs($this->proOwner);
    foreach (['A', 'B', 'C'] as $n) {
        $this->postJson('/api/students', ['full_name' => $n, 'guardian_id' => $g2])->assertCreated();
    }
});

// ── TC-9.2 (teachers): the maxTeachers cap is enforced the same way ──────────────
it('enforces the teacher cap on a capped plan', function () {
    $cappedPlan = makePlan(['capabilities' => [], 'limits' => ['maxTeachers' => 1]]);
    $capped = $this->createAcademy(overrides: ['plan_id' => $cappedPlan]);
    $owner = $this->makeUser($capped, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->postJson('/api/teachers', ['full_name' => 'T1', 'session_rate_minor' => 5000, 'currency' => 'EGP'])->assertCreated();
    $this->postJson('/api/teachers', ['full_name' => 'T2', 'session_rate_minor' => 5000, 'currency' => 'EGP'])->assertStatus(422);
});

// ── TC-9.3 + TC-9.27: add-on grant unlocks a feature_key; revoke re-locks; both audited ──
it('unlocks an add-on feature on grant and re-locks on revoke, auditing each', function () {
    Sanctum::actingAs($this->admin);
    $addOnId = $this->postJson('/api/admin/add-ons', [
        'code' => 'WA', 'name' => 'Automated WhatsApp', 'price_minor' => 1000,
        'currency' => 'USD', 'feature_key' => 'whatsapp.auto',
    ])->assertCreated()->json('addOnId');

    // Grant to the PRO academy.
    $this->postJson("/api/admin/academies/{$this->pro}/addons", ['add_on_id' => $addOnId])->assertOk();
    Sanctum::actingAs($this->proOwner);
    expect($this->getJson('/api/entitlements')->assertOk()->json('capabilities'))->toContain('whatsapp.auto');

    // Revoke (is_active=false) → re-locked.
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->pro}/addons", ['add_on_id' => $addOnId, 'is_active' => false])->assertOk();
    Sanctum::actingAs($this->proOwner);
    expect($this->getJson('/api/entitlements')->json('capabilities'))->not->toContain('whatsapp.auto');

    // Both the grant and the revoke are audited (AC-9.14).
    $this->enterAcademyAsSuperAdmin($this->pro);
    expect(DB::table('audit_log')->where('action', 'academy.addon_changed')->where('entity_id', $addOnId)->count())->toBe(2);
});

// ── TC-9.27: a plan change is audited (before/after) ─────────────────────────────
it('audits a plan change with before and after', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->basic}/plan", ['plan_id' => $this->proPlan])->assertOk();

    $this->enterAcademyAsSuperAdmin($this->basic);
    $row = DB::table('audit_log')->where('action', 'academy.plan_changed')->where('entity_id', $this->basic)->first();
    expect($row)->not->toBeNull();
    expect(json_decode($row->before, true)['plan_id'])->toBe($this->basicPlan);
    expect(json_decode($row->after, true)['plan_id'])->toBe($this->proPlan);

    // And the new plan actually takes effect on the resolved entitlement.
    expect(Entitlement::resolve($this->basic)['plan'])->toBe('PRO');
});

// ── TC-9.4: entitlement fails closed on an unknown / misconfigured key ───────────
it('fails closed for an unknown feature key and for an academy with no plan', function () {
    // Entitlement::check always runs inside the request's own tenant context (academyId ==
    // current_academy_id), where the academy row + the plan catalog are visible — so set it.
    $ctxPro = new AuthContext('u', $this->pro, 'ACADEMY_OWNER', []);
    $this->asAcademy($this->pro);
    expect(Entitlement::check($ctxPro, 'totally.unknown.key'))->toBeFalse();
    expect(Entitlement::check($ctxPro, 'report_field.custom'))->toBeTrue();

    // An academy with no plan resolves to no capabilities (fail closed) but unlimited limits.
    $noPlan = $this->createAcademy();
    $ctxNoPlan = new AuthContext('u', $noPlan, 'ACADEMY_OWNER', []);
    $this->asAcademy($noPlan);
    expect(Entitlement::check($ctxNoPlan, 'report_field.custom'))->toBeFalse();
    expect(Entitlement::withinLimit($ctxNoPlan, 'maxStudents', 9999))->toBeTrue();

    // A Super Admin outside any academy is never entitled (no plan to read).
    $ctxSuper = new AuthContext('u', null, 'SUPER_ADMIN', []);
    expect(Entitlement::check($ctxSuper, 'report_field.custom'))->toBeFalse();
});

// ── TC-9.5: move a feature between tiers by editing data only (no deploy) ─────────
it('moves a feature between tiers via a plans.features data edit', function () {
    $field = ['key' => 'k2', 'label_ar' => 'ا', 'label_en' => 'k2', 'field_type' => 'TEXT', 'sort_order' => 9];

    // Initially BASIC cannot customise fields.
    Sanctum::actingAs($this->basicOwner);
    $this->postJson("/api/academies/{$this->basic}/report-fields", $field)->assertStatus(402);

    // Data edit: grant report_field.custom to the BASIC plan. No code/deploy.
    $this->asSuperAdmin();
    DB::table('plans')->where('id', $this->basicPlan)->update([
        'features' => json_encode(['capabilities' => ['report_field.custom'], 'limits' => ['maxStudents' => 30]]),
    ]);

    // Now BASIC academies gain the feature immediately.
    Sanctum::actingAs($this->basicOwner);
    $this->postJson("/api/academies/{$this->basic}/report-fields", $field)->assertCreated();
});

// ── GET /api/entitlements exposes resolved capabilities, limits and usage ─────────
it('returns the resolved plan capabilities, limits and current usage', function () {
    $this->createStudent($this->basic);

    Sanctum::actingAs($this->basicOwner);
    $res = $this->getJson('/api/entitlements')->assertOk();
    expect($res->json('plan'))->toBe('BASIC');
    expect($res->json('limits.maxStudents'))->toBe(25);
    expect($res->json('usage.students'))->toBe(1);
    // BASIC = core operations only (invoicing + payroll + WhatsApp automation); the PRO-only
    // features (staff, certificates, student_reports, audit.full, report_field.custom) stay locked.
    expect($res->json('capabilities'))->toBe(['invoicing', 'payroll', 'whatsapp.automation']);
});

// ── Plan/add-on management is Super-Admin-only (plan.manage) ──────────────────────
it('forbids an Owner from changing a plan or granting an add-on', function () {
    Sanctum::actingAs($this->basicOwner);
    $this->postJson("/api/admin/academies/{$this->basic}/plan", ['plan_id' => $this->proPlan])->assertForbidden();
    $this->postJson("/api/admin/academies/{$this->basic}/addons", ['add_on_id' => (string) Str::uuid()])->assertForbidden();
});
