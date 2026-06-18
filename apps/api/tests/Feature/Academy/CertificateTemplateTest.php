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

// ── Both templates are returned, with defaults filled and the academy name pre-filled ──
it('returns two templates with defaults for an academy that never edited them', function () {
    Sanctum::actingAs($this->ownerA);

    $templates = $this->getJson('/api/certificate-templates')->assertOk()->json('templates');

    expect($templates)->toHaveCount(2);
    expect(collect($templates)->pluck('templateNumber')->all())->toBe([1, 2]);

    $first = $templates[0];
    expect($first['content']['titleEn'])->toBe('Certificate of Achievement');
    expect($first['content']['academyNameEn'])->toBe('Al-Falah Academy');
    expect($first['content']['accentColor'])->toBe('#C9A227');

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
    $this->putJson('/api/certificate-templates/3', ['titleEn' => 'x'])->assertNotFound();
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
