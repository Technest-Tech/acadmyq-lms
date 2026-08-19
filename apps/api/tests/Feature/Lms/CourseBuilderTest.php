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

/**
 * Phase 1 — the LMS course builder (docs/lms). The two gating layers: entitled:lms (402 without the
 * module) and course.read/course.manage (403 without the capability). RLS scopes every query to the
 * academy. LMS_BASIC grants `lms`; a MANAGEMENT plan (PRO) does not.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    // BASIC is the curated lower tier that does NOT bundle `lms` (FREE/PRO bundle every catalog
    // capability, so they DO include it) — the right plan to prove the entitlement gate bites.
    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    $this->teacher = $this->makeUser($this->academy, 'TEACHER');
});

// ── the happy path: build a course end to end ────────────────────────────────
it('builds a course with sections and lessons, then publishes it', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', ['title' => 'Intro to Chemistry'])
        ->assertCreated()->json('courseId');

    // A fresh course is a draft and cannot be published while empty.
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])
        ->assertStatus(422);

    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'Unit 1'])
        ->assertCreated()->json('sectionId');

    // A YouTube lesson — the pasted URL is parsed down to the 11-char id.
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId,
        'type' => 'YOUTUBE',
        'title' => 'What is an atom?',
        'youtube_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
    ])->assertCreated();

    // A text lesson.
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId,
        'type' => 'TEXT',
        'title' => 'Reading',
        'body' => '# The periodic table',
    ])->assertCreated();

    // The editor payload: course + nested outline.
    $show = $this->getJson("/api/courses/{$courseId}")->assertOk();
    $show->assertJsonPath('course.title', 'Intro to Chemistry')
        ->assertJsonPath('sections.0.title', 'Unit 1')
        ->assertJsonPath('sections.0.lessons.0.type', 'YOUTUBE')
        ->assertJsonPath('sections.0.lessons.0.youtube_video_id', 'dQw4w9WgXcQ')
        ->assertJsonPath('sections.0.lessons.1.type', 'TEXT');

    // Now it has lessons → publish succeeds.
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])
        ->assertOk()->assertJsonPath('status', 'PUBLISHED');

    $this->getJson('/api/courses/summary')->assertOk()
        ->assertJsonPath('published', 1)->assertJsonPath('total', 1);
});

// ── AC: entitlement gate (402) ───────────────────────────────────────────────
it('returns 402 for an academy without the LMS module', function () {
    $other = $this->createAcademy();
    $owner = $this->makeUser($other, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->getJson('/api/courses')->assertStatus(402);
    $this->postJson('/api/courses', ['title' => 'X'])->assertStatus(402);
});

// ── AC: capability gate (403) ────────────────────────────────────────────────
it('returns 403 when the role lacks course.read (a teacher)', function () {
    Sanctum::actingAs($this->teacher);

    $this->getJson('/api/courses')->assertStatus(403);
});

// ── AC: cross-tenant isolation (404, never a leak) ───────────────────────────
it('never lets one academy open another academy course', function () {
    Sanctum::actingAs($this->owner);
    $courseId = $this->postJson('/api/courses', ['title' => 'Private'])->assertCreated()->json('courseId');

    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $intruderAcademy = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS']);
    $intruder = $this->makeUser($intruderAcademy, 'ACADEMY_OWNER');
    Sanctum::actingAs($intruder);

    $this->getJson("/api/courses/{$courseId}")->assertNotFound();
    $this->getJson('/api/courses')->assertOk()->assertJsonPath('total', 0);
});

// ── validation: half-built lessons are rejected with a clear message ─────────
it('rejects a half-built media or youtube lesson', function () {
    Sanctum::actingAs($this->owner);
    $courseId = $this->postJson('/api/courses', ['title' => 'C'])->assertCreated()->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'S'])->assertCreated()->json('sectionId');

    // VIDEO_UPLOAD without a media_asset_id → 422 (nothing to play).
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'VIDEO_UPLOAD', 'title' => 'v',
    ])->assertStatus(422);

    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'YOUTUBE', 'title' => 'bad', 'youtube_url' => 'not a link',
    ])->assertStatus(422);

    // A QUIZ lesson needs no payload — it auto-creates an empty quiz to build against.
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'QUIZ', 'title' => 'Quiz 1',
    ])->assertCreated();
});

// ── pricing: free by default, sets a price, priced in the academy currency ───
it('defaults a new course to free and carries the academy currency', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', ['title' => 'Free one'])
        ->assertCreated()->json('courseId');

    // No price given → free, denominated in the academy's currency (EGP from createAcademy).
    $this->getJson("/api/courses/{$courseId}")->assertOk()
        ->assertJsonPath('course.price_minor', 0)
        ->assertJsonPath('course.is_free', true)
        ->assertJsonPath('course.currency', 'EGP');

    // The summary carries the currency so the "new course" form can label its price field.
    $this->getJson('/api/courses/summary')->assertOk()
        ->assertJsonPath('currency', 'EGP');
});

it('sets and updates a course price in minor units', function () {
    Sanctum::actingAs($this->owner);

    // Priced at creation (199.99 EGP → 19999 minor).
    $courseId = $this->postJson('/api/courses', ['title' => 'Paid one', 'price_minor' => 19999])
        ->assertCreated()->json('courseId');

    $this->getJson("/api/courses/{$courseId}")->assertOk()
        ->assertJsonPath('course.price_minor', 19999)
        ->assertJsonPath('course.is_free', false);

    // The list view carries the price too.
    $this->getJson('/api/courses')->assertOk()
        ->assertJsonPath('rows.0.price_minor', 19999)
        ->assertJsonPath('rows.0.is_free', false);

    // Editing back down to free.
    $this->patchJson("/api/courses/{$courseId}", ['price_minor' => 0])->assertOk();
    $this->getJson("/api/courses/{$courseId}")->assertOk()
        ->assertJsonPath('course.price_minor', 0)
        ->assertJsonPath('course.is_free', true);

    // A negative price is rejected.
    $this->patchJson("/api/courses/{$courseId}", ['price_minor' => -5])->assertStatus(422);
});
