<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\Entitlement;
use App\Support\FeatureCatalog;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
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
    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'coursesite']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
});

// ── the workspace marker is never something a module grants ───────────────────
it('keeps lms.only out of every module capability set', function () {
    expect(FeatureCatalog::CAPABILITIES)->toHaveKey('lms.only');
    expect(FeatureCatalog::capabilitiesOfModule('LMS'))->toBe(['lms']);

    foreach (FeatureCatalog::MODULE_CAPABILITIES as $module => $capabilities) {
        expect($capabilities)->not->toContain('lms.only', "module {$module} must not grant lms.only");
        expect($capabilities)->not->toContain('video.only', "module {$module} must not grant video.only");
    }
});

// ── an LMS client gets the collapsed workspace ────────────────────────────────
it('grants lms.only to a course-platform client', function () {
    $caps = Entitlement::resolve($this->academy)['capabilities'];
    expect($caps)->toContain('lms');
    expect($caps)->toContain('lms.only');
});

// ── the workspace marker follows the client TYPE, and nothing else ────────────
it('never gives a management client the course platform (or its collapsed workspace)', function () {
    $school = $this->createAcademy();

    // A school cannot even hold the module (05-MODULES-NOT-PACKAGES §2) …
    $this->enterAcademyAsSuperAdmin($school);
    expect(fn () => app(ModuleBilling::class)->enable($school, 'LMS', trial: false))
        ->toThrow(ValidationException::class);

    // … so it never resolves the LMS or the collapsed workspace.
    $caps = Entitlement::resolve($school)['capabilities'];
    expect($caps)->not->toContain('lms')->not->toContain('lms.only');
});

it('keeps the collapsed workspace for an LMS client even while its module is paused', function () {
    $this->enterAcademyAsSuperAdmin($this->academy);
    app(ModuleBilling::class)->pause($this->academy, 'LMS');

    // The panel shape is the client's identity, not a grant: they are still a course-platform
    // client (with nothing granted) rather than a school with an empty sidebar.
    $caps = Entitlement::resolve($this->academy)['capabilities'];
    expect($caps)->toContain('lms.only')->not->toContain('lms');
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
    $other = $this->createAcademy();
    Sanctum::actingAs($this->makeUser($other, 'ACADEMY_OWNER'));
    $this->getJson('/api/courses/dashboard')->assertStatus(402);
});
