<?php

declare(strict_types=1);

use App\Support\AcademyProfile;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// The create-a-client form asks for the owner's name and phone, the management price and its
// interval, the trial's length and the opt-in features on from day one (the modern look); the
// client page and the hub then say whether the client is actually using the system.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->asSuperAdmin();
    $this->quranType = (string) DB::table('academy_types')->where('code', 'QURAN')->value('id');
    $this->centreType = (string) (DB::table('academy_types')->where('code', AcademyProfile::CENTRE)->value('id')
        ?? $this->createAcademyType(AcademyProfile::CENTRE));
});

function usageCreatePayload(string $typeId, string $email, array $extra = []): array
{
    return array_merge([
        'name' => 'Usage Academy', 'academy_type_id' => $typeId,
        'client_type' => 'MANAGEMENT',
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'email' => $email, 'password' => 'ownerpass123',
    ], $extra);
}

function usageManagementRow(string $academyId): object
{
    return DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')->where('status', '<>', 'ENDED')
        ->first();
}

it('saves the owner name and phone, the trial length and the management price from the create form', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', usageCreatePayload($this->quranType, 'named-owner@t.test', [
        'status' => 'TRIAL',
        'trial_days' => 10,
        'owner_name' => 'Omar Salem',
        'owner_phone' => '+20 100 123 4567',
        'modules' => [['module' => 'MANAGEMENT', 'price_minor' => 1_200_000, 'billing_interval' => 'YEARLY']],
    ]))->assertCreated()->json('academyId');

    // Users are tenant rows: read them in the new academy's context.
    $this->asAcademy($id);
    $owner = DB::table('users')->where('email', 'named-owner@t.test')->first();
    expect($owner->full_name)->toBe('Omar Salem')
        ->and($owner->phone)->toBe('+20 100 123 4567');

    $this->asAcademy($id);
    $row = usageManagementRow($id);
    expect((bool) $row->is_trial)->toBeTrue()
        ->and((int) $row->base_price_minor)->toBe(1_200_000)
        ->and($row->billing_interval)->toBe('YEARLY');
    // Ten days, give or take the timezone's edge.
    $days = now()->diffInDays(Carbon::parse($row->trial_end));
    expect($days)->toBeGreaterThanOrEqual(9)->toBeLessThanOrEqual(11);
});

it('keeps the old name fallback when no owner name is typed', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', usageCreatePayload($this->quranType, 'plain.owner@t.test'))->assertCreated()->json('academyId');

    $this->asAcademy($id);
    expect(DB::table('users')->where('email', 'plain.owner@t.test')->value('full_name'))->toBe('plain.owner');
});

it('switches the modern look on from day one without dropping the centre preset', function () {
    Sanctum::actingAs($this->admin);
    $id = $this->postJson('/api/admin/academies', usageCreatePayload($this->centreType, 'modern-centre@t.test', [
        'enable_features' => ['modern_look'],
    ]))->assertCreated()->json('academyId');

    $this->asAcademy($id);
    $enabled = (array) (json_decode((string) usageManagementRow($id)->overrides, true)['enabled'] ?? []);
    expect($enabled)->toContain('modern_look')->toContain('centre')->toContain('accounting');
});

it('refuses a feature that is not an opt-in of the management module, and a malformed phone', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson('/api/admin/academies', usageCreatePayload($this->quranType, 'bad1@t.test', [
        'enable_features' => ['invoicing'],
    ]))->assertStatus(422)->assertJsonValidationErrors(['enable_features.0']);

    $this->postJson('/api/admin/academies', usageCreatePayload($this->quranType, 'bad2@t.test', [
        'owner_phone' => 'call me maybe',
    ]))->assertStatus(422)->assertJsonValidationErrors(['owner_phone']);
});

it('tells the client page and the hub whether the client is using the system', function () {
    $academy = $this->createAcademy(typeId: $this->quranType);
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER');
    $this->asAcademy($academy);
    DB::table('users')->where('id', $owner->id)->update(['phone' => '+201001234567']);
    $this->asSuperAdmin();

    $student = $this->createStudent($academy);
    $teacher = $this->createTeacher($academy);
    // Two lessons recorded this month, one still scheduled, one hidden, one from last month.
    $this->createSession($academy, $student, $teacher, ['scheduled_at_utc' => now()->startOfDay()->toIso8601String(), 'status' => 'ATTENDED']);
    $this->createSession($academy, $student, $teacher, ['scheduled_at_utc' => now()->startOfDay()->toIso8601String(), 'status' => 'ABSENT_EXCUSED']);
    $this->createSession($academy, $student, $teacher, ['scheduled_at_utc' => now()->addDay()->toIso8601String(), 'status' => 'SCHEDULED']);
    $this->createSession($academy, $student, $teacher, ['scheduled_at_utc' => now()->startOfDay()->toIso8601String(), 'status' => 'ATTENDED', 'hidden_at' => now()->toIso8601String()]);
    $this->createSession($academy, $student, $teacher, ['scheduled_at_utc' => now()->subMonthsNoOverflow(2)->toIso8601String(), 'status' => 'ATTENDED']);

    $this->asAcademy($academy);
    DB::table('audit_log')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academy, 'actor_user_id' => $owner->id, 'actor_role' => 'ACADEMY_OWNER',
        'action' => 'auth.login', 'entity_type' => 'user', 'entity_id' => $owner->id, 'created_at' => '2026-11-01 09:00:00+00',
    ]);
    $this->asSuperAdmin();

    Sanctum::actingAs($this->admin);
    // What it owes comes from its account in the book: a monthly line whose cycle is 3 days late.
    $this->putJson("/api/admin/clients/{$academy}/agreement", [
        'plan' => 'MONTHLY', 'currency' => 'EGP',
        'recurring' => ['amount_minor' => 60000, 'first_due_on' => now()->subDays(3)->toDateString()],
    ])->assertOk();

    $this->getJson("/api/admin/clients/{$academy}")
        ->assertOk()
        ->assertJsonPath('profile', 'QURAN')
        ->assertJsonPath('summary.owner.phone', '+201001234567')
        ->assertJsonPath('summary.usage.lessons_this_month', 2)
        ->assertJsonPath('account.has_overdue', true)
        ->assertJsonPath('account.overdue.EGP', 60000)
        ->assertJsonPath('account.plan', 'MONTHLY')
        ->assertJsonPath('summary.usage.last_login_at', fn ($at) => str_starts_with((string) $at, '2026-11-01'));

    $row = collect($this->getJson('/api/admin/clients')->assertOk()->json('clients'))->firstWhere('id', $academy);
    expect($row['owner_phone'])->toBe('+201001234567')
        ->and($row['lessons_this_month'])->toBe(2)
        ->and($row['account']['has_overdue'])->toBeTrue()
        ->and($row['account']['overdue']['EGP'])->toBe(60000)
        ->and((string) $row['last_login_at'])->toStartWith('2026-11-01');
});
