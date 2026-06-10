<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->other = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-dt@test.local']);
    $this->teacher1 = $this->createTeacher($this->academy, ['full_name' => 'Teacher One']);
    $this->teacher2 = $this->createTeacher($this->academy, ['full_name' => 'Teacher Two']);
    $this->guardian = $this->createGuardian($this->academy, ['full_name' => 'Guardian One']);
});

function makeStudent(string $name, string $teacherId, int $price)
{
    $sid = test()->postJson('/api/students', [
        'full_name' => $name,
        'guardian_id' => test()->guardian,
        'teacher_id' => $teacherId,
        'subscription' => [
            'plan_label' => 'p', 'price_minor' => $price, 'currency' => 'EGP',
            'price_basis' => 'PER_SESSION', 'start_date' => '2026-06-01',
        ],
    ])->assertCreated()->json('studentId');

    return $sid;
}

// ── TC-4.19 / AC-4.8, AC-4.11: search returns matches within the academy only ─
it('searches students within the academy scope only', function () {
    Sanctum::actingAs($this->owner);
    makeStudent('محمد علي', $this->teacher1, 10000);
    makeStudent('Sara', $this->teacher2, 10000);

    // A same-named student exists in ANOTHER academy and must never appear.
    $otherGuardian = $this->createGuardian($this->other, ['full_name' => 'Other G']);
    $this->createStudent($this->other, $otherGuardian, ['full_name' => 'محمد علي']);

    $rows = $this->getJson('/api/students?search='.urlencode('محمد'))->assertOk()->json('rows');
    expect($rows)->toHaveCount(1);
    expect($rows[0]['full_name'])->toBe('محمد علي');
});

// ── TC-4.20 / AC-4.8: filter students by teacher ─────────────────────────────
it('filters students by teacher', function () {
    Sanctum::actingAs($this->owner);
    makeStudent('A', $this->teacher1, 10000);
    makeStudent('B', $this->teacher1, 10000);
    makeStudent('C', $this->teacher2, 10000);

    $rows = $this->getJson("/api/students?filter[teacher_id]={$this->teacher1}")->assertOk()->json('rows');
    expect($rows)->toHaveCount(2);
    expect(collect($rows)->pluck('teacher_id')->unique()->all())->toBe([$this->teacher1]);
});

// ── TC-4.21 / AC-4.8: sort by price descending ───────────────────────────────
it('sorts by price descending', function () {
    Sanctum::actingAs($this->owner);
    makeStudent('Cheap', $this->teacher1, 5000);
    makeStudent('Mid', $this->teacher1, 10000);
    makeStudent('Dear', $this->teacher2, 20000);

    $rows = $this->getJson('/api/students?sort=-price')->assertOk()->json('rows');
    expect(collect($rows)->pluck('price_minor')->all())->toBe([20000, 10000, 5000]);
});

// ── TC-4.22 / AC-4.8: pagination is stable and non-overlapping ───────────────
it('paginates with stable, non-overlapping pages', function () {
    Sanctum::actingAs($this->owner);
    foreach (range(1, 5) as $i) {
        makeStudent('Student '.str_pad((string) $i, 2, '0', STR_PAD_LEFT), $this->teacher1, 10000);
    }

    $p1 = $this->getJson('/api/students?sort=name&page=1&pageSize=2')->assertOk();
    expect($p1->json('total'))->toBe(5);
    expect($p1->json('rows'))->toHaveCount(2);

    $p2 = $this->getJson('/api/students?sort=name&page=2&pageSize=2')->assertOk()->json('rows');
    $p1ids = collect($p1->json('rows'))->pluck('id');
    $p2ids = collect($p2)->pluck('id');
    expect($p1ids->intersect($p2ids))->toBeEmpty();
});

// ── TC-4.23 / AC-4.8: an empty academy returns an empty result set ───────────
it('returns an empty result set for an empty academy', function () {
    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/students')->assertOk();
    expect($res->json('total'))->toBe(0);
    expect($res->json('rows'))->toBe([]);
});

// ── TC-4.24 / AC-4.9: a crafted sort key is rejected by the allowlist ────────
it('rejects a crafted sort key with no SQL executed', function () {
    Sanctum::actingAs($this->owner);
    makeStudent('Safe', $this->teacher1, 10000);

    $this->getJson('/api/students?sort='.urlencode('name);drop table students;--'))
        ->assertStatus(422)
        ->assertJsonValidationErrors('sort');

    // The table is untouched — the student is still there.
    expect($this->getJson('/api/students')->json('total'))->toBe(1);
});

// ── TC-4.24 (extension): an unknown filter key is ignored, not injected ──────
it('ignores an unknown filter key', function () {
    Sanctum::actingAs($this->owner);
    makeStudent('Safe', $this->teacher1, 10000);

    $this->getJson('/api/students?filter[evil]=1')->assertOk()->assertJsonPath('total', 1);
});
