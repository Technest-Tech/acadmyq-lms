<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->A = $this->createAcademy(overrides: ['name' => 'Al-Falah Academy']);
    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER');
});

// ── An academy that never edited gets a sendable card on day one, with nothing written ──
it('returns polished defaults for an academy that never edited its card', function () {
    Sanctum::actingAs($this->ownerA);

    $content = $this->getJson('/api/report-card-template')->assertOk()->json('content');

    expect($content['headlineAr'])->toBe('تقرير إنجاز بطلنا اليوم');
    expect($content['accentColor'])->toBe('#0E7C5A');
    expect($content['duaAr'])->not->toBe('');
    // The illustrated card is the default: the reader who has to want it is a child.
    expect($content['cardStyle'])->toBe('joyful');

    // Defaults are NOT persisted until an explicit save.
    $this->asAcademy($this->A);
    expect(DB::table('report_card_templates')->where('academy_id', $this->A)->count())->toBe(0);
});

// ── Saving merges over the defaults rather than replacing the whole blob ──
it('saves edited wording and merges it over the untouched defaults', function () {
    Sanctum::actingAs($this->ownerA);

    $this->putJson('/api/report-card-template', [
        'headlineAr' => 'تقرير حلقة {student}',
        'taglineEn' => 'Every verse, a step closer',
        'accentColor' => '#123456',
    ])->assertOk()->assertJson(['ok' => true]);

    $content = $this->getJson('/api/report-card-template')->assertOk()->json('content');

    expect($content['headlineAr'])->toBe('تقرير حلقة {student}');
    expect($content['taglineEn'])->toBe('Every verse, a step closer');
    expect($content['accentColor'])->toBe('#123456');
    // Untouched fields keep their defaults (merge, not replace).
    expect($content['duaAr'])->toContain('اللهم اجعل القرآن');

    $this->asAcademy($this->A);
    expect(DB::table('report_card_templates')->where('academy_id', $this->A)->count())->toBe(1);
});

// ── One row per academy, however many times it is saved ──
it('upserts the same row on repeated saves', function () {
    Sanctum::actingAs($this->ownerA);

    $this->putJson('/api/report-card-template', ['taglineEn' => 'First'])->assertOk();
    $this->putJson('/api/report-card-template', ['taglineEn' => 'Second'])->assertOk();

    $this->asAcademy($this->A);
    expect(DB::table('report_card_templates')->where('academy_id', $this->A)->count())->toBe(1);

    Sanctum::actingAs($this->ownerA);
    expect($this->getJson('/api/report-card-template')->json('content.taglineEn'))->toBe('Second');
});

// ── Turning the artwork off is a saved choice, and only the two known styles are accepted ──
it('saves the classic card style and rejects an unknown one', function () {
    Sanctum::actingAs($this->ownerA);

    $this->putJson('/api/report-card-template', ['cardStyle' => 'classic'])->assertOk();
    expect($this->getJson('/api/report-card-template')->json('content.cardStyle'))->toBe('classic');

    $this->putJson('/api/report-card-template', ['cardStyle' => 'sparkly'])
        ->assertStatus(422)->assertJsonValidationErrors('cardStyle');
});

// ── A malformed accent colour is rejected ──
it('rejects a non-hex accent colour', function () {
    Sanctum::actingAs($this->ownerA);
    $this->putJson('/api/report-card-template', ['accentColor' => 'gold'])
        ->assertStatus(422)->assertJsonValidationErrors('accentColor');
});

// ── The split that matters: a teacher may PREVIEW a card but may not rewrite the academy's voice ──
it('lets a teacher read the card wording but not edit it', function () {
    $teacher = $this->makeUser($this->A, 'TEACHER');
    Sanctum::actingAs($teacher);

    $this->getJson('/api/report-card-template')->assertOk();
    $this->putJson('/api/report-card-template', ['taglineEn' => 'nope'])->assertForbidden();
});

// ── One academy's wording never leaks into another (RLS isolation) ──
it("keeps one academy's card isolated from another", function () {
    $B = $this->createAcademy(overrides: ['name' => 'Other Academy']);
    $ownerB = $this->makeUser($B, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->ownerA);
    $this->putJson('/api/report-card-template', ['taglineEn' => 'A-only tagline'])->assertOk();

    Sanctum::actingAs($ownerB);
    expect($this->getJson('/api/report-card-template')->assertOk()->json('content.taglineEn'))
        ->toBe('Planting a love of the Qur’an — raising a generation of its people');

    $this->asAcademy($B);
    expect(DB::table('report_card_templates')->where('academy_id', $B)->count())->toBe(0);
});
