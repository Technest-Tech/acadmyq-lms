<?php

declare(strict_types=1);

use App\Support\Entitlement;
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
 * Super Admin LMS oversight (docs/lms) — the course-platform twin of the video oversight suite.
 * Covers the three SECURITY DEFINER readers behind /admin/lms (cross-tenant roster, per-client
 * detail, activity feed), the platform.manage Gate, and the four LMS-only controls (caps override,
 * public site handle, course moderation, learner moderation) including the entitlement effect the
 * caps override is supposed to have.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    $this->lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');

    // Client A sells courses; client B is a plain school with no LMS module.
    $this->A = $this->createAcademy(overrides: [
        'plan_id' => $this->lmsPlan, 'name' => 'Course Co', 'subdomain' => 'coursesite',
    ]);
    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER');

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->B = $this->createAcademy(overrides: ['plan_id' => $proPlan, 'name' => 'Plain School']);
});

/** Give an academy a live LMS module subscription; returns its id. */
function seedLmsSub(string $academyId, ?string $planId, array $overrides = []): string
{
    $id = (string) Str::uuid();
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->insert(array_merge([
        'id' => $id,
        'academy_id' => $academyId,
        'module' => 'LMS',
        'plan_id' => $planId,
        'status' => 'ACTIVE',
        'is_trial' => false,
        'currency' => 'EGP',
    ], $overrides));
    test()->clearTenantContext();

    return $id;
}

/** Build a published course (with one lesson) under the academy's own owner. Returns the course id. */
function seedLmsCourse(string $title = 'Algebra'): string
{
    $courseId = test()->postJson('/api/courses', ['title' => $title])->json('courseId');
    $sectionId = test()->postJson("/api/courses/{$courseId}/sections", ['title' => 'S1'])->json('sectionId');
    test()->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Intro', 'body' => 'hi',
    ])->assertCreated();
    test()->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    return $courseId;
}

/**
 * Provision a client the way the academy-creation flow actually does: ONE `MANAGEMENT` module row
 * carrying the LMS plan, with NO `module = 'LMS'` row anywhere. Every LMS surface must recognise
 * this as a course-platform client — keying on the module ROW NAME misses it entirely.
 */
function seedLmsClientViaManagementRow(string $academyId, string $lmsPlanId): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('module_subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'module' => 'MANAGEMENT',
        'plan_id' => $lmsPlanId,
        'status' => 'ACTIVE',
        'is_trial' => false,
        'currency' => 'EGP',
    ]);
    test()->clearTenantContext();
}

// ── regression: an LMS client provisioned as a MANAGEMENT row holding the LMS plan ──
it('lists a brand-new LMS client that has no dedicated LMS module row and no courses', function () {
    // The exact shape that made a real client invisible: LMS plan on the MANAGEMENT row, zero
    // courses, zero learners — nothing but the subscription to find it by.
    seedLmsClientViaManagementRow($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->admin);
    $row = collect($this->getJson('/api/admin/lms/usage')->assertOk()->json('academies'))
        ->firstWhere('academy_id', $this->A);

    expect($row)->not->toBeNull('an LMS client must appear before it has any content')
        ->and($row['lms_status'])->toBe('ACTIVE')
        ->and($row['lms_enabled'])->toBeTrue()
        ->and($row['lms_plan_name'])->not->toBeNull();
});

it('serves the detail page for an LMS client held on the MANAGEMENT row', function () {
    seedLmsClientViaManagementRow($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->admin);
    $this->getJson("/api/admin/lms/academies/{$this->A}")->assertOk()
        ->assertJsonPath('academy.lms_status', 'ACTIVE')
        ->assertJsonPath('academy.lms_enabled', true)
        ->assertJsonPath('subscription.status', 'ACTIVE');
});

it('applies a caps override for an LMS client held on the MANAGEMENT row', function () {
    seedLmsClientViaManagementRow($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/lms/academies/{$this->A}/limits", [
        'limits' => ['maxCourses' => 7, 'maxLearners' => 70, 'maxStorageGb' => 3],
    ])->assertOk()->assertJsonPath('academy.lms_limits.maxCourses', 7);

    // And the resolver — the thing that actually gates publishing/uploads — must agree.
    $limits = Entitlement::resolveFromModules($this->A)['limits'];
    expect($limits['maxCourses'])->toBe(7)
        ->and($limits['maxLearners'])->toBe(70)
        ->and($limits['maxStorageGb'])->toBe(3);
});

it('does not mistake a general PRO client for a course-platform client', function () {
    // FREE/PRO bundle every capability including `lms`, so identifying LMS clients by capability
    // would list the whole roster. Only an LMS PLAN (or a real LMS module row) counts.
    Sanctum::actingAs($this->admin);
    $rows = collect($this->getJson('/api/admin/lms/usage')->assertOk()->json('academies'));

    expect($rows->firstWhere('academy_id', $this->B))->toBeNull();
});

