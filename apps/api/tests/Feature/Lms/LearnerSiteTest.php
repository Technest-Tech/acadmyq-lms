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
 * LMS phase 2 — the public learner site (docs/lms). Subdomain → tenant (X-Academy header), learner
 * bearer-token auth, code redemption → enrollment, and the enrollment-gated player. The academy's
 * `subdomain` is the public handle; the whole site is unreachable without it.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $this->academy = $this->createAcademy(overrides: ['plan_id' => $lmsPlan, 'subdomain' => 'academyx']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');

    // Build a published course: a preview YouTube lesson + a gated text lesson, then a single-use code.
    Sanctum::actingAs($this->owner);
    $courseId = $this->postJson('/api/courses', ['title' => 'Chemistry 101'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'Unit 1'])->json('sectionId');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'YOUTUBE', 'title' => 'Intro (free)',
        'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ', 'is_preview' => true,
    ])->assertCreated();
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Deep dive', 'body' => '# Secret notes',
    ])->assertCreated();
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    $this->courseId = $courseId;
    $this->slug = $this->getJson("/api/courses/{$courseId}")->json('course.slug');
    $this->code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$courseId], 'count' => 1, 'max_redemptions' => 1,
    ])->assertCreated()->json('codes.0.code');

    // Drop the staff acting-user so learner requests use the bearer flow.
    app()['auth']->forgetGuards();
});

/** Learner request headers: the subdomain (+ optional bearer token). */
function learnHeaders(?string $token = null, string $sub = 'academyx'): array
{
    $h = ['X-Academy' => $sub];
    if ($token !== null) {
        $h['Authorization'] = "Bearer {$token}";
    }

    return $h;
}

// ── the public catalog withholds gated content ───────────────────────────────
it('serves the published catalog and hides non-preview lesson content', function () {
    $this->withHeaders(learnHeaders())
        ->getJson('/api/learn/courses')
        ->assertOk()
        ->assertJsonPath('courses.0.slug', $this->slug)
        ->assertJsonPath('courses.0.lesson_count', 2);

    $res = $this->withHeaders(learnHeaders())->getJson("/api/learn/courses/{$this->slug}")->assertOk();

    // The free-preview lesson carries its content; the gated one does not even ship the key.
    expect($res->json('sections.0.lessons.0.youtube_video_id'))->toBe('dQw4w9WgXcQ');
    expect($res->json('sections.0.lessons.1.type'))->toBe('TEXT');
    expect(array_key_exists('body', $res->json('sections.0.lessons.1')))->toBeFalse();
});

// ── the subdomain IS the site ────────────────────────────────────────────────
it('404s an unknown or missing subdomain', function () {
    $this->withHeaders(learnHeaders(null, 'nope'))->getJson('/api/learn/courses')->assertNotFound();
    $this->getJson('/api/learn/courses')->assertNotFound(); // no X-Academy at all
});

// ── register / login / me ────────────────────────────────────────────────────
it('registers a learner, returns a token, and reads /me', function () {
    $token = $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'Sara', 'email' => 'sara@example.com', 'password' => 'password123',
    ])->assertCreated()->json('token');

    expect($token)->toBeString();

    $this->withHeaders(learnHeaders($token))->getJson('/api/learn/me')
        ->assertOk()
        ->assertJsonPath('learner.email', 'sara@example.com')
        ->assertJsonPath('enrolled_course_ids', []);

    // Login with the same credentials issues a token too.
    $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/login', [
        'email' => 'sara@example.com', 'password' => 'password123',
    ])->assertOk()->assertJsonStructure(['token', 'learner']);
});

// ── redeem → enroll → watch (the whole point) ────────────────────────────────
it('gates the player behind enrollment, which a redeemed code grants', function () {
    $token = $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'Omar', 'email' => 'omar@example.com', 'password' => 'password123',
    ])->json('token');

    // Not enrolled → the player refuses.
    $this->withHeaders(learnHeaders($token))
        ->getJson("/api/learn/courses/{$this->slug}/content")
        ->assertStatus(403);

    // Redeem the code → enrolled in the course.
    $this->withHeaders(learnHeaders($token))->postJson('/api/learn/redeem', ['code' => $this->code])
        ->assertOk()
        ->assertJsonPath('courses.0.slug', $this->slug);

    // Now the player serves ALL content, including the gated lesson's body.
    $content = $this->withHeaders(learnHeaders($token))
        ->getJson("/api/learn/courses/{$this->slug}/content")
        ->assertOk();
    expect($content->json('sections.0.lessons.1.body'))->toBe('# Secret notes');

    // Save progress on that lesson → it reads back COMPLETED.
    $lessonId = $content->json('sections.0.lessons.1.id');
    $this->withHeaders(learnHeaders($token))
        ->postJson("/api/learn/lessons/{$lessonId}/progress", ['completed' => true])
        ->assertOk();
    $after = $this->withHeaders(learnHeaders($token))->getJson("/api/learn/courses/{$this->slug}/content");
    expect($after->json("progress.{$lessonId}.status"))->toBe('COMPLETED');

    // /me now lists the enrolled course.
    $this->withHeaders(learnHeaders($token))->getJson('/api/learn/me')
        ->assertOk()->assertJsonPath('enrolled_course_ids.0', $this->courseId);
});

