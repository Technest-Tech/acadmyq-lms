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

/**
 * The storefront's ADAPTIVE half (docs/lms/09 §2–§4).
 *
 * One template serves a Qur'an teacher who hands out access codes by hand and a training company
 * running full checkout, and the difference between them is not styling — it is which buttons the
 * page is allowed to draw. That decision is made here, server-side, from real rows, and travels
 * with the site document so the hero renders the truth on its first frame.
 *
 * The rule every case below defends: the site never advertises a door that is shut. No "buy" where
 * the money has nowhere to land, no "start with a free course" where there is no free course, and
 * no "what you'll learn" bullets the course's owner did not write.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: [
        'name' => 'Noor Academy',
        'client_type' => 'LMS',
        'subdomain' => 'noor-lms',
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
});

/** Headers a public learner-site request carries: the subdomain handle, nothing else. */
function storefrontHeaders(string $sub = 'noor-lms'): array
{
    return ['X-Academy' => $sub];
}

/** A published course, optionally free / lesson-less / code-only, straight into the tenant. */
function publishCourse(string $academyId, array $overrides = [], bool $withLesson = true): string
{
    $courseId = (string) Str::uuid();
    DB::table('courses')->insert(array_merge([
        'id' => $courseId,
        'academy_id' => $academyId,
        'title' => 'Course '.substr($courseId, 0, 4),
        'slug' => 'course-'.substr($courseId, 0, 8),
        'status' => 'PUBLISHED',
        'published_at' => now(),
        'price_minor' => 40000,
        'checkout_enabled' => true,
        'code_enabled' => true,
    ], $overrides));

    if ($withLesson) {
        $sectionId = (string) Str::uuid();
        DB::table('course_sections')->insert([
            'id' => $sectionId,
            'academy_id' => $academyId,
            'course_id' => $courseId,
            'title' => 'Unit 1',
            'position' => 1,
        ]);
        DB::table('lessons')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'course_id' => $courseId,
            'section_id' => $sectionId,
            'title' => 'Lesson 1',
            'type' => 'TEXT',
            'body' => 'Hello',
            'position' => 1,
        ]);
    }

    return $courseId;
}

function activatePaymentMethod(string $academyId): void
{
    DB::table('lms_payment_methods')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'type' => 'INSTAPAY',
        'account_name' => 'Noor Academy',
        'account_number' => 'noor@instapay',
        'is_active' => true,
    ]);
}

// ── which doors are open ─────────────────────────────────────────────────────

it('reports every door shut for a client with no published courses', function () {
    $body = $this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')
        ->assertOk()->json('commerce');

    expect($body)->toMatchArray([
        'free' => false,
        'free_course' => null,
        'checkout' => false,
        'codes' => false,
        'paid' => false,
    ]);
});

