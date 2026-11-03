<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * Levels / grades (docs/centre-profile, Phase 2.1). Pinned here:
 *   - the list is the academy's own, ordered, unique by name, and a level in use is never deleted;
 *   - a student and a group point at a level, and payloads carry its name;
 *   - a promotion writes history and moves the membership on the day, through the groups service;
 *   - all of it is a centre's: a Quran academy gets 402 and its own endpoints do not change.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-levels@test.local']);
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-levels@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $teacherUser->getKey()]);
    $this->guardian = $this->createGuardian($this->academy);
    $this->adam = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function levelsInContext(string $academyId, callable $fn): mixed
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        return $fn();
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function levelsCentreOn(string $academyId): void
{
    levelsInContext($academyId, fn () => DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]));
}

function levelsAdd($test, string $name, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/levels', ['name' => $name] + $over)->assertCreated()->json('levelId');
}

function levelsGroup($test, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', array_merge([
        'name' => 'English — evening', 'teacher_id' => $test->teacher, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ], $over))->assertCreated()->json('group.id');
}

// ── The switch ───────────────────────────────────────────────────────────────

it('is not there for an academy without the centre switch', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/levels')->assertStatus(402);
    $this->postJson('/api/levels', ['name' => 'A1'])->assertStatus(402);
    $this->postJson("/api/students/{$this->adam}/promote", ['to_level_id' => (string) Str::uuid()])->assertStatus(402);
    $this->getJson("/api/students/{$this->adam}/level-history")->assertStatus(402);
});

it('leaves a Quran academy\'s student and group endpoints as they were', function () {
    Sanctum::actingAs($this->owner);

    $studentId = $this->postJson('/api/students', [
        'full_name' => 'Yusuf', 'guardian_id' => $this->guardian, 'status' => 'REGULAR',
    ])->assertCreated()->json('studentId');
    $this->getJson("/api/students/{$studentId}")->assertOk()
        ->assertJsonPath('student.level_id', null)
        ->assertJsonPath('student.level_name', null);
    $row = collect($this->getJson('/api/students')->assertOk()->json('rows'))->firstWhere('id', $studentId);
    expect($row['level_id'])->toBeNull()->and($row['level_name'])->toBeNull();

    // The free text still works on its own, and no level row appears behind it.
    $groupId = levelsGroup($this, ['level' => 'A1']);
    $this->getJson("/api/groups/{$groupId}")->assertOk()
        ->assertJsonPath('group.level', 'A1')
        ->assertJsonPath('group.level_id', null);
    expect(levelsInContext($this->academy, fn () => DB::table('academy_levels')->count()))->toBe(0);
});

// ── The list ─────────────────────────────────────────────────────────────────

it('keeps an ordered list, unique by name, that renames and reorders', function () {
    levelsCentreOn($this->academy);
    $a1 = levelsAdd($this, 'A1');
    $a2 = levelsAdd($this, 'A2');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/levels', ['name' => ' a1 '])->assertStatus(422);

    $names = collect($this->getJson('/api/levels')->assertOk()->json('levels'))->pluck('name')->all();
    expect($names)->toBe(['A1', 'A2']);

    $this->patchJson("/api/levels/{$a2}", ['sort_order' => 0])->assertOk();
    $this->patchJson("/api/levels/{$a1}", ['sort_order' => 1, 'name' => 'Beginner'])->assertOk();
    $this->patchJson("/api/levels/{$a2}", ['is_active' => false])->assertOk();

    $levels = $this->getJson('/api/levels')->assertOk()->json('levels');
    expect(array_column($levels, 'name'))->toBe(['A2', 'Beginner'])
        ->and($levels[0]['is_active'])->toBeFalse()
        ->and($levels[1]['students_count'])->toBe(0);
});

it('refuses to delete a level a student or a group stands at, and deletes an unused one', function () {
    levelsCentreOn($this->academy);
    $a1 = levelsAdd($this, 'A1');
    $spare = levelsAdd($this, 'Spare');

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/students/{$this->adam}", ['level_id' => $a1])->assertOk();
    $this->deleteJson("/api/levels/{$a1}")->assertStatus(422)->assertJsonValidationErrors(['level']);
    $this->getJson('/api/levels')->assertOk()->assertJsonPath('levels.0.students_count', 1);

    $this->deleteJson("/api/levels/{$spare}")->assertOk();
    expect(collect($this->getJson('/api/levels')->json('levels'))->pluck('id')->all())->toBe([$a1]);
});

