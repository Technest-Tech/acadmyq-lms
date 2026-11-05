<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Group defaults (docs/centre-profile/02-COHERENCE-AUDIT §3). Pinned here:
 *   - a centre's only (402 otherwise);
 *   - every field optional and kept until changed; the teacher's pay amount follows its mode;
 *   - the money halves behind the group form's own gates, read and write;
 *   - nothing server-side reads them: a group created without a value keeps the old default.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-defaults@test.local']);
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-defaults@test.local']);
    $this->teacherUser = $teacherUser;
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $teacherUser->getKey()]);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function defaultsCentreOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['centre']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

it('is not there for an academy without the centre switch', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/group-defaults')->assertStatus(402);
    $this->patchJson('/api/group-defaults', ['lesson_minutes' => 90])->assertStatus(402);
});

it('starts empty, keeps what was set, and changes only what is sent', function () {
    defaultsCentreOn($this->academy);
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/group-defaults')->assertOk()->assertExactJson(['defaults' => [
        'lesson_minutes' => null, 'mode' => null, 'billing_mode' => null, 'month_lessons' => null,
        'teacher_pay_mode' => null, 'teacher_pay_minor' => null, 'teacher_share_bp' => null,
    ]]);

    $this->patchJson('/api/group-defaults', [
        'lesson_minutes' => 90, 'mode' => 'OFFLINE', 'billing_mode' => 'MONTHLY', 'month_lessons' => 8,
        'teacher_pay_mode' => 'PER_LESSON', 'teacher_pay_minor' => 15000,
    ])->assertOk()->assertJsonPath('defaults.lesson_minutes', 90);

    $this->patchJson('/api/group-defaults', ['month_lessons' => 12])->assertOk();
    $this->getJson('/api/group-defaults')->assertOk()
        ->assertJsonPath('defaults.lesson_minutes', 90)
        ->assertJsonPath('defaults.mode', 'OFFLINE')
        ->assertJsonPath('defaults.billing_mode', 'MONTHLY')
        ->assertJsonPath('defaults.month_lessons', 12)
        ->assertJsonPath('defaults.teacher_pay_mode', 'PER_LESSON')
        ->assertJsonPath('defaults.teacher_pay_minor', 15000);

    $this->patchJson('/api/group-defaults', ['lesson_minutes' => null])->assertOk()->assertJsonPath('defaults.lesson_minutes', null);
});

it('keeps the pay amount with its mode', function () {
    defaultsCentreOn($this->academy);
    Sanctum::actingAs($this->owner);

    $this->patchJson('/api/group-defaults', ['teacher_pay_mode' => 'PER_HOUR', 'teacher_pay_minor' => 6000])->assertOk();
    $this->patchJson('/api/group-defaults', ['teacher_pay_mode' => 'REVENUE_SHARE', 'teacher_share_bp' => 4000])->assertOk()
        ->assertJsonPath('defaults.teacher_pay_minor', null)
        ->assertJsonPath('defaults.teacher_share_bp', 4000);
    $this->patchJson('/api/group-defaults', ['teacher_pay_mode' => null])->assertOk()
        ->assertJsonPath('defaults.teacher_pay_mode', null)
        ->assertJsonPath('defaults.teacher_share_bp', null);
});

it('refuses values a group could not hold', function () {
    defaultsCentreOn($this->academy);
    Sanctum::actingAs($this->owner);

    $this->patchJson('/api/group-defaults', ['lesson_minutes' => 0])->assertStatus(422)->assertJsonValidationErrors(['lesson_minutes']);
    $this->patchJson('/api/group-defaults', ['billing_mode' => 'YEARLY'])->assertStatus(422)->assertJsonValidationErrors(['billing_mode']);
    $this->patchJson('/api/group-defaults', ['teacher_pay_mode' => 'BONUS'])->assertStatus(422);
    $this->patchJson('/api/group-defaults', ['teacher_share_bp' => 10001])->assertStatus(422);
    $this->patchJson('/api/group-defaults', ['mode' => 'HYBRID'])->assertStatus(422);
});

it('shows a teacher the lesson length and mode only, and lets them change nothing', function () {
    defaultsCentreOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/group-defaults', ['lesson_minutes' => 60, 'billing_mode' => 'PER_LESSON', 'teacher_pay_mode' => 'PER_LESSON', 'teacher_pay_minor' => 9000])->assertOk();

    Sanctum::actingAs($this->teacherUser);
    $defaults = $this->getJson('/api/group-defaults')->assertOk()->json('defaults');
    expect(array_keys($defaults))->toBe(['lesson_minutes', 'mode'])
        ->and($defaults['lesson_minutes'])->toBe(60);
    $this->patchJson('/api/group-defaults', ['lesson_minutes' => 45])->assertForbidden();
});

it('never moves a group: one created without a value keeps the old default', function () {
    defaultsCentreOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/group-defaults', ['billing_mode' => 'PER_LESSON', 'mode' => 'ONLINE'])->assertOk();

    $this->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01', 'mode' => 'OFFLINE',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertCreated()
        ->assertJsonPath('group.mode', 'OFFLINE')
        ->assertJsonPath('group.pricing.billing_mode', 'MONTHLY');
});
