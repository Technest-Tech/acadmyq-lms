<?php

declare(strict_types=1);

use App\Support\AcademyProfile;
use App\Support\Entitlement;
use App\Support\MoneyPolicy;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// The Super Admin changes an existing client's type (Quran academy ↔ centre) from the client's
// Settings tab: a preview first, then the move, refused while it would strand live money.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->asSuperAdmin();
    $this->quranType = (string) DB::table('academy_types')->where('code', 'QURAN')->value('id');
    $this->centreType = (string) (DB::table('academy_types')->where('code', AcademyProfile::CENTRE)->value('id')
        ?? $this->createAcademyType(AcademyProfile::CENTRE));

    // The MANAGEMENT switches, read inside the academy (module rows are tenant-scoped).
    $this->overrides = function (string $academyId): array {
        $this->enterAcademyAsSuperAdmin($academyId);
        $raw = DB::table('module_subscriptions')
            ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')->where('status', '<>', 'ENDED')
            ->value('overrides');
        $ov = json_decode((string) $raw, true);

        return is_array($ov) ? $ov : [];
    };
});

function switchCreate(object $test, string $typeId, string $email): string
{
    Sanctum::actingAs($test->admin);

    return $test->postJson('/api/admin/academies', [
        'name' => 'Switch Academy', 'academy_type_id' => $typeId, 'client_type' => 'MANAGEMENT',
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'email' => $email, 'password' => 'ownerpass123',
    ])->assertCreated()->json('academyId');
}

it('previews a Quran academy becoming a centre and changes nothing', function () {
    $id = switchCreate($this, $this->quranType, 'q2c-preview@t.test');

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $res = $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'CENTRE', 'dry_run' => true])->assertOk();

    $res->assertJsonPath('from', 'QURAN')->assertJsonPath('to', 'CENTRE')->assertJsonPath('blocker', null);
    expect($res->json('turned_on'))->toEqualCanonicalizing(['centre', 'accounting'])
        ->and($res->json('turned_off'))->toEqualCanonicalizing(['supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages']);

    expect(($this->overrides)($id))->toBe([])
        ->and(AcademyProfile::forAcademy($id))->toBe('QURAN');
});

it('moves a Quran academy onto the centre type with the centre preset, and audits it', function () {
    $id = switchCreate($this, $this->quranType, 'q2c@t.test');

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'CENTRE'])->assertOk()->assertJsonPath('to', 'CENTRE');

    $ov = ($this->overrides)($id);
    expect($ov['enabled'])->toEqualCanonicalizing(['centre', 'accounting'])
        ->and($ov['disabled'])->toEqualCanonicalizing(['supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages'])
        ->and(AcademyProfile::forAcademy($id))->toBe('CENTRE')
        ->and(MoneyPolicy::usesSubscriptions($id))->toBeTrue()
        ->and(DB::table('audit_log')->where('academy_id', $id)->where('action', 'academy.profile')->exists())->toBeTrue();

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $this->getJson("/api/admin/clients/{$id}")->assertOk()->assertJsonPath('profile', 'CENTRE');
});

it('moves a centre created by mistake back to a plain Quran academy', function () {
    $id = switchCreate($this, $this->centreType, 'c2q@t.test');

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $res = $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'QURAN'])->assertOk();
    expect($res->json('turned_off'))->toEqualCanonicalizing(['centre', 'accounting'])
        ->and($res->json('turned_on'))->toEqualCanonicalizing(['supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages']);

    $ov = ($this->overrides)($id);
    expect($ov['enabled'] ?? [])->toBe([])
        ->and($ov['disabled'] ?? [])->toBe([])
        ->and(AcademyProfile::forAcademy($id))->toBe('QURAN')
        ->and(MoneyPolicy::usesSubscriptions($id))->toBeFalse();

    $caps = Entitlement::resolve($id)['capabilities'];
    expect($caps)->toContain('supervision', 'teacher_quality', 'report_card', 'student_reports', 'packages')
        ->not->toContain('centre', 'accounting');
});

