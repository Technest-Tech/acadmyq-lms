<?php

declare(strict_types=1);

use App\Support\LmsSiteProfile;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The public course site's per-client content (docs/lms/09). Every LMS client renders the same
 * template; this row is the only thing that differs between them, so what matters here is:
 *
 *  - a client who never opened the editor still gets a COMPLETE document (the site is never blank);
 *  - the write gate sanitises rather than trusts — caps, colours, and above all no `javascript:`
 *    href reaching a page that students visit;
 *  - one academy's content can never leak into another's site.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // `entitled:lms` 402s without a plan that grants the module — the trap every LMS suite hits.
    $this->lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');

    $this->academy = $this->createAcademy(overrides: [
        'name' => 'Noor Academy',
        'plan_id' => $this->lmsPlan,
        'subdomain' => 'noor-lms',
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
});

/** Headers a public learner-site request carries: the subdomain handle, nothing else. */
function siteHeaders(string $sub = 'noor-lms'): array
{
    return ['X-Academy' => $sub];
}

it('serves a complete document for a client who never opened the editor', function () {
    $body = $this->withHeaders(siteHeaders())->getJson('/api/learn/site')->assertOk()->json();

    // Structurally complete: every block the template reads exists.
    expect(array_keys($body['site']))->toEqualCanonicalizing(array_keys(LmsSiteProfile::defaults()));

    // The one client-specific fact that exists before any configuration.
    expect($body['site']['brand']['name'])->toBe('Noor Academy')
        ->and($body['site']['brand']['color'])->toBe(LmsSiteProfile::DEFAULT_COLOR)
        ->and($body['site']['pages']['about'])->toBeTrue();

    // Copy is intentionally EMPTY — the web template fills it from its own translations, so the
    // fallback text is bilingual. Empty here must never mean "a blank section".
    expect($body['site']['hero']['title'])->toBe('')
        ->and($body['site']['faq']['items'])->toBe([]);

    // Live counters back the stats band when the client wrote no numbers of their own.
    expect($body['stats'])->toHaveKeys(['courses', 'lessons', 'learners', 'certificates']);
});

it('lets the client save content and serves it back on the public site', function () {
    Sanctum::actingAs($this->owner);

    $saved = $this->putJson('/api/courses/site', [
        'brand' => ['name' => 'Noor Courses', 'color' => '#1D4ED8', 'tagline' => 'Learn chemistry'],
        'hero' => ['title' => 'Master chemistry', 'badges' => ['Certificate', 'Lifetime access']],
        'faq' => ['show' => true, 'items' => [['q' => 'How do I join?', 'a' => 'Ask for a code.']]],
        'contact' => ['email' => 'hi@noor.test', 'socials' => ['youtube' => 'https://youtube.com/@noor']],
    ])->assertOk()->json();

    expect($saved['content']['brand']['name'])->toBe('Noor Courses')
        ->and($saved['content']['brand']['color'])->toBe('#1d4ed8')   // normalised to lower case
        ->and($saved['configured'])->toBeTrue();

    app()['auth']->forgetGuards();

    $public = $this->withHeaders(siteHeaders())->getJson('/api/learn/site')->assertOk()->json('site');

    expect($public['hero']['title'])->toBe('Master chemistry')
        ->and($public['hero']['badges'])->toBe(['Certificate', 'Lifetime access'])
        ->and($public['faq']['items'][0]['q'])->toBe('How do I join?')
        ->and($public['contact']['socials']['youtube'])->toBe('https://youtube.com/@noor');
});

it('saves twice without duplicating the academy row', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/courses/site', ['hero' => ['title' => 'First']])->assertOk();
    $this->putJson('/api/courses/site', ['hero' => ['title' => 'Second']])->assertOk();

    // Read back inside the academy's own context: `lms_site_profiles` carries the standard
    // tenant_isolation policy with no super-admin escape, so a context-less Super Admin sees zero
    // rows by design (same as certificate_templates).
    $this->asAcademy($this->academy);
    expect(DB::table('lms_site_profiles')->where('academy_id', $this->academy)->count())->toBe(1);
});

