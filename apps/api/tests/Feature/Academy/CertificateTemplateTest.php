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

// ── Every design is returned, with defaults filled and the academy name pre-filled ──
it('returns every design with defaults for an academy that never edited them', function () {
    Sanctum::actingAs($this->ownerA);

    $templates = $this->getJson('/api/certificate-templates')->assertOk()->json('templates');

    expect($templates)->toHaveCount(9);
    expect(collect($templates)->pluck('templateNumber')->all())->toBe([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(collect($templates)->pluck('customized')->unique()->all())->toBe([false]);

    $first = $templates[0];
    expect($first['content']['titleEn'])->toBe('Certificate of Achievement');
    expect($first['content']['academyNameEn'])->toBe('Al-Falah Academy');
    expect($first['content']['accentColor'])->toBe('#C9A227');
    expect($first['content']['showLogo'])->toBeTrue();
    // Each design ships its own wording.
    expect(collect($templates)->pluck('content.titleEn')->unique())->toHaveCount(9);

    // Defaults are NOT persisted until an explicit save.
    $this->asAcademy($this->A);
    expect(DB::table('certificate_templates')->where('academy_id', $this->A)->count())->toBe(0);
});

// ── Saving a template persists the edited wording and is reflected on the next read ──
it('saves edited content for a template and returns it on the next read', function () {
    Sanctum::actingAs($this->ownerA);

    $this->putJson('/api/certificate-templates/1', [
        'titleEn' => 'Hifz Completion',
        'titleAr' => 'إتمام الحفظ',
        'signatoryNameEn' => 'Sheikh Ahmad',
        'accentColor' => '#123456',
    ])->assertOk()->assertJson(['ok' => true]);

    $templates = $this->getJson('/api/certificate-templates')->assertOk()->json('templates');
    $one = collect($templates)->firstWhere('templateNumber', 1);

    expect($one['content']['titleEn'])->toBe('Hifz Completion');
    expect($one['content']['signatoryNameEn'])->toBe('Sheikh Ahmad');
    expect($one['content']['accentColor'])->toBe('#123456');
    // Untouched fields keep their defaults (merge, not replace).
    expect($one['content']['presentationEn'])->toBe('This certificate is proudly presented to');

    $this->asAcademy($this->A);
    expect(DB::table('certificate_templates')->where('academy_id', $this->A)->where('template_number', 1)->count())->toBe(1);
});

// ── A second save edits in place (one row per template, upsert) ──
it('upserts the same template row on repeated saves', function () {
    Sanctum::actingAs($this->ownerA);

    $this->putJson('/api/certificate-templates/2', ['titleEn' => 'First'])->assertOk();
    $this->putJson('/api/certificate-templates/2', ['titleEn' => 'Second'])->assertOk();

    $this->asAcademy($this->A);
    expect(DB::table('certificate_templates')->where('academy_id', $this->A)->where('template_number', 2)->count())->toBe(1);

    Sanctum::actingAs($this->ownerA);
    $two = collect($this->getJson('/api/certificate-templates')->json('templates'))->firstWhere('templateNumber', 2);
    expect($two['content']['titleEn'])->toBe('Second');
});

// ── An unknown template number is a 404 ──
it('rejects an unknown template number', function () {
    Sanctum::actingAs($this->ownerA);
    $this->putJson('/api/certificate-templates/0', ['titleEn' => 'x'])->assertNotFound();
    $this->putJson('/api/certificate-templates/10', ['titleEn' => 'x'])->assertNotFound();
});

// ── A design beyond the original two saves like any other ──
it('saves a design from the extended catalogue', function () {
    Sanctum::actingAs($this->ownerA);

    $this->putJson('/api/certificate-templates/9', [
        'titleEn' => 'Juz Amma Star',
        'signatory2NameEn' => 'Ustadha Maryam',
        'signatory2TitleEn' => 'Class Teacher',
        'showLogo' => false,
    ])->assertOk();

    $nine = collect($this->getJson('/api/certificate-templates')->json('templates'))->firstWhere('templateNumber', 9);
    expect($nine['customized'])->toBeTrue();
    expect($nine['content']['titleEn'])->toBe('Juz Amma Star');
    expect($nine['content']['signatory2NameEn'])->toBe('Ustadha Maryam');
    expect($nine['content']['showLogo'])->toBeFalse();
    // The design's own defaults travel alongside, untouched by the save.
    expect($nine['defaults']['titleEn'])->toBe('Young Hafiz Certificate');
});

// ── Designs the academy never opened inherit its brand, but keep their own wording ──
it('carries the latest saved brand into designs the academy has not edited', function () {
    Sanctum::actingAs($this->ownerA);

    $this->putJson('/api/certificate-templates/1', [
        'academyNameEn' => 'Al-Falah Qur’an School',
        'signatoryNameEn' => 'Sheikh Ahmad',
        'signatoryTitleEn' => 'Principal',
        'titleEn' => 'Only on Al-Noor',
    ])->assertOk();

    $templates = collect($this->getJson('/api/certificate-templates')->json('templates'));
    $four = $templates->firstWhere('templateNumber', 4);

    expect($four['customized'])->toBeFalse();
    expect($four['content']['academyNameEn'])->toBe('Al-Falah Qur’an School');
    expect($four['content']['signatoryNameEn'])->toBe('Sheikh Ahmad');
    expect($four['content']['signatoryTitleEn'])->toBe('Principal');
    expect($four['content']['titleEn'])->toBe('Certificate of Completion');
});

// ── showLogo must be a boolean ──
it('rejects a non-boolean logo toggle', function () {
    Sanctum::actingAs($this->ownerA);
    $this->putJson('/api/certificate-templates/1', ['showLogo' => 'sometimes'])
        ->assertStatus(422)->assertJsonValidationErrors('showLogo');
});

// ── A malformed accent colour is rejected ──
it('rejects a non-hex accent colour', function () {
    Sanctum::actingAs($this->ownerA);
    $this->putJson('/api/certificate-templates/1', ['accentColor' => 'red'])
        ->assertStatus(422)->assertJsonValidationErrors('accentColor');
});

// ── A teacher cannot read or edit certificate templates (lacks the capability) ──
it('forbids a teacher from reading or editing certificate templates', function () {
    $teacher = $this->makeUser($this->A, 'TEACHER');
    Sanctum::actingAs($teacher);

    $this->getJson('/api/certificate-templates')->assertForbidden();
    $this->putJson('/api/certificate-templates/1', ['titleEn' => 'nope'])->assertForbidden();
});

// ── One academy's edits never leak into another academy (RLS isolation) ──
it('keeps one academy\'s templates isolated from another', function () {
    $B = $this->createAcademy(overrides: ['name' => 'Other Academy']);
    $ownerB = $this->makeUser($B, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->ownerA);
    $this->putJson('/api/certificate-templates/1', ['titleEn' => 'A-only title'])->assertOk();

    Sanctum::actingAs($ownerB);
    $bTemplates = $this->getJson('/api/certificate-templates')->assertOk()->json('templates');
    $bOne = collect($bTemplates)->firstWhere('templateNumber', 1);

    // B sees defaults, not A's edit, and its academy name is its own.
    expect($bOne['content']['titleEn'])->toBe('Certificate of Achievement');
    expect($bOne['content']['academyNameEn'])->toBe('Other Academy');

    $this->asAcademy($B);
    expect(DB::table('certificate_templates')->where('academy_id', $B)->count())->toBe(0);
});