it('keeps a hand-set switch and keeps receipts on when the centre already wrote some', function () {
    $id = switchCreate($this, $this->centreType, 'c2q-receipts@t.test');
    $this->enterAcademyAsSuperAdmin($id);
    $ov = ($this->overrides)($id);
    DB::table('module_subscriptions')->where('academy_id', $id)->where('module', 'MANAGEMENT')->where('status', '<>', 'ENDED')
        ->update(['overrides' => json_encode(['enabled' => [...$ov['enabled'], 'modern_look'], 'disabled' => [...$ov['disabled'], 'crm']])]);
    DB::table('receipts')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $id, 'number' => 'R-000001', 'amount_minor' => 5000,
        'currency' => 'EGP', 'method' => 'CASH', 'received_on' => '2026-11-01', 'payer_name' => 'Walk-in', 'public_token' => (string) Str::uuid(),
    ]);

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'QURAN'])->assertOk();

    $after = ($this->overrides)($id);
    expect($after['enabled'])->toEqualCanonicalizing(['accounting', 'modern_look'])
        ->and($after['disabled'])->toEqualCanonicalizing(['crm']);
});

it('refuses to make a centre of an academy still selling hour packages', function () {
    $id = switchCreate($this, $this->quranType, 'q2c-packages@t.test');
    $this->enterAcademyAsSuperAdmin($id);
    $student = $this->createStudent($id);
    DB::table('lesson_packages')->insert(['id' => (string) Str::uuid(), 'academy_id' => $id, 'student_id' => $student,
        'label' => '8 hours', 'minutes_total' => 480, 'price_minor' => 30000, 'currency' => 'EGP', 'hourly_rate_minor' => 3750,
        'status' => 'ACTIVE', 'sequence_no' => 1, 'starts_on' => '2026-11-01']);

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'CENTRE', 'dry_run' => true])
        ->assertOk()->assertJsonPath('blocker', ['code' => 'open_packages', 'count' => 1]);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'CENTRE'])
        ->assertStatus(422)->assertJsonValidationErrors(['profile']);

    expect(($this->overrides)($id))->toBe([])
        ->and(AcademyProfile::forAcademy($id))->toBe('QURAN');
});

it('refuses to move a centre back while it has open subscriptions', function () {
    $id = switchCreate($this, $this->centreType, 'c2q-subs@t.test');
    $this->enterAcademyAsSuperAdmin($id);
    $student = $this->createStudent($id);
    DB::table('centre_subscriptions')->insert(['id' => (string) Str::uuid(), 'academy_id' => $id, 'student_id' => $student,
        'label' => '8 lessons', 'lessons_sold' => 8, 'lesson_price_minor' => 5000, 'price_minor' => 40000, 'currency' => 'EGP',
        'starts_on' => '2026-11-01', 'status' => 'OPEN', 'sequence_no' => 1]);

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'QURAN'])
        ->assertStatus(422)->assertJsonValidationErrors(['profile']);

    expect(AcademyProfile::forAcademy($id))->toBe('CENTRE')
        ->and(($this->overrides)($id)['enabled'])->toContain('centre');
});

it('refuses a move onto the type the academy already has, an unknown type, and a caller without billing rights', function () {
    $id = switchCreate($this, $this->quranType, 'same@t.test');

    $this->clearTenantContext();
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'QURAN'])->assertStatus(422);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'SCHOOL'])->assertStatus(422);
    $this->putJson('/api/admin/clients/'.Str::uuid().'/profile', ['profile' => 'CENTRE'])->assertNotFound();

    $owner = $this->makeUser($id, 'ACADEMY_OWNER');
    $this->clearTenantContext();
    Sanctum::actingAs($owner);
    $this->putJson("/api/admin/clients/{$id}/profile", ['profile' => 'CENTRE'])->assertForbidden();
});
