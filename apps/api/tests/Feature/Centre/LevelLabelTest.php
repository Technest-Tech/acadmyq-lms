<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * What the classification is called (docs/centre-profile/02-COHERENCE-AUDIT §3). Pinned here:
 *   - the word is LEVEL until an academy picks GRADE or YEAR, and it travels with the session and
 *     the levels list;
 *   - it is written through PATCH /academy and app.update_academy_defaults like the country, and
 *     the write touches nothing else;
 *   - the supervisor who keeps the levels may set it, and nothing more of the academy;
 *   - a centre's parent page names it; a Quran academy's parent page does not change shape.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'Lingo', 'country' => 'EG', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-label@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-label@test.local']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Umm Adam', 'whatsapp_phone' => '+201001112224']);
    $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam']);
    $this->clearTenantContext();
});

function labelCentreOn(string $academyId): void
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

function labelPortal($test): array
{
    Sanctum::actingAs($test->owner);
    $url = (string) $test->postJson("/api/guardians/{$test->parent}/portal")->assertOk()->json('url');
    foreach (['app.current_academy_id', 'app.current_role', 'app.current_user_id'] as $guc) {
        DB::statement('select set_config(?, \'\', true)', [$guc]);
    }

    return $test->getJson('/api/p/'.substr($url, strrpos($url, '/p/') + 3))->assertOk()->json();
}

it('says LEVEL until the academy picks another word, and carries it in the session and the levels list', function () {
    labelCentreOn($this->academy);
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.levelLabel', 'LEVEL');
    $this->getJson('/api/levels')->assertOk()->assertJsonPath('level_label', 'LEVEL');
    $this->getJson('/api/academy')->assertOk()->assertJsonPath('academy.level_label', 'LEVEL');

    $this->patchJson('/api/academy', ['level_label' => 'GRADE'])->assertOk();

    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.levelLabel', 'GRADE');
    $this->getJson('/api/levels')->assertOk()->assertJsonPath('level_label', 'GRADE');

    $this->patchJson('/api/academy', ['level_label' => 'YEAR'])->assertOk();
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.levelLabel', 'YEAR');
    $this->patchJson('/api/academy', ['level_label' => 'CLASS'])->assertStatus(422)->assertJsonValidationErrors(['level_label']);
});

it('writes only the word, through the same function as the country, and keeps the rest of the academy', function () {
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/academy', ['level_label' => 'GRADE'])->assertOk();

    $academy = $this->getJson('/api/academy')->assertOk()->json('academy');
    expect($academy['name'])->toBe('Lingo')
        ->and($academy['country'])->toBe('EG')
        ->and($academy['default_currency'])->toBe('EGP')
        ->and($academy['timezone'])->toBe('Africa/Cairo')
        ->and($academy['level_label'])->toBe('GRADE');

    // A later country / name save leaves the word where it is.
    $this->patchJson('/api/academy', ['name' => 'Lingo Centre', 'country' => 'SA'])->assertOk();
    $academy = $this->getJson('/api/academy')->assertOk()->json('academy');
    expect($academy['name'])->toBe('Lingo Centre')
        ->and($academy['country'])->toBe('SA')
        ->and($academy['level_label'])->toBe('GRADE');
});

it('lets the supervisor who keeps the levels set the word, and nothing else of the academy', function () {
    Sanctum::actingAs($this->supervisor);
    $this->patchJson('/api/academy', ['level_label' => 'GRADE'])->assertOk();
    $this->patchJson('/api/academy', ['level_label' => 'YEAR', 'name' => 'Renamed'])->assertForbidden();
    $this->patchJson('/api/academy', ['name' => 'Renamed'])->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/academy')->assertOk()
        ->assertJsonPath('academy.name', 'Lingo')
        ->assertJsonPath('academy.level_label', 'GRADE');
});

it('names the word on a centre\'s parent page and leaves a Quran academy\'s page as it was', function () {
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/academy', ['level_label' => 'GRADE'])->assertOk();

    expect(labelPortal($this))->not->toHaveKey('level_label');

    labelCentreOn($this->academy);
    expect(labelPortal($this)['level_label'] ?? null)->toBe('GRADE');
});