it('does not promise checkout until the money has somewhere to land', function () {
    $this->asAcademy($this->academy);
    publishCourse($this->academy);   // priced, checkout_enabled = true
    $this->clearTenantContext();

    // The course says "sell me online" but the client has configured no receiving account, so a
    // Buy button would strand the buyer on a checkout with nowhere to pay.
    expect($this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')->json('commerce'))
        ->toMatchArray(['checkout' => false, 'paid' => true, 'codes' => true]);

    $this->asAcademy($this->academy);
    activatePaymentMethod($this->academy);
    $this->clearTenantContext();

    expect($this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')->json('commerce.checkout'))
        ->toBeTrue();
});

it('offers the newest free course by name, and never one with no lessons in it', function () {
    $this->asAcademy($this->academy);
    // An empty free course is a dead end: offering "start with a free course" and landing the
    // visitor on nothing is worse than not offering it at all.
    publishCourse($this->academy, [
        'title' => 'Empty taster',
        'slug' => 'empty-taster',
        'price_minor' => 0,
        'published_at' => now(),
    ], withLesson: false);
    publishCourse($this->academy, [
        'title' => 'Real taster',
        'slug' => 'real-taster',
        'price_minor' => 0,
        'published_at' => now()->subDay(),
    ]);
    $this->clearTenantContext();

    $commerce = $this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')->json('commerce');

    expect($commerce['free'])->toBeTrue()
        ->and($commerce['free_course']['slug'])->toBe('real-taster')
        ->and($commerce['paid'])->toBeFalse();
});

it('ignores draft courses when deciding what the storefront may advertise', function () {
    $this->asAcademy($this->academy);
    publishCourse($this->academy, ['status' => 'DRAFT', 'price_minor' => 0]);
    $this->clearTenantContext();

    expect($this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')->json('commerce'))
        ->toMatchArray(['free' => false, 'paid' => false, 'codes' => false]);
});

it('reports codes closed when every published course has them switched off', function () {
    $this->asAcademy($this->academy);
    publishCourse($this->academy, ['code_enabled' => false]);
    $this->clearTenantContext();

    expect($this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')->json('commerce.codes'))
        ->toBeFalse();
});

it('carries the site’s own canonical url so each tenant gets its own SEO', function () {
    config()->set('lms.site.root_domain', 'acadmyq.test');
    config()->set('lms.site.scheme', 'https');

    $academy = $this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')->json('academy');

    expect($academy['subdomain'])->toBe('noor-lms')
        ->and($academy['url'])->toContain('noor-lms.acadmyq.test');
});

// ── the storefront fields on the profile ─────────────────────────────────────

it('stores the brand marks, working hours and About-page blocks a storefront needs', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/courses/site', [
        'brand' => [
            'logo_mark_url' => 'https://cdn.test/mark.png',
            'favicon_url' => 'https://cdn.test/icon.png',
        ],
        'hero' => ['cta_label' => 'See the programmes'],
        'about' => ['mission' => 'Teach the Qur’an well.', 'approach' => 'Small groups.'],
        'contact' => ['hours' => 'Sat–Thu, 10:00–18:00'],
        'instructors' => ['items' => [[
            'name' => 'Ustadh Kareem',
            'role' => 'Tajweed',
            'bio' => '',
            'photo_url' => '',
            'expertise' => 'Tajweed، Qira’at',
            'link_url' => 'https://example.test/kareem',
        ]]],
    ])->assertOk();

    app()['auth']->forgetGuards();
    $site = $this->withHeaders(storefrontHeaders())->getJson('/api/learn/site')->assertOk()->json('site');

    expect($site['brand']['logo_mark_url'])->toBe('https://cdn.test/mark.png')
        ->and($site['brand']['favicon_url'])->toBe('https://cdn.test/icon.png')
        ->and($site['hero']['cta_label'])->toBe('See the programmes')
        ->and($site['about']['mission'])->toBe('Teach the Qur’an well.')
        ->and($site['about']['approach'])->toBe('Small groups.')
        ->and($site['contact']['hours'])->toBe('Sat–Thu, 10:00–18:00')
        ->and($site['instructors']['items'][0]['expertise'])->toBe('Tajweed، Qira’at')
        ->and($site['instructors']['items'][0]['link_url'])->toBe('https://example.test/kareem');
});

it('refuses a javascript: url on the new image and link fields too', function () {
    Sanctum::actingAs($this->owner);

    $content = $this->putJson('/api/courses/site', [
        'brand' => [
            'logo_mark_url' => 'javascript:alert(1)',
            'favicon_url' => 'data:image/svg+xml,<svg onload=alert(1)>',
        ],
        'instructors' => ['items' => [[
            'name' => 'Kareem',
            'link_url' => 'javascript:alert(1)',
        ]]],
    ])->assertOk()->json('content');

    expect($content['brand']['logo_mark_url'])->toBe('')
        ->and($content['brand']['favicon_url'])->toBe('')
        ->and($content['instructors']['items'][0]['link_url'])->toBe('');
});

// ── a course's sales page ────────────────────────────────────────────────────

it('round-trips the sales fields from the editor to the public course page', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', ['title' => 'Tajweed Level 1'])
        ->assertCreated()->json('courseId');

    $this->patchJson("/api/courses/{$courseId}", [
        'level' => 'BEGINNER',
        'category' => 'Tajweed',
        'outcomes' => ['Read with confidence', '  ', 'Apply the rules of noon saakin'],
        'requirements' => ['Basic Arabic reading'],
        'audience' => ['You have never studied tajweed'],
    ])->assertOk();

    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'Unit 1'])
        ->assertCreated()->json('sectionId');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Reading', 'body' => 'Hi',
    ])->assertCreated();
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    // The editor reads them back in the same shape it wrote them.
    $edited = $this->getJson("/api/courses/{$courseId}")->assertOk()->json('course');
    expect($edited['level'])->toBe('BEGINNER')
        ->and($edited['category'])->toBe('Tajweed')
        // The blank row a repeatable form leaves behind never becomes an empty bullet.
        ->and($edited['outcomes'])->toBe(['Read with confidence', 'Apply the rules of noon saakin']);

    app()['auth']->forgetGuards();
    $slug = $edited['slug'];

    $public = $this->withHeaders(storefrontHeaders())->getJson("/api/learn/courses/{$slug}")
        ->assertOk()->json('course');

    expect($public['level'])->toBe('BEGINNER')
        ->and($public['category'])->toBe('Tajweed')
        ->and($public['outcomes'])->toHaveCount(2)
        ->and($public['requirements'])->toBe(['Basic Arabic reading'])
        ->and($public['audience'])->toBe(['You have never studied tajweed']);

    // And on the card, where only the two chips belong.
    $card = collect($this->withHeaders(storefrontHeaders())->getJson('/api/learn/courses')->json('courses'))
        ->firstWhere('slug', $slug);
    expect($card['level'])->toBe('BEGINNER')->and($card['category'])->toBe('Tajweed');
});

it('leaves the sales blocks empty rather than inventing them', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', ['title' => 'Plain course'])
        ->assertCreated()->json('courseId');

    $course = $this->getJson("/api/courses/{$courseId}")->assertOk()->json('course');

    expect($course['level'])->toBeNull()
        ->and($course['category'])->toBeNull()
        ->and($course['outcomes'])->toBe([])
        ->and($course['requirements'])->toBe([])
        ->and($course['audience'])->toBe([]);
});

it('rejects a level outside the closed set, because a facet depends on it', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', ['title' => 'Plain course'])
        ->assertCreated()->json('courseId');

    $this->patchJson("/api/courses/{$courseId}", ['level' => 'EXPERT'])
        ->assertStatus(422);
});

it('caps the sales lists so a paste cannot become a wall of bullets', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', ['title' => 'Plain course'])
        ->assertCreated()->json('courseId');

    $this->patchJson("/api/courses/{$courseId}", [
        'outcomes' => array_fill(0, 20, 'Another outcome'),
    ])->assertStatus(422);
});

it('does not blank the sales fields when an unrelated edit is saved', function () {
    Sanctum::actingAs($this->owner);

    $courseId = $this->postJson('/api/courses', ['title' => 'Plain course'])
        ->assertCreated()->json('courseId');

    $this->patchJson("/api/courses/{$courseId}", ['outcomes' => ['Read with confidence']])
        ->assertOk();
    // A form that only edits the price must not wipe the outcomes it never showed.
    $this->patchJson("/api/courses/{$courseId}", ['price_minor' => 5000])->assertOk();

    expect($this->getJson("/api/courses/{$courseId}")->json('course.outcomes'))
        ->toBe(['Read with confidence']);
});
