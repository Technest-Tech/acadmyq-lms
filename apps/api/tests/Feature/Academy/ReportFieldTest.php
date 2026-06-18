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

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    // Customising report fields is the PRO `report_field.custom` capability (Sprint 9 gating),
    // so A is provisioned on the PRO plan for these tests.
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->A = $this->createAcademy(overrides: ['plan_id' => $proPlan]);
    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER');
});

// ── TC-3.9 / AC-3.5: add a field → appears at the given sort_order ────────────
it('adds a new report field at the given sort order', function () {
    Sanctum::actingAs($this->ownerA);

    $this->postJson("/api/academies/{$this->A}/report-fields", [
        'key' => 'memorized_pages',
        'label_ar' => 'الصفحات المحفوظة',
        'label_en' => 'Pages memorized',
        'field_type' => 'NUMBER',
        'sort_order' => 7,
    ])->assertCreated();

    $list = $this->getJson("/api/academies/{$this->A}/report-fields")->assertOk()->json('reportFields');
    $field = collect($list)->firstWhere('key', 'memorized_pages');
    expect($field)->not->toBeNull();
    expect($field['sort_order'])->toBe(7);
});

// ── TC-3.10 / AC-3.5: a SELECT field with no options is rejected ──────────────
it('rejects a SELECT field with no options', function () {
    Sanctum::actingAs($this->ownerA);

    $this->postJson("/api/academies/{$this->A}/report-fields", [
        'key' => 'rating',
        'label_ar' => 'تقييم',
        'label_en' => 'Rating',
        'field_type' => 'SELECT',
    ])->assertStatus(422)->assertJsonValidationErrors('options');
});

// ── TC-3.11 / AC-3.5: a duplicate key for the same academy is rejected ────────
it('rejects a duplicate field key within an academy', function () {
    Sanctum::actingAs($this->ownerA);

    $payload = ['key' => 'dupe_key', 'label_ar' => 'x', 'label_en' => 'x', 'field_type' => 'TEXT'];
    $this->postJson("/api/academies/{$this->A}/report-fields", $payload)->assertCreated();
    $this->postJson("/api/academies/{$this->A}/report-fields", $payload)
        ->assertStatus(422)->assertJsonValidationErrors('key');
});

// ── TC-3.12 / AC-3.5, AC-3.9: reorder updates sort_order; others unaffected ───
it('reorders a field without affecting another academy', function () {
    // Academy B has its own field with the same key + sort_order.
    $B = $this->createAcademy();
    foreach ([$this->A, $B] as $acad) {
        $this->asAcademy($acad);
        DB::table('report_field_definitions')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $acad, 'key' => 'shared',
            'label_ar' => 'x', 'label_en' => 'x', 'field_type' => 'TEXT', 'sort_order' => 1,
        ]);
    }

    Sanctum::actingAs($this->ownerA);
    $fieldA = collect($this->getJson("/api/academies/{$this->A}/report-fields")->json('reportFields'))
        ->firstWhere('key', 'shared');
    $this->patchJson("/api/academies/{$this->A}/report-fields/{$fieldA['id']}", ['sort_order' => 9])->assertOk();

    $this->asAcademy($this->A);
    expect(DB::table('report_field_definitions')->where('academy_id', $this->A)->where('key', 'shared')->value('sort_order'))->toBe(9);
    $this->asAcademy($B);
    expect(DB::table('report_field_definitions')->where('academy_id', $B)->where('key', 'shared')->value('sort_order'))->toBe(1);
});

// ── TC-3.13 / AC-3.5: deactivate stops a field appearing for new reports ──────
it('deactivates a field instead of removing it', function () {
    Sanctum::actingAs($this->ownerA);
    $id = $this->postJson("/api/academies/{$this->A}/report-fields", [
        'key' => 'optional_note', 'label_ar' => 'x', 'label_en' => 'x', 'field_type' => 'TEXT',
    ])->json('reportFieldId');

    $this->patchJson("/api/academies/{$this->A}/report-fields/{$id}", ['is_active' => false])->assertOk();

    $this->asAcademy($this->A);
    $field = DB::table('report_field_definitions')->where('id', $id)->first();
    expect($field->is_active)->toBeFalse();   // retained for history, hidden from new reports
});

// ── TC-3.14 / AC-3.5: a field with existing values cannot be deleted ──────────
it('refuses to delete a field that already has session-report values', function () {
    Sanctum::actingAs($this->ownerA);
    $id = $this->postJson("/api/academies/{$this->A}/report-fields", [
        'key' => 'tajweed', 'label_ar' => 'x', 'label_en' => 'x', 'field_type' => 'TEXT',
    ])->json('reportFieldId');

    // Simulate one Sprint-6 session report carrying a value for this field's key.
    $student = $this->createStudent($this->A);
    $teacher = $this->createTeacher($this->A);
    $session = $this->createSession($this->A, $student, $teacher);
    $this->asAcademy($this->A);
    DB::table('session_reports')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->A, 'session_id' => $session,
        'values' => json_encode(['tajweed' => 'ممتاز']),
    ]);

    Sanctum::actingAs($this->ownerA);
    $this->deleteJson("/api/academies/{$this->A}/report-fields/{$id}")
        ->assertStatus(422)->assertJsonValidationErrors('field');

    // The field survives (deactivate is the only safe removal).
    $this->asAcademy($this->A);
    expect(DB::table('report_field_definitions')->where('id', $id)->exists())->toBeTrue();
});

// ── TC-3.14 (positive): an unused field can be hard-deleted ───────────────────
it('hard-deletes a field with no values', function () {
    Sanctum::actingAs($this->ownerA);
    $id = $this->postJson("/api/academies/{$this->A}/report-fields", [
        'key' => 'unused', 'label_ar' => 'x', 'label_en' => 'x', 'field_type' => 'TEXT',
    ])->json('reportFieldId');

    $this->deleteJson("/api/academies/{$this->A}/report-fields/{$id}")->assertOk();

    $this->asAcademy($this->A);
    expect(DB::table('report_field_definitions')->where('id', $id)->exists())->toBeFalse();
});

// ── TC-3.22 / AC-3.9: an Owner cannot touch another academy's fields ──────────
it('forbids an Owner from editing another academy\'s report fields', function () {
    $B = $this->createAcademy();
    $this->asAcademy($B);
    $fieldB = (string) Str::uuid();
    DB::table('report_field_definitions')->insert([
        'id' => $fieldB, 'academy_id' => $B, 'key' => 'b_field',
        'label_ar' => 'x', 'label_en' => 'x', 'field_type' => 'TEXT',
    ]);

    Sanctum::actingAs($this->ownerA);  // Owner of A
    $this->getJson("/api/academies/{$B}/report-fields")->assertForbidden();
    $this->postJson("/api/academies/{$B}/report-fields", [
        'key' => 'sneaky', 'label_ar' => 'x', 'label_en' => 'x', 'field_type' => 'TEXT',
    ])->assertForbidden();
    $this->patchJson("/api/academies/{$B}/report-fields/{$fieldB}", ['label_en' => 'hacked'])->assertForbidden();
});