it('refuses to put a javascript: or data: URL on a student-facing page', function () {
    Sanctum::actingAs($this->owner);

    $content = $this->putJson('/api/courses/site', [
        'brand' => ['logo_url' => 'javascript:alert(1)'],
        'cta' => ['button_href' => 'javascript:alert(1)'],
        'about' => ['image_url' => 'data:text/html;base64,PHNjcmlwdD4='],
        'contact' => ['socials' => ['facebook' => 'javascript:alert(1)']],
        'footer' => ['links' => [['label' => 'Bad', 'href' => 'javascript:alert(1)']]],
    ])->assertOk()->json('content');

    expect($content['brand']['logo_url'])->toBe('')
        ->and($content['cta']['button_href'])->toBe('')
        ->and($content['about']['image_url'])->toBe('')
        ->and($content['contact']['socials']['facebook'])->toBe('')
        ->and($content['footer']['links'][0]['href'])->toBe('');
});

it('keeps the links a client legitimately needs', function () {
    Sanctum::actingAs($this->owner);

    $content = $this->putJson('/api/courses/site', [
        'cta' => ['button_href' => '/courses'],
        'footer' => ['links' => [
            ['label' => 'Site', 'href' => 'https://noor.test'],
            ['label' => 'Mail', 'href' => 'mailto:hi@noor.test'],
        ]],
    ])->assertOk()->json('content');

    expect($content['cta']['button_href'])->toBe('/courses')
        ->and($content['footer']['links'])->toHaveCount(2);
});

it('caps list length and text length so a paste cannot break the layout', function () {
    Sanctum::actingAs($this->owner);

    $content = $this->putJson('/api/courses/site', [
        'faq' => ['items' => array_map(
            fn (int $i): array => ['q' => "Q{$i}", 'a' => 'A'],
            range(1, 40),
        )],
        'brand' => ['name' => str_repeat('x', 500), 'color' => 'not-a-colour'],
    ])->assertOk()->json('content');

    expect($content['faq']['items'])->toHaveCount(16)
        ->and(mb_strlen($content['brand']['name']))->toBe(200)
        ->and($content['brand']['color'])->toBe(LmsSiteProfile::DEFAULT_COLOR);
});

it('drops blank rows left behind in the editor', function () {
    Sanctum::actingAs($this->owner);

    $content = $this->putJson('/api/courses/site', [
        'instructors' => ['items' => [
            ['name' => 'Ms. Hana', 'role' => 'Chemistry'],
            ['name' => '', 'role' => 'left over'],
        ]],
        'hero' => ['badges' => ['Real badge', '   ']],
    ])->assertOk()->json('content');

    expect($content['instructors']['items'])->toHaveCount(1)
        ->and($content['hero']['badges'])->toBe(['Real badge']);
});

it('never shows one academy the content of another', function () {
    Sanctum::actingAs($this->owner);
    $this->putJson('/api/courses/site', ['hero' => ['title' => 'Noor only']])->assertOk();
    app()['auth']->forgetGuards();

    $other = $this->createAcademy(overrides: [
        'name' => 'Other Academy',
        'plan_id' => $this->lmsPlan,
        'subdomain' => 'other',
    ]);
    $otherOwner = $this->makeUser($other, 'ACADEMY_OWNER');

    Sanctum::actingAs($otherOwner);
    expect($this->getJson('/api/courses/site')->assertOk()->json('content.hero.title'))->toBe('');
    app()['auth']->forgetGuards();

    expect($this->withHeaders(siteHeaders('other'))->getJson('/api/learn/site')
        ->assertOk()->json('site.hero.title'))->toBe('');
});

it('404s the site of a handle that does not exist', function () {
    $this->withHeaders(siteHeaders('nobody'))->getJson('/api/learn/site')->assertNotFound();
});

it('lets a client read their site content but not write it without course.manage', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER');

    Sanctum::actingAs($teacher);
    $this->getJson('/api/courses/site')->assertForbidden();
    $this->putJson('/api/courses/site', ['hero' => ['title' => 'Nope']])->assertForbidden();
});