// ── the Gate ─────────────────────────────────────────────────────────────────
it('forbids non-super-admins from every LMS oversight route', function () {
    Sanctum::actingAs($this->ownerA);

    $this->getJson('/api/admin/lms/usage')->assertForbidden();
    $this->getJson('/api/admin/lms/activity')->assertForbidden();
    $this->getJson("/api/admin/lms/academies/{$this->A}")->assertForbidden();
    $this->postJson("/api/admin/lms/academies/{$this->A}/limits", ['limits' => []])->assertForbidden();
    $this->putJson("/api/admin/lms/academies/{$this->A}/subdomain", ['subdomain' => 'x'])->assertForbidden();
});

// ── the cross-tenant roster ──────────────────────────────────────────────────
it('aggregates every LMS client and the platform totals', function () {
    seedLmsSub($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->ownerA);
    seedLmsCourse('Algebra');
    $this->postJson('/api/courses', ['title' => 'Draft one'])->assertCreated();
    app()['auth']->forgetGuards();

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/lms/usage')->assertOk();

    $rows = collect($res->json('academies'));
    $a = $rows->firstWhere('academy_id', $this->A);

    expect($a)->not->toBeNull()
        ->and($a['academy_name'])->toBe('Course Co')
        ->and($a['subdomain'])->toBe('coursesite')
        ->and($a['lms_status'])->toBe('ACTIVE')
        ->and($a['lms_enabled'])->toBeTrue()
        ->and($a['courses_total'])->toBe(2)
        ->and($a['courses_published'])->toBe(1)
        ->and($a['courses_draft'])->toBe(1)
        ->and($a['lessons'])->toBe(1);

    // A school with no LMS module and no course data never appears in the LMS roster.
    expect($rows->firstWhere('academy_id', $this->B))->toBeNull();

    expect($res->json('totals.academies'))->toBe(1)
        ->and($res->json('totals.active'))->toBe(1)
        ->and($res->json('totals.courses'))->toBe(2)
        ->and($res->json('totals.published_courses'))->toBe(1);
});

it('reports a lapsed LMS trial as EXPIRED rather than active', function () {
    seedLmsSub($this->A, $this->lmsPlan, [
        'is_trial' => true,
        'trial_start' => now()->subDays(10),
        'trial_end' => now()->subDay(),
    ]);

    Sanctum::actingAs($this->admin);
    $row = collect($this->getJson('/api/admin/lms/usage')->json('academies'))->firstWhere('academy_id', $this->A);

    expect($row['lms_status'])->toBe('EXPIRED')
        ->and($row['lms_enabled'])->toBeFalse();
});

// ── the per-client detail ────────────────────────────────────────────────────
it('serves one client detail with courses, learners and the public site link', function () {
    seedLmsSub($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->ownerA);
    $courseId = seedLmsCourse('Algebra');
    $code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$courseId], 'count' => 1, 'max_redemptions' => 1,
    ])->assertCreated()->json('codes.0.code');
    app()['auth']->forgetGuards();

    $headers = ['X-Academy' => 'coursesite'];
    $token = $this->withHeaders($headers)->postJson('/api/learn/auth/register', [
        'full_name' => 'Lina', 'email' => 'lina@example.com', 'password' => 'password123',
    ])->json('token');
    $this->withHeaders($headers + ['Authorization' => "Bearer {$token}"])
        ->postJson('/api/learn/redeem', ['code' => $code])->assertOk();

    Sanctum::actingAs($this->admin);
    $res = $this->getJson("/api/admin/lms/academies/{$this->A}")->assertOk();

    $res->assertJsonPath('academy.name', 'Course Co')
        ->assertJsonPath('academy.lms_status', 'ACTIVE')
        ->assertJsonPath('stats.courses_total', 1)
        ->assertJsonPath('stats.learners', 1)
        ->assertJsonPath('stats.active_enrollments', 1)
        ->assertJsonPath('stats.redeemed_codes', 1)
        ->assertJsonPath('courses.0.title', 'Algebra')
        ->assertJsonPath('courses.0.learners', 1)
        ->assertJsonPath('learners.0.full_name', 'Lina')
        ->assertJsonPath('recent_enrollments.0.course_title', 'Algebra')
        ->assertJsonPath('site.url', '/learn/coursesite');
});

it('404s on an unknown academy', function () {
    Sanctum::actingAs($this->admin);
    $this->getJson('/api/admin/lms/academies/'.Str::uuid())->assertNotFound();
});

