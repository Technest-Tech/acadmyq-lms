<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\AcademyProfile;
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

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->asSuperAdmin();
    $this->quranType = (string) DB::table('academy_types')->where('code', 'QURAN')->value('id');
    // The migration seeds the CENTRE type; a fixture DB that predates it gets one here.
    $this->centreType = (string) (DB::table('academy_types')->where('code', AcademyProfile::CENTRE)->value('id')
        ?? $this->createAcademyType(AcademyProfile::CENTRE));
});

function profileCreatePayload(string $typeId, string $email): array
{
    return [
        'name' => 'Profile Academy', 'academy_type_id' => $typeId,
        'client_type' => 'MANAGEMENT',
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'email' => $email, 'password' => 'ownerpass123',
    ];
}

function profileMgmtOverrides(string $academyId): array
{
    $raw = DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')->where('status', '<>', 'ENDED')
        ->value('overrides');
    $ov = json_decode((string) $raw, true);

    return is_array($ov) ? $ov : [];
}

// ── the profile travels with the session and the entitlements ────────────────────────────────
it('reports QURAN for an academy on the Quran type and CENTRE for one on the centre type', function () {
    $quran = $this->createAcademy(typeId: $this->quranType);
    $centre = $this->createAcademy(typeId: $this->centreType);

    Sanctum::actingAs($this->makeUser($quran, 'ACADEMY_OWNER'));
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.profile', 'QURAN');
    $this->getJson('/api/entitlements')->assertOk()->assertJsonPath('profile', 'QURAN');

    $this->clearTenantContext();
    Sanctum::actingAs($this->makeUser($centre, 'ACADEMY_OWNER'));
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.profile', 'CENTRE');
    $this->getJson('/api/entitlements')->assertOk()->assertJsonPath('profile', 'CENTRE');

    // A platform Super Admin has no academy, so no profile either.
    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $this->getJson('/api/entitlements')->assertOk()->assertJsonPath('profile', null);
});

it('falls back to QURAN for a type that is neither', function () {
    expect(AcademyProfile::fromTypeCode('EXTERNAL'))->toBe('QURAN')
        ->and(AcademyProfile::fromTypeCode(null))->toBe('QURAN')
        ->and(AcademyProfile::forAcademy(null))->toBe('QURAN');
});

// ── a new CENTRE client starts from the centre preset; a QURAN client starts as it always did ─
it('switches a new centre client onto receipts and the centre ways, and off the Quran-only features', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', profileCreatePayload($this->centreType, 'centre-owner@t.test'))
        ->assertCreated()->json('academyId');

    $this->enterAcademyAsSuperAdmin($id);
    $ov = profileMgmtOverrides($id);
    expect($ov['enabled'])->toEqualCanonicalizing(['centre', 'accounting'])
        ->and($ov['disabled'])->toEqualCanonicalizing(['supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages']);

    $caps = Entitlement::resolve($id)['capabilities'];
    expect($caps)->toContain('centre', 'accounting', 'groups', 'trials', 'certificates', 'payroll')
        ->not->toContain('supervision', 'teacher_quality', 'report_card', 'student_reports');

    expect(DB::table('audit_log')->where('academy_id', $id)->where('action', 'module_subscription.features')->exists())->toBeTrue();
});

it('leaves a new Quran client exactly as every client always started', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', profileCreatePayload($this->quranType, 'quran-owner@t.test'))
        ->assertCreated()->json('academyId');

    $this->enterAcademyAsSuperAdmin($id);
    expect(profileMgmtOverrides($id))->toBe([]);

    $caps = Entitlement::resolve($id)['capabilities'];
    expect($caps)->toContain('supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages')
        ->not->toContain('centre', 'accounting');
});

// ── the preset MERGES: a switch the Super Admin set by hand survives the move ────────────────
it('merges the preset onto the switches an academy already holds', function () {
    $id = $this->createAcademy(typeId: $this->quranType);
    $this->enterAcademyAsSuperAdmin($id);
    DB::table('module_subscriptions')->where('academy_id', $id)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['disabled' => ['crm'], 'enabled' => ['lesson_report']])]);

    $changed = AcademyProfile::applyPreset(app(ModuleBilling::class), $id, AcademyProfile::CENTRE);

    expect($changed['enabled'])->toEqualCanonicalizing(['lesson_report', 'centre', 'accounting'])
        ->and($changed['disabled'])->toEqualCanonicalizing(['crm', 'supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages']);
    // The Quran preset is empty, so applying it moves nothing back: the move is the type alone.
    $back = AcademyProfile::applyPreset(app(ModuleBilling::class), $id, AcademyProfile::QURAN);
    expect($back['enabled'])->toEqualCanonicalizing($changed['enabled'])
        ->and($back['disabled'])->toEqualCanonicalizing($changed['disabled']);
});

// ── profile:set moves an existing academy, and a dry run moves nothing ──────────────────────
it('moves an existing academy onto the centre profile by name, after a dry run that changes nothing', function () {
    $id = $this->createAcademy(typeId: $this->quranType, overrides: ['name' => 'Lingo Test Centre']);

    $this->artisan('profile:set', ['academy' => 'Lingo Test Centre', 'profile' => 'CENTRE', '--dry-run' => true])
        ->assertSuccessful();
    $this->enterAcademyAsSuperAdmin($id);
    expect(DB::table('academies')->where('id', $id)->value('academy_type_id'))->toBe($this->quranType)
        ->and(profileMgmtOverrides($id))->toBe([]);

    $this->artisan('profile:set', ['academy' => $id, 'profile' => 'centre'])->assertSuccessful();
    $this->enterAcademyAsSuperAdmin($id);
    expect(DB::table('academies')->where('id', $id)->value('academy_type_id'))->toBe($this->centreType)
        ->and(profileMgmtOverrides($id)['enabled'])->toEqualCanonicalizing(['centre', 'accounting'])
        ->and(AcademyProfile::forAcademy($id))->toBe('CENTRE')
        ->and(DB::table('audit_log')->where('academy_id', $id)->where('action', 'academy.profile')->exists())->toBeTrue();

    // Back to QURAN with --no-preset: the type moves, the switches stay exactly as they are.
    $this->artisan('profile:set', ['academy' => $id, 'profile' => 'QURAN', '--no-preset' => true])->assertSuccessful();
    $this->enterAcademyAsSuperAdmin($id);
    expect(AcademyProfile::forAcademy($id))->toBe('QURAN')
        ->and(profileMgmtOverrides($id)['enabled'])->toEqualCanonicalizing(['centre', 'accounting']);
});

it('refuses an unknown profile or academy', function () {
    $this->artisan('profile:set', ['academy' => (string) Str::uuid(), 'profile' => 'CENTRE'])->assertFailed();
    $this->artisan('profile:set', ['academy' => 'whoever', 'profile' => 'SCHOOL'])->assertFailed();
});

it('surveys every management academy with its profile and verdict', function () {
    $this->createAcademy(typeId: $this->quranType, overrides: ['name' => 'Survey Quran']);
    $this->createAcademy(typeId: $this->centreType, overrides: ['name' => 'Survey Centre']);

    $this->artisan('profile:survey')
        ->expectsOutputToContain('Survey Quran')
        ->expectsOutputToContain('Survey Centre')
        ->assertSuccessful();
});
