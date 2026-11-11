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
 * The levels a teacher takes (EnglishSpirit, 2026-11-11). Pinned here: the set is written on create
 * and replaced whole on edit, read back in the academy's order on the list and the profile, filters
 * the list, and refuses a level that is not the academy's without writing anything.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-tlevels@test.local']);
    $this->other = $this->createAcademy(overrides: ['default_currency' => 'EGP']);

    // The academy's list, written straight in: B1 sits before A2 on purpose, so order is the list's.
    $this->level = function (string $academyId, string $name, int $order): string {
        $this->asAcademy($academyId);
        $id = (string) Str::uuid();
        DB::table('academy_levels')->insert(['id' => $id, 'academy_id' => $academyId, 'name' => $name, 'sort_order' => $order]);
        $this->clearTenantContext();

        return $id;
    };
    $this->b1 = ($this->level)($this->academy, 'B1', 1);
    $this->a2 = ($this->level)($this->academy, 'A2', 2);
    $this->c1 = ($this->level)($this->academy, 'C1', 3);
    $this->foreign = ($this->level)($this->other, 'Elsewhere', 1);

    $this->create = function (array $over = []) {
        Sanctum::actingAs($this->owner);

        return $this->postJson('/api/teachers', ['full_name' => 'Miss Sara', 'session_rate_minor' => 10000] + $over);
    };
});

it('keeps the levels a new teacher takes and reads them back in the academy order', function () {
    $id = ($this->create)(['level_ids' => [$this->a2, $this->b1]])->assertCreated()->json('teacherId');

    $show = $this->getJson("/api/teachers/{$id}")->assertOk();
    expect(collect($show->json('teacher.levels'))->pluck('name')->all())->toBe(['B1', 'A2']);

    $row = collect($this->getJson('/api/teachers')->assertOk()->json('rows'))->firstWhere('id', $id);
    expect(collect($row['levels'])->pluck('name')->all())->toBe(['B1', 'A2']);
});

it('gives a teacher with no levels an empty list, not null', function () {
    $id = ($this->create)()->assertCreated()->json('teacherId');

    expect($this->getJson("/api/teachers/{$id}")->json('teacher.levels'))->toBe([]);
    expect(collect($this->getJson('/api/teachers')->json('rows'))->firstWhere('id', $id)['levels'])->toBe([]);
});

it('replaces the whole set on edit, clears it with an empty list, and audits the change', function () {
    $id = ($this->create)(['level_ids' => [$this->b1]])->assertCreated()->json('teacherId');

    $this->patchJson("/api/teachers/{$id}", ['level_ids' => [$this->c1, $this->a2]])
        ->assertOk()->assertJsonPath('changed', ['level_ids']);
    expect(collect($this->getJson("/api/teachers/{$id}")->json('teacher.levels'))->pluck('name')->all())->toBe(['A2', 'C1']);

    // The same set again is no change at all.
    $this->patchJson("/api/teachers/{$id}", ['level_ids' => [$this->a2, $this->c1]])
        ->assertOk()->assertJsonPath('changed', []);

    $this->patchJson("/api/teachers/{$id}", ['level_ids' => []])->assertOk();
    expect($this->getJson("/api/teachers/{$id}")->json('teacher.levels'))->toBe([]);

    $this->asAcademy($this->academy);
    $audit = DB::table('audit_log')->where('entity_id', $id)->where('action', 'teacher.update')->orderBy('created_at')->first();
    expect(json_decode((string) $audit->after, true)['level_ids'])->toBe(collect([$this->a2, $this->c1])->sort()->values()->all());
});

it('leaves the levels alone when an edit does not send them', function () {
    $id = ($this->create)(['level_ids' => [$this->b1]])->assertCreated()->json('teacherId');

    $this->patchJson("/api/teachers/{$id}", ['full_name' => 'Miss Sara Ali'])->assertOk();

    expect(collect($this->getJson("/api/teachers/{$id}")->json('teacher.levels'))->pluck('id')->all())->toBe([$this->b1]);
});

it('filters the list to the teachers who take a level', function () {
    $sara = ($this->create)(['level_ids' => [$this->a2]])->assertCreated()->json('teacherId');
    $omar = ($this->create)(['full_name' => 'Mr Omar', 'level_ids' => [$this->c1]])->assertCreated()->json('teacherId');

    $ids = collect($this->getJson("/api/teachers?filter[level]={$this->a2}")->assertOk()->json('rows'))->pluck('id')->all();
    expect($ids)->toBe([$sara]);

    // Junk is no filter, not a 500.
    $all = collect($this->getJson('/api/teachers?filter[level]=soon')->assertOk()->json('rows'))->pluck('id')->all();
    expect($all)->toContain($sara, $omar);
});

it('refuses a level that is not the academy own, and writes nothing', function () {
    $before = (function () {
        $this->asAcademy($this->academy);

        return DB::table('teachers')->count();
    })->call($this);

    ($this->create)(['level_ids' => [$this->b1, $this->foreign]])->assertStatus(422)->assertJsonValidationErrors('level_ids');

    $this->asAcademy($this->academy);
    expect(DB::table('teachers')->count())->toBe($before)
        ->and(DB::table('teacher_levels')->count())->toBe(0);
});

it('does not half-apply an edit whose level is refused', function () {
    $id = ($this->create)(['level_ids' => [$this->b1]])->assertCreated()->json('teacherId');

    $this->patchJson("/api/teachers/{$id}", ['full_name' => 'Changed', 'level_ids' => [$this->foreign]])->assertStatus(422);

    $teacher = $this->getJson("/api/teachers/{$id}")->json('teacher');
    expect($teacher['full_name'])->toBe('Miss Sara')
        ->and(collect($teacher['levels'])->pluck('id')->all())->toBe([$this->b1]);
});

it('drops a deleted level from the teachers who took it', function () {
    $id = ($this->create)(['level_ids' => [$this->b1, $this->a2]])->assertCreated()->json('teacherId');

    $this->asAcademy($this->academy);
    DB::table('academy_levels')->where('id', $this->a2)->delete();
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson("/api/teachers/{$id}")->json('teacher.levels'))->pluck('name')->all())->toBe(['B1']);
});