// ── control: the per-client capacity caps ────────────────────────────────────
it('overrides a client capacity caps and feeds the entitlement resolver', function () {
    seedLmsSub($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/lms/academies/{$this->A}/limits", [
        'limits' => ['maxCourses' => 40, 'maxLearners' => 900, 'maxStorageGb' => 25],
    ])->assertOk()->assertJsonPath('academy.lms_limits.maxCourses', 40);

    // The resolver — the thing that actually gates uploads/publishing — must see the new caps.
    $limits = Entitlement::resolveFromModules($this->A)['limits'];
    expect($limits['maxCourses'])->toBe(40)
        ->and($limits['maxLearners'])->toBe(900)
        ->and($limits['maxStorageGb'])->toBe(25);

    // Clearing falls back to the LMS plan's own caps (no override left behind).
    $this->postJson("/api/admin/lms/academies/{$this->A}/limits", ['limits' => []])->assertOk();
    expect($this->getJson("/api/admin/lms/academies/{$this->A}")->json('academy.lms_overrides'))->toBeNull();
});

it('refuses a caps override for a client with no LMS module', function () {
    Sanctum::actingAs($this->admin);

    $this->postJson("/api/admin/lms/academies/{$this->B}/limits", ['limits' => ['maxCourses' => 5]])
        ->assertStatus(422);
});

// ── control: the public site handle ──────────────────────────────────────────
it('sets and validates the public course-site subdomain', function () {
    seedLmsSub($this->A, $this->lmsPlan);
    Sanctum::actingAs($this->admin);

    $this->putJson("/api/admin/lms/academies/{$this->A}/subdomain", ['subdomain' => 'newsite'])
        ->assertOk()
        ->assertJsonPath('academy.subdomain', 'newsite')
        ->assertJsonPath('site.url', '/learn/newsite');

    // DNS-safe + unique platform-wide.
    $this->putJson("/api/admin/lms/academies/{$this->A}/subdomain", ['subdomain' => 'Not Valid!'])
        ->assertStatus(422);

    $this->putJson("/api/admin/lms/academies/{$this->B}/subdomain", ['subdomain' => 'newsite'])
        ->assertStatus(422);
});

// ── control: content + learner moderation ────────────────────────────────────
it('moderates a client course and blocks a learner, auditing both', function () {
    seedLmsSub($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->ownerA);
    $courseId = seedLmsCourse('Algebra');
    app()['auth']->forgetGuards();

    $token = $this->withHeaders(['X-Academy' => 'coursesite'])->postJson('/api/learn/auth/register', [
        'full_name' => 'Lina', 'email' => 'lina@example.com', 'password' => 'password123',
    ])->json('token');
    expect($token)->not->toBeNull();

    Sanctum::actingAs($this->admin);

    // Unpublish (takedown) — the course leaves the public site.
    $this->postJson("/api/admin/lms/academies/{$this->A}/courses/{$courseId}/status", [
        'status' => 'DRAFT', 'reason' => 'Copyright complaint',
    ])->assertOk()->assertJsonPath('status', 'DRAFT');

    $detail = $this->getJson("/api/admin/lms/academies/{$this->A}")->json();
    expect($detail['courses'][0]['status'])->toBe('DRAFT')
        ->and($detail['stats']['courses_published'])->toBe(0);

    // Block the learner.
    $learnerId = $detail['learners'][0]['id'];
    $this->postJson("/api/admin/lms/academies/{$this->A}/learners/{$learnerId}/status", [
        'status' => 'BLOCKED', 'reason' => 'Credential sharing',
    ])->assertOk()->assertJsonPath('status', 'BLOCKED');

    // Both land in the LMS activity feed as super-admin actions.
    $actions = collect($this->getJson('/api/admin/lms/activity')->assertOk()->json('rows'))->pluck('action');
    expect($actions)->toContain('lms.course_moderated')
        ->and($actions)->toContain('lms.learner_moderated');
});

it('does not let a super admin moderate a course through the wrong academy', function () {
    seedLmsSub($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->ownerA);
    $courseId = seedLmsCourse('Algebra');
    app()['auth']->forgetGuards();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/lms/academies/{$this->B}/courses/{$courseId}/status", ['status' => 'DRAFT'])
        ->assertNotFound();
});

it('refuses to publish a course that has no lessons', function () {
    seedLmsSub($this->A, $this->lmsPlan);

    Sanctum::actingAs($this->ownerA);
    $courseId = $this->postJson('/api/courses', ['title' => 'Empty'])->json('courseId');
    app()['auth']->forgetGuards();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/lms/academies/{$this->A}/courses/{$courseId}/status", ['status' => 'PUBLISHED'])
        ->assertStatus(422);
});
