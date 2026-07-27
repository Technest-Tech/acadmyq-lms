<?php

declare(strict_types=1);

use App\Support\Entitlement;
use App\Support\FeatureCatalog;
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
 * The LMS-only workspace (docs/lms): the `lms.only` capability that collapses the web panel to the
 * course platform, and the LMS dashboard that replaces the school management dashboard.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $this->academy = $this->createAcademy(overrides: ['plan_id' => $this->lmsPlan, 'subdomain' => 'coursesite']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
});

// ── the workspace marker never leaks into a general plan ──────────────────────
it('keeps lms.only out of the full-plan capability bundle', function () {
    expect(FeatureCatalog::CAPABILITIES)->toHaveKey('lms.only');
    expect(FeatureCatalog::bundledCapabilities())->not->toContain('lms.only');
    expect(FeatureCatalog::bundledCapabilities())->toContain('lms');

    // The seeded full plans must not carry it either.
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    foreach (['FREE', 'PRO', 'BASIC'] as $code) {
        $features = DB::table('plans')->where('code', $code)->value('features');
        if ($features === null) {
            continue;
        }
        $caps = json_decode((string) $features, true)['capabilities'] ?? [];
        expect($caps)->not->toContain('lms.only', "plan {$code} must not grant lms.only");
    }
});

// ── an LMS-only client gets the collapsed workspace ───────────────────────────
it('grants lms.only to a client whose plan is the LMS tier', function () {
    $caps = Entitlement::resolve($this->academy)['capabilities'];
    expect($caps)->toContain('lms');
    expect($caps)->toContain('lms.only');
});

// ── a client who ALSO runs the school keeps the full panel ────────────────────
it('strips lms.only when the client has another module besides LMS', function () {
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $academy = $this->createAcademy(overrides: ['plan_id' => $proPlan]);

    // Module-billed client: MANAGEMENT (PRO) + LMS (the tier that carries lms.only). module_subscriptions
    // is SUPER_ADMIN-write AND tenant-scoped, so both GUCs must be set (mirrors the Modules suite).
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $academy]);
    foreach ([['MANAGEMENT', $proPlan], ['LMS', $this->lmsPlan]] as [$module, $planId]) {
        DB::table('module_subscriptions')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academy,
            'module' => $module,
            'plan_id' => $planId,
            'status' => 'ACTIVE',
            'is_trial' => false,
            'currency' => 'EGP',
        ]);
    }

    $caps = Entitlement::resolveFromModules($academy);
    expect($caps['capabilities'])->toContain('lms');          // the module still grants the LMS itself
    expect($caps['capabilities'])->not->toContain('lms.only'); // …but never the collapsed workspace
});

// ── regression: the LMS plan may hang off the MANAGEMENT module row ───────────
it('keeps lms.only when the LMS plan is attached to the MANAGEMENT subscription', function () {
    // How the academy-creation flow actually provisions an LMS client: ONE module sub, named
    // MANAGEMENT (the primary), carrying the LMS plan. The client still sells courses and nothing
    // else, so the workspace marker must survive — the guard keys on capabilities, not module names.
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement('select set_config(?, ?, true)', ['app.current_academy_id', $this->academy]);
    DB::table('module_subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'module' => 'MANAGEMENT',
        'plan_id' => $this->lmsPlan,
        'status' => 'ACTIVE',
        'is_trial' => false,
        'currency' => 'EGP',
    ]);

    $caps = Entitlement::resolve($this->academy)['capabilities'];
    expect($caps)->toContain('lms.only');
    expect($caps)->toEqualCanonicalizing(['lms', 'lms.only']);
});

// ── the LMS dashboard reports the client's own numbers + site ─────────────────
it('serves LMS dashboard stats, the public site and recent activity', function () {
    Sanctum::actingAs($this->owner);

    // A published course with a lesson, and a draft one.
    $courseId = $this->postJson('/api/courses', ['title' => 'Algebra'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'S1'])->json('sectionId');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Intro', 'body' => 'hello',
    ])->assertCreated();
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();
    $this->postJson('/api/courses', ['title' => 'Draft course'])->assertCreated();

    $code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$courseId], 'count' => 1, 'max_redemptions' => 1,
    ])->assertCreated()->json('codes.0.code');
    app()['auth']->forgetGuards();

    // A learner registers on the public site and redeems → one enrolment.
    $headers = ['X-Academy' => 'coursesite'];
    $token = $this->withHeaders($headers)->postJson('/api/learn/auth/register', [
        'full_name' => 'Lina', 'email' => 'lina@example.com', 'password' => 'password123',
    ])->json('token');
    $this->withHeaders($headers + ['Authorization' => "Bearer {$token}"])
        ->postJson('/api/learn/redeem', ['code' => $code])->assertOk();

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/courses/dashboard')->assertOk();

    $res->assertJsonPath('stats.courses', 2)
        ->assertJsonPath('stats.published_courses', 1)
        ->assertJsonPath('stats.draft_courses', 1)
        ->assertJsonPath('stats.lessons', 1)
        ->assertJsonPath('stats.learners', 1)
        ->assertJsonPath('stats.active_enrollments', 1)
        ->assertJsonPath('stats.redeemed_codes', 1)
        ->assertJsonPath('site.subdomain', 'coursesite')
        ->assertJsonPath('site.published_courses', 1);

    // With no root domain configured the site link falls back to the in-app learner path.
    expect($res->json('site.url'))->toBe('/learn/coursesite');
    expect($res->json('recent_enrollments.0.learner_name'))->toBe('Lina');
    expect($res->json('recent_enrollments.0.course_title'))->toBe('Algebra');
    expect($res->json('top_courses.0.title'))->toBe('Algebra');
    expect($res->json('top_courses.0.learners'))->toBe(1);
    expect($res->json('storage.used_bytes'))->toBe(0);
});

// ── the site url uses the configured root domain when DNS is live ─────────────
it('builds the site url from the configured root domain', function () {
    config(['lms.site.root_domain' => 'academiq.app']);
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/courses/dashboard')->assertOk()
        ->assertJsonPath('site.url', 'https://coursesite.academiq.app');
});

// ── gating: entitlement + capability ──────────────────────────────────────────
it('gates the LMS dashboard by entitlement and capability', function () {
    // A teacher lacks course.read → 403.
    Sanctum::actingAs($this->makeUser($this->academy, 'TEACHER'));
    $this->getJson('/api/courses/dashboard')->assertStatus(403);

    // An academy without the LMS module → 402.
    $basic = DB::table('plans')->where('code', 'BASIC')->value('id');
    $other = $this->createAcademy(overrides: ['plan_id' => $basic]);
    Sanctum::actingAs($this->makeUser($other, 'ACADEMY_OWNER'));
    $this->getJson('/api/courses/dashboard')->assertStatus(402);
});
