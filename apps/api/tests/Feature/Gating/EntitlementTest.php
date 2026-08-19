<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
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
 * Feature gating & limits under the module model (docs/superadmin-modules/05-MODULES-NOT-PACKAGES).
 * A client holds modules and gets everything they own; the revenue lever is the per-client switch in
 * the client profile. What the gate does with the answer is unchanged from Sprint 9: a feature the
 * client doesn't have is a 402-upgrade (never a 403), caps are enforced at create time, add-ons still
 * unlock extra keys, and entitlement fails closed.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    // A management client with everything on — the default a client is created in.
    $this->full = $this->createAcademy();
    $this->fullOwner = $this->makeUser($this->full, 'ACADEMY_OWNER');

    // …and one where we switched a single feature off from its profile.
    $this->trimmed = $this->createAcademy();
    $this->trimmedOwner = $this->makeUser($this->trimmed, 'ACADEMY_OWNER');
    switchOff($this->trimmed, 'MANAGEMENT', ['report_field.custom']);
});

/** Switch features off for one client, exactly as the client profile does. */
function switchOff(string $academyId, string $module, array $disabled): void
{
    test()->asAcademy($academyId, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($academyId, $module, $disabled);
    test()->clearTenantContext();
}

/** Cap one module for one client (absent ⇒ unlimited). */
function capClient(string $academyId, string $module, array $limits): void
{
    test()->asAcademy($academyId, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setLimitOverrides($academyId, $module, $limits);
    test()->clearTenantContext();
}

// ── A module grants everything it owns; a per-client switch is the only exception ──
it('allows a feature by default and answers 402-upgrade for the client we switched it off for', function () {
    $field = [
        'key' => 'memorized_pages', 'label_ar' => 'الصفحات', 'label_en' => 'Pages',
        'field_type' => 'NUMBER', 'sort_order' => 9,
    ];

    // Nothing was switched off → the client has it.
    Sanctum::actingAs($this->fullOwner);
    $this->postJson("/api/academies/{$this->full}/report-fields", $field)->assertCreated();

    // Switched off for this one client → 402 upgrade-required, NOT 403 forbidden.
    Sanctum::actingAs($this->trimmedOwner);
    $res = $this->postJson("/api/academies/{$this->trimmed}/report-fields", $field)->assertStatus(402);
    expect($res->json('error'))->toBe('upgrade_required');
    expect($res->json('feature'))->toBe('report_field.custom');
    expect($res->json('plan'))->toBe('MANAGEMENT'); // the client's type, not a package
});

// ── not-permitted = 403 forbidden; permitted-but-not-entitled = 402 upgrade ──────
it('keeps forbidden (permission) and upgrade (entitlement) as distinct responses', function () {
    $teacher = $this->makeUser($this->trimmed, 'TEACHER');
    $field = ['key' => 'k', 'label_ar' => 'ا', 'label_en' => 'k', 'field_type' => 'TEXT', 'sort_order' => 9];

    // A TEACHER lacks report_field.manage → 403 forbidden (RBAC layer).
    Sanctum::actingAs($teacher);
    $this->postJson("/api/academies/{$this->trimmed}/report-fields", $field)->assertForbidden();

    // The owner IS permitted, but we switched the feature off for this client → 402 upgrade.
    Sanctum::actingAs($this->trimmedOwner);
    $this->postJson("/api/academies/{$this->trimmed}/report-fields", $field)->assertStatus(402);
});

// ── Caps are per client and optional: uncapped until a Super Admin decides ────────
it('enforces a per-client student cap and never caps a client we left uncapped', function () {
    $capped = $this->createAcademy();
    capClient($capped, 'MANAGEMENT', ['maxStudents' => 1]);
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

    // The uncapped client can add as many as it likes.
    $g2 = $this->createGuardian($this->full);
    Sanctum::actingAs($this->fullOwner);
    foreach (['A', 'B', 'C'] as $n) {
        $this->postJson('/api/students', ['full_name' => $n, 'guardian_id' => $g2])->assertCreated();
    }
});

// ── the teacher cap works the same way ───────────────────────────────────────────
it('enforces a per-client teacher cap', function () {
    $capped = $this->createAcademy();
    capClient($capped, 'MANAGEMENT', ['maxTeachers' => 1]);
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

    // Grant to the full client.
    $this->postJson("/api/admin/academies/{$this->full}/addons", ['add_on_id' => $addOnId])->assertOk();
    Sanctum::actingAs($this->fullOwner);
    expect($this->getJson('/api/entitlements')->assertOk()->json('capabilities'))->toContain('whatsapp.auto');

    // Revoke (is_active=false) → re-locked.
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$this->full}/addons", ['add_on_id' => $addOnId, 'is_active' => false])->assertOk();
    Sanctum::actingAs($this->fullOwner);
    expect($this->getJson('/api/entitlements')->json('capabilities'))->not->toContain('whatsapp.auto');

    // Both the grant and the revoke are audited (AC-9.14).
    $this->enterAcademyAsSuperAdmin($this->full);
    expect(DB::table('audit_log')->where('action', 'academy.addon_changed')->where('entity_id', $addOnId)->count())->toBe(2);
});

// ── every feature switch is audited, and takes effect immediately ─────────────────
it('audits a per-client feature switch and applies it at once', function () {
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$this->full}/modules/management/features", [
        'disabled' => ['certificates'],
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($this->full);
    $row = DB::table('audit_log')->where('action', 'module_subscription.features')->first();
    expect($row)->not->toBeNull();
    expect(json_decode($row->after, true)['disabled'])->toBe(['certificates']);

    expect(Entitlement::resolve($this->full)['capabilities'])->not->toContain('certificates');
});