// ── Students and groups ──────────────────────────────────────────────────────

it('puts a student at a level and says its name on the list and the profile', function () {
    levelsCentreOn($this->academy);
    $a1 = levelsAdd($this, 'A1');
    $off = levelsAdd($this, 'Old');
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/levels/{$off}", ['is_active' => false])->assertOk();

    $studentId = $this->postJson('/api/students', [
        'full_name' => 'Celine', 'guardian_id' => $this->guardian, 'status' => 'REGULAR', 'level_id' => $a1,
    ])->assertCreated()->json('studentId');

    $this->getJson("/api/students/{$studentId}")->assertOk()
        ->assertJsonPath('student.level_id', $a1)
        ->assertJsonPath('student.level_name', 'A1');

    $rows = $this->getJson('/api/students?filter[level_id]='.$a1)->assertOk()->json('rows');
    expect(array_column($rows, 'id'))->toBe([$studentId])
        ->and($rows[0]['level_name'])->toBe('A1');

    // Not one of ours, or switched off: refused.
    $this->patchJson("/api/students/{$studentId}", ['level_id' => (string) Str::uuid()])->assertStatus(422);
    $this->patchJson("/api/students/{$studentId}", ['level_id' => $off])->assertStatus(422);
    $this->patchJson("/api/students/{$studentId}", ['level_id' => null])->assertOk();
    $this->getJson("/api/students/{$studentId}")->assertOk()->assertJsonPath('student.level_id', null);
});

