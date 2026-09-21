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

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-family@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ustadh Karim']);
});

/** @return string the new guardian's id */
function familyGuardian(string $name, string $phone): string
{
    return test()->postJson('/api/guardians', ['full_name' => $name, 'whatsapp_phone' => $phone])
        ->assertCreated()->json('guardianId');
}

// ── Moving a child between families ──────────────────────────────────────────

it('moves a student to a different guardian and audits the move', function () {
    Sanctum::actingAs($this->owner);

    $from = familyGuardian('Old Family', '+201000000101');
    $to = familyGuardian('New Family', '+201000000102');
    $studentId = $this->postJson('/api/students', ['full_name' => 'Yusuf', 'guardian_id' => $from])
        ->assertCreated()->json('studentId');

    $this->patchJson("/api/students/{$studentId}", ['guardian_id' => $to])
        ->assertOk()
        ->assertJsonPath('changed', ['guardian_id', 'is_self_guardian']);

    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $studentId)->value('guardian_id'))->toBe($to);

    // The move is its own audit action, not a field edit buried in student.update.
    $entry = DB::table('audit_log')
        ->where('entity_id', $studentId)
        ->where('action', 'student.guardian_reassigned')
        ->first();
    expect($entry)->not->toBeNull();
    expect(json_decode((string) $entry->before, true)['guardian_id'])->toBe($from);
    expect(json_decode((string) $entry->after, true)['guardian_id'])->toBe($to);

    // …and the new family's detail now lists them.
    Sanctum::actingAs($this->owner);
    expect($this->getJson("/api/guardians/{$to}")->assertOk()->json('children.0.full_name'))->toBe('Yusuf');
    expect($this->getJson("/api/guardians/{$from}")->assertOk()->json('children'))->toHaveCount(0);
});

it('drops the adult-solo flag when a real guardian takes over the billing', function () {
    Sanctum::actingAs($this->owner);

    $studentId = $this->postJson('/api/students', [
        'full_name' => 'Adult Learner',
        'is_self_guardian' => true,
        'whatsapp_phone' => '+201000000103',
    ])->assertCreated()->json('studentId');

    $family = familyGuardian('Sponsoring Family', '+201000000104');
    $this->patchJson("/api/students/{$studentId}", ['guardian_id' => $family])->assertOk();

    $this->asAcademy($this->academy);
    $student = DB::table('students')->where('id', $studentId)->first();
    expect($student->guardian_id)->toBe($family);
    expect($student->is_self_guardian)->toBeFalse();
});

it('refuses to move a student to an unknown or deactivated guardian', function () {
    Sanctum::actingAs($this->owner);

    $from = familyGuardian('Home', '+201000000105');
    $gone = familyGuardian('Retired', '+201000000106');
    $this->postJson("/api/guardians/{$gone}/deactivate")->assertOk();

    $studentId = $this->postJson('/api/students', ['full_name' => 'Maryam', 'guardian_id' => $from])->json('studentId');

    $this->patchJson("/api/students/{$studentId}", ['guardian_id' => $gone])
        ->assertStatus(422)->assertJsonValidationErrors('guardian_id');
    $this->patchJson("/api/students/{$studentId}", ['guardian_id' => (string) Str::uuid()])
        ->assertStatus(422)->assertJsonValidationErrors('guardian_id');

    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $studentId)->value('guardian_id'))->toBe($from);
});

// ── The family-shaped list ───────────────────────────────────────────────────

it('carries each family size and filters on it', function () {
    Sanctum::actingAs($this->owner);

    $big = familyGuardian('Three Kids', '+201000000107');
    $one = familyGuardian('One Kid', '+201000000108');
    $none = familyGuardian('No Kids Yet', '+201000000109');

    foreach (['A', 'B', 'C'] as $name) {
        $this->postJson('/api/students', ['full_name' => "Child {$name}", 'guardian_id' => $big])->assertCreated();
    }
    $this->postJson('/api/students', ['full_name' => 'Only Child', 'guardian_id' => $one])->assertCreated();

    $rows = collect($this->getJson('/api/guardians')->assertOk()->json('rows'))->keyBy('id');
    expect((int) $rows[$big]['children_count'])->toBe(3);
    expect((int) $rows[$one]['children_count'])->toBe(1);
    expect((int) $rows[$none]['children_count'])->toBe(0);

    // The card names its children, so the board needs no request per family.
    expect(collect($rows[$big]['children'])->pluck('full_name')->all())
        ->toBe(['Child A', 'Child B', 'Child C']);
    expect($rows[$none]['children'])->toBe([]);

    $multi = collect($this->getJson('/api/guardians?filter[family]=multi')->assertOk()->json('rows'))->pluck('id');
    expect($multi)->toContain($big)->not->toContain($one)->not->toContain($none);

    $single = collect($this->getJson('/api/guardians?filter[family]=single')->assertOk()->json('rows'))->pluck('id');
    expect($single)->toContain($one)->not->toContain($big);

    // Largest family first.
    $sorted = collect($this->getJson('/api/guardians?sort=-children')->assertOk()->json('rows'))->pluck('id');
    expect($sorted->first())->toBe($big);
});

