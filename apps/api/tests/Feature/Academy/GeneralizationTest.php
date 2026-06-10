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
 * The key payoff (AC-3.12): a brand-new academy type is a pure catalog change — a row plus a
 * report-field template — and creating an academy of that type seeds the new fields with NO
 * code change to the report engine.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    // Insert a LANGUAGES type + its own template (data only — no engine code touched).
    $this->langType = (string) Str::uuid();
    $this->asSuperAdmin();
    DB::table('academy_types')->insert([
        'id' => $this->langType,
        'code' => 'LANGUAGES',
        'name' => 'Languages',
        'report_field_template' => json_encode([
            ['key' => 'level', 'label_ar' => 'المستوى', 'label_en' => 'Level', 'field_type' => 'SELECT', 'options' => ['A1', 'A2', 'B1'], 'is_required' => true],
            ['key' => 'vocabulary_count', 'label_ar' => 'المفردات', 'label_en' => 'Vocabulary', 'field_type' => 'NUMBER', 'options' => null, 'is_required' => false],
            ['key' => 'homework', 'label_ar' => 'الواجب', 'label_en' => 'Homework', 'field_type' => 'TEXT', 'options' => null, 'is_required' => false],
            ['key' => 'notes', 'label_ar' => 'ملاحظات', 'label_en' => 'Notes', 'field_type' => 'TEXTAREA', 'options' => null, 'is_required' => false],
        ]),
    ]);
});

// ── TC-3.27 / AC-3.12: the new type appears in the creation wizard ────────────
it('lists the new academy type in the wizard catalog', function () {
    Sanctum::actingAs($this->admin);

    $types = collect($this->getJson('/api/admin/academy-types')->assertOk()->json('academyTypes'));
    $lang = $types->firstWhere('code', 'LANGUAGES');
    expect($lang)->not->toBeNull();
    expect($lang['reportFieldTemplate'])->toHaveCount(4);
});

// ── TC-3.28 / AC-3.12: a LANGUAGES academy is seeded with LANGUAGES fields ────
it('seeds a new academy from its own type template, not the Qur\'an one', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', [
        'name' => 'Polyglot', 'academy_type_id' => $this->langType,
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'owner_full_name' => 'O', 'owner_email' => 'lang-owner@t.test',
    ])->assertCreated()->json('academyId');

    $this->enterAcademyAsSuperAdmin($id);
    $fields = DB::table('report_field_definitions')->where('academy_id', $id)->get()->keyBy('key');

    expect($fields)->toHaveCount(4);
    expect($fields->keys()->all())->toBe(['level', 'vocabulary_count', 'homework', 'notes']);
    expect($fields)->not->toHaveKey('surah_from'); // not the Qur'an template
    expect($fields['level']->field_type)->toBe('SELECT');
    expect(json_decode($fields['level']->options, true))->toBe(['A1', 'A2', 'B1']);
});
