<?php

declare(strict_types=1);

use App\Models\User;
use App\Support\AcademyExport;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * Settings → Export data (every dataset as a sheet) and Settings → Admins (extra full-access
 * logins). Both are admin-only: a supervisor, a teacher, or any delegated role is refused, and
 * one academy never sees another's rows.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-export@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-export@test.local']);
    $this->guardian = $this->createGuardian($this->academy, ['full_name' => 'Parent One']);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Student One']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Teacher One', 'currency' => 'EGP', 'session_rate_minor' => 15000]);
    $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-05-10 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'ATTENDED',
    ]);
    $this->clearTenantContext();

    // A second academy whose rows must never appear.
    $this->other = $this->createAcademy();
    $this->createStudent($this->other, null, ['full_name' => 'Someone Else']);
    $this->clearTenantContext();
});

it('lists every dataset with its row count for an admin', function () {
    Sanctum::actingAs($this->owner);

    $datasets = collect($this->getJson('/api/academy/export')->assertOk()->json('datasets'))->keyBy('key');

    expect($datasets->keys()->all())->toBe(AcademyExport::DATASETS)
        ->and($datasets['students']['count'])->toBe(1)
        ->and($datasets['lessons']['count'])->toBe(1)
        ->and($datasets['students']['title']['ar'])->toBe('الطلاب');
});

it('builds every sheet without error', function () {
    Sanctum::actingAs($this->owner);

    foreach (AcademyExport::DATASETS as $key) {
        $this->getJson("/api/academy/export/{$key}")->assertOk()->assertJsonPath('key', $key);
    }
});

it('exports students with guardian and readable values, scoped to the academy', function () {
    Sanctum::actingAs($this->owner);

    $sheet = $this->getJson('/api/academy/export/students')->assertOk()->json();
    $keys = array_column($sheet['columns'], 'key');
    $rows = array_map(fn ($r) => array_combine($keys, $r), $sheet['rows']);

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['full_name'])->toBe('Student One')
        ->and($rows[0]['guardian_name'])->toBe('Parent One')
        ->and($rows[0]['is_active'])->toBeTrue();
});

it('sends money in major units and lesson times in the academy timezone', function () {
    Sanctum::actingAs($this->owner);

    $teachers = $this->getJson('/api/academy/export/teachers')->assertOk()->json();
    $t = array_combine(array_column($teachers['columns'], 'key'), $teachers['rows'][0]);
    expect($t['hourly_rate'])->toEqual(150);

    $lessons = $this->getJson('/api/academy/export/lessons')->assertOk()->json();
    $l = array_combine(array_column($lessons['columns'], 'key'), $lessons['rows'][0]);
    expect($l['lesson_date'])->toBe('2026-05-10')
        ->and($l['lesson_time'])->toBe('13:00')
        ->and($l['status'])->toBe('ATTENDED');
});

it('gives each report field its own column in the lesson reports sheet', function () {
    $this->asAcademy($this->academy);
    DB::table('report_field_definitions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'key' => 'surah',
        'label_en' => 'Surah', 'label_ar' => 'السورة', 'field_type' => 'TEXT', 'sort_order' => 1,
        'is_required' => false, 'is_active' => true,
    ]);
    $sessionId = DB::table('sessions')->where('academy_id', $this->academy)->value('id');
    DB::table('session_reports')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $sessionId,
        'values' => json_encode(['surah' => "Al-Baqara 'it's long'"]), 'filled_at' => now(),
    ]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $sheet = $this->getJson('/api/academy/export/lesson_reports')->assertOk()->json();
    $labels = array_column(array_column($sheet['columns'], 'label'), 'ar');
    $row = array_combine(array_column($sheet['columns'], 'key'), $sheet['rows'][0]);

    expect($labels)->toContain('السورة')
        ->and($row['f0'])->toBe("Al-Baqara 'it's long'")
        ->and($row['student'])->toBe('Student One');
});

it('refuses the export to anyone but an admin', function () {
    Sanctum::actingAs($this->supervisor);

    $this->getJson('/api/academy/export')->assertForbidden();
    $this->getJson('/api/academy/export/students')->assertForbidden();
});

it('404s an unknown dataset', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/academy/export/nope')->assertNotFound();
});

it('lets an admin add another admin who can then act as one', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/academy/admins', [
        'full_name' => 'Second Admin',
        'email' => 'Second-Admin@Test.local',
        'password' => 'secret-pass-1',
    ])->assertCreated()->json('id');

    $user = DB::table('users')->where('id', $id)->first();
    expect($user->email)->toBe('second-admin@test.local')
        ->and(Hash::check('secret-pass-1', $user->password))->toBeTrue()
        ->and(DB::table('user_roles')->where('user_id', $id)->value('role'))->toBe('ACADEMY_OWNER');

    $admins = collect($this->getJson('/api/academy/admins')->assertOk()->json('admins'));
    expect($admins)->toHaveCount(2)
        ->and($admins->firstWhere('isYou', true)['email'])->toBe('owner-export@test.local');

    $second = User::query()->findOrFail($id);
    app('auth')->forgetGuards();
    Sanctum::actingAs($second);
    $this->getJson('/api/academy/export')->assertOk();
});

it('rejects a duplicate email', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/academy/admins', [
        'full_name' => 'Dup',
        'email' => 'sup-export@test.local',
        'password' => 'secret-pass-1',
    ])->assertStatus(422)->assertJsonValidationErrors('email');
});

it('never switches off your own login or the last active admin', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/academy/admins/{$this->owner->getKey()}", ['is_active' => false])
        ->assertStatus(422)->assertJsonValidationErrors('is_active');

    $id = $this->postJson('/api/academy/admins', [
        'full_name' => 'Second Admin', 'email' => 'second@test.local', 'password' => 'secret-pass-1',
    ])->assertCreated()->json('id');

    $this->patchJson("/api/academy/admins/{$id}", ['is_active' => false])->assertOk();
    expect((bool) DB::table('users')->where('id', $id)->value('is_active'))->toBeFalse();

    $this->patchJson("/api/academy/admins/{$id}", ['password' => 'another-pass-2', 'is_active' => true])->assertOk();
    expect(Hash::check('another-pass-2', DB::table('users')->where('id', $id)->value('password')))->toBeTrue();
});

it('will not touch a non-admin through the admins endpoint', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/academy/admins/{$this->supervisor->getKey()}", ['password' => 'hijack-pass-1'])->assertNotFound();
});

it('refuses admin management to anyone but an admin', function () {
    Sanctum::actingAs($this->supervisor);

    $this->getJson('/api/academy/admins')->assertForbidden();
    $this->postJson('/api/academy/admins', [
        'full_name' => 'Sneaky', 'email' => 'sneaky@test.local', 'password' => 'secret-pass-1',
    ])->assertForbidden();
});
