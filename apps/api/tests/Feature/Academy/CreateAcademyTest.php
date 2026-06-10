<?php

declare(strict_types=1);

use App\Models\User;
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
    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
});

/** A valid creation payload; override per test. */
function academyPayload(array $overrides = []): array
{
    return array_merge([
        'name' => "Noor Al-Qur'an Academy",
        'academy_type_id' => test()->quranType,
        'plan_id' => test()->proPlan,
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'billing_day' => 1,
        'owner_full_name' => 'Owner Noor',
        'owner_email' => 'first-owner@noor.test',
    ], $overrides);
}

// ── TC-3.1 / AC-3.1: create with valid inputs → 201, correctly configured ─────
it('creates a fully configured academy', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->postJson('/api/admin/academies', academyPayload())
        ->assertCreated()
        ->assertJsonPath('reportFields', 5);
    $id = $res->json('academyId');

    $this->asSuperAdmin();
    $a = DB::table('academies')->where('id', $id)->first();
    expect($a->academy_type_id)->toBe($this->quranType);
    expect($a->plan_id)->toBe($this->proPlan);
    expect($a->default_currency)->toBe('EGP');
    expect($a->timezone)->toBe('Africa/Cairo');
    expect($a->invoice_grouping)->toBe('PER_GUARDIAN');
    expect($a->status)->toBe('ACTIVE');
});

// ── TC-3.2 / AC-3.2: seeds the 5 Qur'an report fields with correct types ──────
it('seeds the Qur\'an report-field template into the new academy', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', academyPayload())->json('academyId');

    $this->enterAcademyAsSuperAdmin($id);
    $fields = DB::table('report_field_definitions')->where('academy_id', $id)->get()->keyBy('key');

    expect($fields)->toHaveCount(5);
    expect($fields['surah_from']->field_type)->toBe('TEXT');
    expect($fields['surah_from']->is_required)->toBeTrue();
    expect($fields['surah_to']->is_required)->toBeTrue();
    expect($fields['tajweed_rating']->field_type)->toBe('SELECT');
    expect(json_decode($fields['tajweed_rating']->options, true))->toBe(['ممتاز', 'جيد جداً', 'جيد']);
    expect($fields['notes']->field_type)->toBe('TEXTAREA');
});

// ── TC-3.3 / AC-3.2, AC-3.9: seeded fields are scoped to that academy (RLS) ───
it('scopes the seeded fields to the new academy only', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', academyPayload())->json('academyId');

    // The demo academy (different tenant) cannot see the new academy's fields.
    $demo = DB::table('academies')->where('subdomain', 'noor')->value('id');
    $this->enterAcademyAsSuperAdmin($demo);
    expect(DB::table('report_field_definitions')->where('academy_id', $id)->count())->toBe(0);
});

// ── TC-3.4 / AC-3.3: the first owner can log in (after set-password) ──────────
it('provisions a first owner who can log in to their configured academy', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', academyPayload(['owner_email' => 'login-owner@noor.test']))
        ->json('academyId');

    // The owner is created with role + invited_at, awaiting a set-password.
    $this->enterAcademyAsSuperAdmin($id);
    $owner = DB::table('users')->where('email', 'login-owner@noor.test')->first();
    expect($owner->academy_id)->toBe($id);
    expect($owner->invited_at)->not->toBeNull();
    expect(DB::table('user_roles')->where('user_id', $owner->id)->where('role', 'ACADEMY_OWNER')->exists())->toBeTrue();

    // Simulate the owner completing set-password, then logging in.
    DB::table('users')->where('id', $owner->id)->update(['password' => bcrypt('newsecret')]);

    $this->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => 'login-owner@noor.test', 'password' => 'newsecret'])
        ->assertOk()
        ->assertJsonPath('role', 'ACADEMY_OWNER')
        ->assertJsonPath('academyId', $id);

    Sanctum::actingAs(User::find($owner->id));
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academyId', $id);
});

// ── TC-3.5 / AC-3.4: a mid-creation failure rolls everything back ─────────────
it('rolls back the whole creation when the owner email collides', function () {
    // Seed a collision: an owner email already used elsewhere.
    $other = $this->createAcademy();
    $this->makeUser($other, 'ACADEMY_OWNER', ['email' => 'taken@dupe.test']);

    Sanctum::actingAs($this->admin);
    $this->postJson('/api/admin/academies', academyPayload([
        'name' => 'RollbackAcademy',
        'owner_email' => 'taken@dupe.test',
    ]))->assertStatus(422);

    // No academy, no orphan fields, no orphan owner — the transaction rolled back (AC-3.4).
    $this->asSuperAdmin();
    expect(DB::table('academies')->where('name', 'RollbackAcademy')->count())->toBe(0);
    // The owner with that email still belongs only to the other academy (no orphan owner).
    $row = DB::selectOne('select academy_id from app.auth_find_by_email(?)', ['taken@dupe.test']);
    expect($row->academy_id)->toBe($other);
});

// ── TC-3.6 / AC-3.7: duplicate subdomain is rejected ──────────────────────────
it('rejects a duplicate subdomain', function () {
    $this->createAcademy(overrides: ['subdomain' => 'taken-sub']);

    Sanctum::actingAs($this->admin);
    $this->postJson('/api/admin/academies', academyPayload(['subdomain' => 'taken-sub']))
        ->assertStatus(422)
        ->assertJsonValidationErrors('subdomain');
});

// ── TC-3.7 / AC-3.7: a malformed subdomain is rejected by the format rule ─────
it('rejects a malformed subdomain', function () {
    Sanctum::actingAs($this->admin);

    foreach (['UPPER', 'has space', '-leading', 'trailing-', 'under_score'] as $bad) {
        $this->postJson('/api/admin/academies', academyPayload([
            'owner_email' => 'o-'.bin2hex(random_bytes(3)).'@noor.test',
            'subdomain' => $bad,
        ]))->assertStatus(422)->assertJsonValidationErrors('subdomain');
    }
});

// ── TC-3.8 / AC-3.1: a non-IANA timezone is rejected ──────────────────────────
it('rejects an invalid timezone', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson('/api/admin/academies', academyPayload(['timezone' => 'Mars/Olympus']))
        ->assertStatus(422)
        ->assertJsonValidationErrors('timezone');
});
