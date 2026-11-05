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
 * The "online lessons" switch (docs/centre-profile/02-COHERENCE-AUDIT §1). Pinned here:
 *   - automatic: a non-centre always is; a centre is once an active group is ONLINE or an active
 *     teacher has a meeting link, and is not otherwise;
 *   - what the academy says beats that, both ways, and null goes back to automatic;
 *   - it is written through PATCH /academy, settings.manage only, and moves nothing else.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'Lingo', 'country' => 'EG', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-online@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-online@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function onlineCentreOn(string $academyId): void
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

function onlineGroup($test, string $mode): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', [
        'name' => 'English A1 '.$mode, 'teacher_id' => $test->teacher, 'start_date' => '2026-06-01', 'mode' => $mode,
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertCreated()->json('group.id');
}

function onlineSays($test): bool
{
    Sanctum::actingAs($test->owner);

    return (bool) $test->getJson('/api/auth/me')->assertOk()->json('academy.onlineLessons');
}

it('is on for an academy without the centre switch, whatever it holds', function () {
    onlineGroup($this, 'OFFLINE');

    expect(onlineSays($this))->toBeTrue();
});

it('is off for a room-based centre, and on once a group or a teacher goes online', function () {
    onlineCentreOn($this->academy);
    onlineGroup($this, 'OFFLINE');
    expect(onlineSays($this))->toBeFalse();

    // A running online group counts; an archived one does not.
    $online = onlineGroup($this, 'ONLINE');
    expect(onlineSays($this))->toBeTrue();
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::table('class_groups')->where('id', $online)->update(['status' => 'ARCHIVED']);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    expect(onlineSays($this))->toBeFalse();

    // An active teacher's meeting link counts; an empty one or a switched-off teacher's does not.
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$this->teacher}", ['meeting_url' => 'https://meet.example.com/mona'])->assertOk();
    expect(onlineSays($this))->toBeTrue();
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::table('teachers')->where('id', $this->teacher)->update(['is_active' => false]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    expect(onlineSays($this))->toBeFalse();
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::table('teachers')->where('id', $this->teacher)->update(['is_active' => true]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    $this->patchJson("/api/teachers/{$this->teacher}", ['meeting_url' => null])->assertOk();
    expect(onlineSays($this))->toBeFalse();
});

it('takes the academy\'s word over the automatic answer, both ways, and goes back to automatic on null', function () {
    onlineCentreOn($this->academy);
    onlineGroup($this, 'OFFLINE');
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/academy')->assertOk()
        ->assertJsonPath('academy.online_lessons', null)
        ->assertJsonPath('academy.online_lessons_effective', false);

    $this->patchJson('/api/academy', ['online_lessons' => true])->assertOk();
    expect(onlineSays($this))->toBeTrue();
    $this->getJson('/api/academy')->assertOk()->assertJsonPath('academy.online_lessons', true);

    onlineGroup($this, 'ONLINE');
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/academy', ['online_lessons' => false])->assertOk();
    expect(onlineSays($this))->toBeFalse();
    $this->getJson('/api/academy')->assertOk()
        ->assertJsonPath('academy.online_lessons', false)
        ->assertJsonPath('academy.online_lessons_effective', false);

    $this->patchJson('/api/academy', ['online_lessons' => null])->assertOk();
    $this->getJson('/api/academy')->assertOk()
        ->assertJsonPath('academy.online_lessons', null)
        ->assertJsonPath('academy.online_lessons_effective', true);
});

it('is written by settings.manage only, and moves nothing else of the academy', function () {
    Sanctum::actingAs($this->supervisor);
    $this->patchJson('/api/academy', ['online_lessons' => false])->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/academy', ['level_label' => 'GRADE'])->assertOk();
    $this->patchJson('/api/academy', ['online_lessons' => false])->assertOk();
    $this->patchJson('/api/academy', ['online_lessons' => 'maybe'])->assertStatus(422);

    $academy = $this->getJson('/api/academy')->assertOk()->json('academy');
    expect($academy['name'])->toBe('Lingo')
        ->and($academy['country'])->toBe('EG')
        ->and($academy['default_currency'])->toBe('EGP')
        ->and($academy['level_label'])->toBe('GRADE')
        ->and($academy['online_lessons'])->toBeFalse();

    // A later country save leaves it where it is.
    $this->patchJson('/api/academy', ['country' => 'SA'])->assertOk();
    expect($this->getJson('/api/academy')->json('academy.online_lessons'))->toBeFalse();
});