it('finds a parent by their child\'s name', function () {
    Sanctum::actingAs($this->owner);

    $dad = familyGuardian('Abu Zayd', '+201000000110');
    $other = familyGuardian('Someone Else', '+201000000111');
    $this->postJson('/api/students', ['full_name' => 'Zaynab', 'guardian_id' => $dad])->assertCreated();

    $hits = collect($this->getJson('/api/guardians?search=Zaynab')->assertOk()->json('rows'))->pluck('id');
    expect($hits)->toContain($dad)->not->toContain($other);

    // A child-name hit still respects the other filters rather than widening past them.
    $none = $this->getJson('/api/guardians?search=Zaynab&filter[family]=none')->assertOk()->json('rows');
    expect($none)->toHaveCount(0);
});

// ── The family file ──────────────────────────────────────────────────────────

it('returns each child with their teacher and billing terms', function () {
    Sanctum::actingAs($this->owner);

    $guardianId = familyGuardian('Detailed Family', '+201000000112');
    $this->postJson('/api/students', [
        'full_name' => 'Hafsa',
        'guardian_id' => $guardianId,
        'teacher_id' => $this->teacher,
        'subscription' => [
            'plan_label' => '8/month', 'sessions_per_month' => 8,
            'price_minor' => 12000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION',
            'start_date' => '2026-06-01',
        ],
    ])->assertCreated();

    $child = $this->getJson("/api/guardians/{$guardianId}")->assertOk()->json('children.0');
    expect($child['teacher_name'])->toBe('Ustadh Karim');
    expect($child['plan_label'])->toBe('8/month');
    expect($child['price_minor'])->toBe(12000);
    expect($child['price_currency'])->toBe('EGP');
});

it('blanks a child\'s money for a role that may not price', function () {
    Sanctum::actingAs($this->owner);

    $guardianId = familyGuardian('Priced Family', '+201000000113');
    $this->postJson('/api/students', [
        'full_name' => 'Bilal',
        'guardian_id' => $guardianId,
        'subscription' => [
            'plan_label' => '4/month', 'price_minor' => 9000,
            'currency' => 'EGP', 'start_date' => '2026-06-01',
        ],
    ])->assertCreated();

    $supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'supervisor-family@test.local']);
    Sanctum::actingAs($supervisor);

    $child = $this->getJson("/api/guardians/{$guardianId}")->assertOk()->json('children.0');
    // Present and null — "not your business", never "no subscription".
    expect($child)->toHaveKey('price_minor');
    expect($child['price_minor'])->toBeNull();
    expect($child['plan_label'])->toBe('4/month');
});

it('leaves the billing currency alone when an edit sends it blank', function () {
    Sanctum::actingAs($this->owner);

    $guardianId = familyGuardian('Blank Currency', '+201000000115');

    // The column is NOT NULL; a cleared field means "leave it", not "erase it".
    $this->patchJson("/api/guardians/{$guardianId}", ['full_name' => 'Renamed', 'currency' => null])
        ->assertOk();

    $this->asAcademy($this->academy);
    $guardian = DB::table('guardians')->where('id', $guardianId)->first();
    expect($guardian->currency)->toBe('EGP');
    expect($guardian->full_name)->toBe('Renamed');
});

// ── The way back ─────────────────────────────────────────────────────────────

it('reactivates a deactivated guardian', function () {
    Sanctum::actingAs($this->owner);

    $guardianId = familyGuardian('Paused Family', '+201000000114');
    $this->postJson("/api/guardians/{$guardianId}/deactivate")->assertOk();

    expect(collect($this->getJson('/api/guardians')->json('rows'))->pluck('id'))->not->toContain($guardianId);

    $this->postJson("/api/guardians/{$guardianId}/reactivate")->assertOk();
    expect(collect($this->getJson('/api/guardians')->json('rows'))->pluck('id'))->toContain($guardianId);

    // Already active — nothing to undo.
    $this->postJson("/api/guardians/{$guardianId}/reactivate")->assertNotFound();
});