// ── TC-9.4: entitlement fails closed on an unknown key and for a module-less client ──
it('fails closed for an unknown feature key and for a client holding no modules', function () {
    // Entitlement::check always runs inside the request's own tenant context (academyId ==
    // current_academy_id), where the client row + its module subs are visible — so set it.
    $ctxFull = new AuthContext('u', $this->full, 'ACADEMY_OWNER', []);
    $this->asAcademy($this->full);
    expect(Entitlement::check($ctxFull, 'totally.unknown.key'))->toBeFalse();
    expect(Entitlement::check($ctxFull, 'report_field.custom'))->toBeTrue();

    // A client that holds no module at all resolves to no capabilities (fail closed) but
    // unlimited limits (fail open).
    $bare = $this->createAcademy(modules: []);
    $ctxBare = new AuthContext('u', $bare, 'ACADEMY_OWNER', []);
    $this->asAcademy($bare);
    expect(Entitlement::check($ctxBare, 'report_field.custom'))->toBeFalse();
    expect(Entitlement::withinLimit($ctxBare, 'maxStudents', 9999))->toBeTrue();

    // A Super Admin outside any client is never entitled (no client to read).
    $ctxSuper = new AuthContext('u', null, 'SUPER_ADMIN', []);
    expect(Entitlement::check($ctxSuper, 'report_field.custom'))->toBeFalse();
});

// ── switching a feature back on needs no deploy and no plan edit ──────────────────
it('restores a switched-off feature the moment the switch is cleared', function () {
    $field = ['key' => 'k2', 'label_ar' => 'ا', 'label_en' => 'k2', 'field_type' => 'TEXT', 'sort_order' => 9];

    Sanctum::actingAs($this->trimmedOwner);
    $this->postJson("/api/academies/{$this->trimmed}/report-fields", $field)->assertStatus(402);

    switchOff($this->trimmed, 'MANAGEMENT', []);

    Sanctum::actingAs($this->trimmedOwner);
    $this->postJson("/api/academies/{$this->trimmed}/report-fields", $field)->assertCreated();
});

// ── GET /api/entitlements exposes resolved capabilities, limits and usage ─────────
it('returns the resolved capabilities, limits and current usage', function () {
    $this->createStudent($this->trimmed);
    capClient($this->trimmed, 'MANAGEMENT', ['maxStudents' => 25]);

    Sanctum::actingAs($this->trimmedOwner);
    $res = $this->getJson('/api/entitlements')->assertOk();
    expect($res->json('plan'))->toBe('MANAGEMENT');
    expect($res->json('limits.maxStudents'))->toBe(25);
    expect($res->json('usage.students'))->toBe(1);
    // Everything the management module owns, minus the one feature we switched off.
    expect($res->json('capabilities'))->toContain('invoicing')->toContain('crm')
        ->not->toContain('report_field.custom');
});

// ── Module & add-on management is Super-Admin-only ────────────────────────────────
it('forbids an Owner from switching their own features or granting an add-on', function () {
    Sanctum::actingAs($this->fullOwner);
    $this->putJson("/api/admin/clients/{$this->full}/modules/management/features", ['disabled' => []])->assertForbidden();
    $this->postJson("/api/admin/academies/{$this->full}/addons", ['add_on_id' => (string) Str::uuid()])->assertForbidden();
});