it('gives a group its level from the list and keeps the level text in step with it', function () {
    levelsCentreOn($this->academy);
    $a1 = levelsAdd($this, 'A1');
    $a2 = levelsAdd($this, 'A2');

    $groupId = levelsGroup($this, ['level_id' => $a1]);
    $this->getJson("/api/groups/{$groupId}")->assertOk()
        ->assertJsonPath('group.level_id', $a1)
        ->assertJsonPath('group.level', 'A1');

    $this->patchJson("/api/groups/{$groupId}", ['level_id' => $a2])->assertOk()
        ->assertJsonPath('group.level', 'A2');

    // Renaming the level renames what every group of it prints.
    $this->patchJson("/api/levels/{$a2}", ['name' => 'Elementary'])->assertOk();
    $this->getJson("/api/groups/{$groupId}")->assertOk()->assertJsonPath('group.level', 'Elementary');

    expect(collect($this->getJson('/api/groups?level_id='.$a2)->assertOk()->json('groups'))->pluck('id')->all())->toBe([$groupId])
        ->and($this->getJson('/api/groups?level_id='.$a1)->assertOk()->json('groups'))->toBe([]);

    $this->postJson('/api/groups', [
        'name' => 'Bad', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01', 'level_id' => (string) Str::uuid(),
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertStatus(422);
});

// ── Promotion ────────────────────────────────────────────────────────────────

it('promotes a student up a level and into a group of it, with history and the right dates', function () {
    levelsCentreOn($this->academy);
    $a1 = levelsAdd($this, 'A1');
    $a2 = levelsAdd($this, 'A2');
    $from = levelsGroup($this, ['name' => 'A1 evening', 'level_id' => $a1, 'student_ids' => [$this->adam]]);
    $to = levelsGroup($this, ['name' => 'A2 evening', 'level_id' => $a2, 'capacity' => 1]);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/students/{$this->adam}", ['level_id' => $a1])->assertOk();

    $res = $this->postJson("/api/students/{$this->adam}/promote", [
        'to_level_id' => $a2, 'to_group_id' => $to, 'effective_on' => '2026-06-20', 'note' => 'Passed the A1 test',
    ])->assertOk();
    $res->assertJsonPath('promotion.from_level_id', $a1)
        ->assertJsonPath('promotion.to_level_id', $a2)
        ->assertJsonPath('promotion.from_group_id', $from)
        ->assertJsonPath('promotion.to_group_id', $to)
        ->assertJsonPath('promotion.to_level_name', 'A2');

    $this->getJson("/api/students/{$this->adam}")->assertOk()->assertJsonPath('student.level_id', $a2);

    $members = levelsInContext($this->academy, fn () => DB::table('class_group_members')
        ->where('student_id', $this->adam)->orderBy('joined_on')->get());
    expect($members)->toHaveCount(2)
        ->and((string) $members[0]->group_id)->toBe($from)
        ->and($members[0]->status)->toBe('LEFT')
        ->and(Carbon::parse($members[0]->left_on)->format('Y-m-d'))->toBe('2026-06-20')
        ->and((string) $members[1]->group_id)->toBe($to)
        ->and($members[1]->status)->toBe('ACTIVE')
        ->and(Carbon::parse($members[1]->joined_on)->format('Y-m-d'))->toBe('2026-06-20');

    $history = $this->getJson("/api/students/{$this->adam}/level-history")->assertOk()
        ->assertJsonPath('level_name', 'A2')
        ->json('history');
    expect($history)->toHaveCount(1)
        ->and($history[0]['from_level_name'])->toBe('A1')
        ->and($history[0]['to_level_name'])->toBe('A2')
        ->and($history[0]['from_group_name'])->toBe('A1 evening')
        ->and($history[0]['to_group_name'])->toBe('A2 evening')
        ->and($history[0]['effective_on'])->toBe('2026-06-20')
        ->and($history[0]['note'])->toBe('Passed the A1 test');

    // The destination is full now: the next promotion into it is refused whole — level included.
    $dina = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Dina', 'status' => 'REGULAR']);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$dina}/promote", ['to_level_id' => $a2, 'to_group_id' => $to])->assertStatus(422);
    $this->getJson("/api/students/{$dina}")->assertOk()->assertJsonPath('student.level_id', null);
    expect($this->getJson("/api/students/{$dina}/level-history")->json('history'))->toBe([]);
});

it('promotes by level alone, dated today, and refuses an unknown or archived group', function () {
    levelsCentreOn($this->academy);
    $a1 = levelsAdd($this, 'A1');
    $archived = levelsGroup($this, ['level_id' => $a1]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$archived}/archive")->assertOk();

    $this->postJson("/api/students/{$this->adam}/promote", ['to_level_id' => $a1, 'to_group_id' => $archived])->assertStatus(422);
    $this->postJson("/api/students/{$this->adam}/promote", ['to_level_id' => (string) Str::uuid()])->assertStatus(422);

    $this->postJson("/api/students/{$this->adam}/promote", ['to_level_id' => $a1])->assertOk()
        ->assertJsonPath('promotion.from_level_id', null)
        ->assertJsonPath('promotion.to_group_id', null)
        ->assertJsonPath('promotion.effective_on', '2026-06-17')
        ->assertJsonPath('history.0.to_level_name', 'A1');
    $this->getJson("/api/students/{$this->adam}")->assertOk()->assertJsonPath('student.level_name', 'A1');
});

// ── Back-fill ────────────────────────────────────────────────────────────────

it('turns the groups\' level texts into the list, in order of first appearance', function () {
    $b1 = levelsGroup($this, ['name' => 'G1', 'level' => ' B1 ']);
    $a1 = levelsGroup($this, ['name' => 'G2', 'level' => 'A1']);
    $b1b = levelsGroup($this, ['name' => 'G3', 'level' => 'B1']);
    $none = levelsGroup($this, ['name' => 'G4']);
    // Created in one transaction they share a clock; give them the order they were made in.
    levelsInContext($this->academy, function () use ($b1, $a1, $b1b): void {
        foreach ([$b1 => '2026-05-01', $a1 => '2026-05-02', $b1b => '2026-05-03'] as $id => $day) {
            DB::table('class_groups')->where('id', $id)->update(['level_id' => null, 'created_at' => $day.' 10:00:00+00']);
        }
    });

    $migration = require database_path('migrations/2026_11_04_100001_academy_levels.php');
    expect($migration->fill())->toBe(2);
    // Idempotent: a second pass adds nothing.
    expect($migration->fill())->toBe(0);

    levelsInContext($this->academy, function () use ($b1, $a1, $b1b, $none): void {
        $levels = DB::table('academy_levels')->orderBy('sort_order')->get();
        expect($levels->pluck('name')->all())->toBe(['B1', 'A1']);
        $groups = DB::table('class_groups')->whereIn('id', [$b1, $a1, $b1b, $none])->pluck('level_id', 'id');
        expect((string) $groups[$b1])->toBe((string) $levels[0]->id)
            ->and((string) $groups[$b1b])->toBe((string) $levels[0]->id)
            ->and((string) $groups[$a1])->toBe((string) $levels[1]->id)
            ->and($groups[$none])->toBeNull();
    });
});