// ── a free course needs no code at all ───────────────────────────────────────
it('self-enrolls a signed-in learner in a FREE course, but not in a paid one', function () {
    $token = $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'Nour', 'email' => 'nour@example.com', 'password' => 'password123',
    ])->json('token');

    // The seeded course carries the default price of 0 → one click enrolls.
    $this->withHeaders(learnHeaders($token))
        ->postJson("/api/learn/courses/{$this->slug}/enroll")
        ->assertOk()
        ->assertJsonPath('already_enrolled', false)
        ->assertJsonPath('course.slug', $this->slug);

    // The player opens, and repeating the call is idempotent.
    $this->withHeaders(learnHeaders($token))
        ->getJson("/api/learn/courses/{$this->slug}/content")->assertOk();
    $this->withHeaders(learnHeaders($token))
        ->postJson("/api/learn/courses/{$this->slug}/enroll")
        ->assertOk()->assertJsonPath('already_enrolled', true);

    // A priced course still demands a code.
    Sanctum::actingAs($this->owner);
    $paidId = $this->postJson('/api/courses', ['title' => 'Physics Pro', 'price_minor' => 50000])->json('courseId');
    $paidSection = $this->postJson("/api/courses/{$paidId}/sections", ['title' => 'Unit 1'])->json('sectionId');
    $this->postJson("/api/courses/{$paidId}/lessons", [
        'section_id' => $paidSection, 'type' => 'TEXT', 'title' => 'Paid notes', 'body' => 'x',
    ])->assertCreated();
    $this->postJson("/api/courses/{$paidId}/publish", ['status' => 'PUBLISHED'])->assertOk();
    $paidSlug = $this->getJson("/api/courses/{$paidId}")->json('course.slug');
    app()['auth']->forgetGuards();

    $this->withHeaders(learnHeaders($token))
        ->postJson("/api/learn/courses/{$paidSlug}/enroll")
        ->assertStatus(403);
});

// ── revoked access is not re-openable by the free door ───────────────────────
it('refuses free self-enrollment for a learner whose access was revoked', function () {
    $token = $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'Rami', 'email' => 'rami@example.com', 'password' => 'password123',
    ])->json('token');

    $this->withHeaders(learnHeaders($token))
        ->postJson("/api/learn/courses/{$this->slug}/enroll")->assertOk();

    Sanctum::actingAs($this->owner);
    $learnerId = $this->getJson('/api/courses/learners')->json('learners.0.id');
    $this->postJson("/api/courses/learners/{$learnerId}/enrollment", [
        'course_id' => $this->courseId, 'status' => 'REVOKED',
    ])->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(learnHeaders($token))
        ->postJson("/api/learn/courses/{$this->slug}/enroll")
        ->assertStatus(403);
});

// ── a single-use code cannot be shared ───────────────────────────────────────
it('refuses a single-use code once it is spent', function () {
    $a = $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'A', 'email' => 'a@example.com', 'password' => 'password123',
    ])->json('token');
    $b = $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'B', 'email' => 'b@example.com', 'password' => 'password123',
    ])->json('token');

    $this->withHeaders(learnHeaders($a))->postJson('/api/learn/redeem', ['code' => $this->code])->assertOk();

    // Staff see the redemption count rise (single-use → now spent).
    Sanctum::actingAs($this->owner);
    $count = collect($this->getJson('/api/courses/codes')->json('codes'))
        ->firstWhere('code', $this->code)['redemptions_count'];
    expect($count)->toBe(1);
    app()['auth']->forgetGuards();

    // A second learner cannot reuse the spent single-use code.
    $this->withHeaders(learnHeaders($b))->postJson('/api/learn/redeem', ['code' => $this->code])->assertStatus(422);
});

// ── a learner token is bound to its academy ──────────────────────────────────
it('rejects a learner token presented on another academy subdomain', function () {
    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $academyB = $this->createAcademy(overrides: ['plan_id' => $lmsPlan, 'subdomain' => 'academyy']);
    app()['auth']->forgetGuards();

    $tokenB = $this->withHeaders(learnHeaders(null, 'academyy'))->postJson('/api/learn/auth/register', [
        'full_name' => 'Intruder', 'email' => 'x@example.com', 'password' => 'password123',
    ])->json('token');

    // academy B's token used against academy X's subdomain → 401 (EnsureLearner academy mismatch).
    $this->withHeaders(learnHeaders($tokenB, 'academyx'))->getJson('/api/learn/me')->assertUnauthorized();
});

// ── staff see who redeemed ───────────────────────────────────────────────────
it('shows the enrolled learner to staff', function () {
    $token = $this->withHeaders(learnHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'Lina', 'email' => 'lina@example.com', 'password' => 'password123',
    ])->json('token');
    $this->withHeaders(learnHeaders($token))->postJson('/api/learn/redeem', ['code' => $this->code])->assertOk();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/courses/learners')->assertOk()
        ->assertJsonPath('learners.0.full_name', 'Lina')
        ->assertJsonPath('learners.0.enrollment_count', 1);
});
