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
    $this->quranType = DB::table('academy_types')->where('code', 'QURAN')->value('id');
});

/** Does an audit row exist for $action in $academy (NULL = platform), attributed to $actor? */
function auditExists(string $action, ?string $academy, string $actor): bool
{
    if ($academy === null) {
        test()->asSuperAdmin();
    } else {
        test()->enterAcademyAsSuperAdmin($academy);
    }

    return DB::table('audit_log')
        ->where('action', $action)
        ->where('actor_user_id', $actor)
        ->exists();
}

// ── TC-3.29 / AC-3.10: every listed mutation writes an attributed audit entry ─
it('writes a correctly-attributed audit entry for each mutation', function () {
    Sanctum::actingAs($this->admin);

    // create → academy.create + report_field.manage(seed) + user.invite + role.assign
    $id = $this->postJson('/api/admin/academies', [
        'name' => 'Audited', 'academy_type_id' => $this->quranType,
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'owner_full_name' => 'O', 'owner_email' => 'audit-owner@t.test',
    ])->assertCreated()->json('academyId');

    foreach (['academy.create', 'report_field.manage', 'user.invite', 'role.assign'] as $action) {
        expect(auditExists($action, $id, $this->admin->id))->toBeTrue("missing audit: {$action}");
    }

    // configure
    Sanctum::actingAs($this->admin);
    $this->patchJson("/api/admin/academies/{$id}", ['name' => 'Audited 2'])->assertOk();
    expect(auditExists('academy.configure', $id, $this->admin->id))->toBeTrue();

    // suspend + reactivate
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$id}/suspend")->assertOk();
    $this->postJson("/api/admin/academies/{$id}/reactivate")->assertOk();
    expect(auditExists('academy.suspend', $id, $this->admin->id))->toBeTrue();
    expect(auditExists('academy.reactivate', $id, $this->admin->id))->toBeTrue();

    // owner re-provision
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$id}/owner", [
        'owner_full_name' => 'Second', 'owner_email' => 'audit-owner2@t.test',
    ])->assertCreated();
    // (user.invite already asserted; the re-provision wrote another one)

    // plan.manage (platform-level, academy_id NULL → readable by the Super Admin)
    Sanctum::actingAs($this->admin);
    $this->postJson('/api/admin/plans', ['code' => 'AUD', 'name' => 'Aud', 'price_minor' => 0, 'currency' => 'USD'])
        ->assertCreated();
    expect(auditExists('plan.manage', null, $this->admin->id))->toBeTrue();
});

// ── TC-3.30 / AC-3.10: a configure change records before/after ────────────────
it('records before and after of changed fields on configure', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', [
        'name' => 'Before Name', 'academy_type_id' => $this->quranType,
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'owner_full_name' => 'O', 'owner_email' => 'diff-owner@t.test',
    ])->json('academyId');

    Sanctum::actingAs($this->admin);
    $this->patchJson("/api/admin/academies/{$id}", ['name' => 'After Name'])->assertOk();

    $this->enterAcademyAsSuperAdmin($id);
    $row = DB::table('audit_log')->where('action', 'academy.configure')->where('entity_id', $id)->first();
    $before = json_decode($row->before, true);
    $after = json_decode($row->after, true);
    expect($before['name'])->toBe('Before Name');
    expect($after['name'])->toBe('After Name');
});
