<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The course site's blog (docs/lms/12).
 *
 * What these tests are actually protecting:
 *  - **The body is never stored as sent.** Scripts, handlers, styles and foreign iframes are gone;
 *    an uploaded image is kept by id and re-signed on every read, a YouTube embed by video id.
 *  - **Another academy's upload cannot be shown** by naming its id — the render lookup is RLS'd.
 *  - **Only PUBLISHED posts exist publicly.** A draft or a deleted post 404s like a missing one.
 *  - **Nothing empty is published**, and the header's Blog link has a real count to turn on.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    Storage::fake('lms_media');
    config([
        'lms.media.disk' => 'lms_media',
        'filesystems.disks.lms_media.driver' => 'local',
    ]);

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: [
        'client_type' => 'LMS',
        'subdomain' => 'blogsite',
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['full_name' => 'Huda Salem']);

    Sanctum::actingAs($this->owner);
});

function blogHeaders(string $sub = 'blogsite'): array
{
    return ['X-Academy' => $sub];
}

/** Reserve → put bytes → confirm READY for an IMAGE upload, as the current Sanctum user. */
function readyBlogImage(string $academyId): string
{
    $t = test();
    $assetId = $t->postJson('/api/courses/media/upload-url', [
        'filename' => 'photo.png',
        'content_type' => 'image/png',
        'kind' => 'IMAGE',
        'size_bytes' => 512,
    ])->assertCreated()->json('mediaAssetId');

    Storage::disk('lms_media')->put("lms/{$academyId}/{$assetId}/source.png", str_repeat('x', 512));
    $t->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()->assertJsonPath('status', 'READY');

    return $assetId;
}

/** A published post with one paragraph of body. Returns [postId, slug]. */
function publishPost(mixed $test, string $title = 'How to memorise faster'): array
{
    $postId = $test->postJson('/api/courses/posts', ['title' => $title])
        ->assertCreated()->json('postId');
    $test->patchJson("/api/courses/posts/{$postId}", [
        'content_html' => '<p>Short daily sessions beat one long one.</p>',
    ])->assertOk();
    $test->postJson("/api/courses/posts/{$postId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    return [$postId, $test->getJson("/api/courses/posts/{$postId}")->json('post.slug')];
}

// ── authoring ────────────────────────────────────────────────────────────────

it('stores a sanitized body and renders images and embeds fresh on every read', function () {
    $postId = $this->postJson('/api/courses/posts', ['title' => 'Tajweed basics'])
        ->assertCreated()->json('postId');

    // The byline starts as the writer's own name.
    $this->getJson("/api/courses/posts/{$postId}")
        ->assertOk()
        ->assertJsonPath('post.author_name', 'Huda Salem')
        ->assertJsonPath('post.status', 'DRAFT');

    $imageId = readyBlogImage($this->academy);
    $words = implode(' ', array_fill(0, 450, 'word'));

    $this->patchJson("/api/courses/posts/{$postId}", [
        'content_html' => '<h1>Intro</h1>'
            ."<p onclick=\"steal()\" style=\"color:red\">{$words}</p>"
            .'<script>alert(1)</script>'
            .'<p><a href="javascript:alert(1)">bad</a> <a href="https://example.com" target="_blank">good</a></p>'
            ."<img src=\"blob:http://localhost/abc\" data-media-id=\"{$imageId}\" alt=\"Board\">"
            .'<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"></iframe></div>'
            .'<iframe src="https://evil.example/frame"></iframe>',
    ])->assertOk();

    // RLS: the row is only readable inside its own academy's context.
    $this->asAcademy($this->academy);
    $stored = DB::table('blog_posts')->where('id', $postId)->first();
    $this->clearTenantContext();

    expect($stored->content_html)
        ->not->toContain('<script')
        ->not->toContain('onclick')
        ->not->toContain('style=')
        ->not->toContain('javascript:')
        ->not->toContain('evil.example')
        ->not->toContain('blob:')
        ->not->toContain('<h1')
        ->toContain('<h2>Intro</h2>')
        ->toContain("data-media-id=\"{$imageId}\"")
        ->toContain('data-youtube-video="dQw4w9WgXcQ"')
        ->toContain('rel="noopener noreferrer"');
    // 451 words at 200 wpm.
    expect((int) $stored->reading_minutes)->toBe(3);
    expect($stored->auto_excerpt)->toStartWith('Intro word word');

    $html = $this->getJson("/api/courses/posts/{$postId}")->assertOk()->json('post.content_html');
    // Re-signed on read: a real, loadable URL now sits next to the id.
    expect($html)
        ->toMatch('~<img[^>]+src="[^"]*lms/media/stream[^"]*"~')
        ->toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
});

it('drops an image that names another academy\'s upload', function () {
    $other = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'elsewhere']);
    $otherOwner = $this->makeUser($other, 'ACADEMY_OWNER');

    app()['auth']->forgetGuards();
    Sanctum::actingAs($otherOwner);
    $foreignImage = readyBlogImage($other);

    app()['auth']->forgetGuards();
    Sanctum::actingAs($this->owner);
    $postId = $this->postJson('/api/courses/posts', ['title' => 'Borrowed'])->json('postId');
    $this->patchJson("/api/courses/posts/{$postId}", [
        'content_html' => "<p>Look:</p><img data-media-id=\"{$foreignImage}\" alt=\"x\">",
    ])->assertOk();

    expect($this->getJson("/api/courses/posts/{$postId}")->json('post.content_html'))
        ->toBe('<p>Look:</p>');
});

it('will not publish an empty post, nor empty a published one', function () {
    $postId = $this->postJson('/api/courses/posts', ['title' => 'Coming soon'])->json('postId');

    $this->postJson("/api/courses/posts/{$postId}/publish", ['status' => 'PUBLISHED'])
        ->assertStatus(422)->assertJsonValidationErrors('status');

    $this->patchJson("/api/courses/posts/{$postId}", ['content_html' => '<p>Now with words.</p>'])->assertOk();
    $published = $this->postJson("/api/courses/posts/{$postId}/publish", ['status' => 'PUBLISHED'])
        ->assertOk()->json('post');
    expect($published['published_at'])->not->toBeNull();

    $this->patchJson("/api/courses/posts/{$postId}", ['content_html' => '<p></p>'])
        ->assertStatus(422)->assertJsonValidationErrors('content_html');

    // Unpublish + republish keeps the original date: fixing a typo is not a new article.
    $this->postJson("/api/courses/posts/{$postId}/publish", ['status' => 'DRAFT'])->assertOk();
    $again = $this->postJson("/api/courses/posts/{$postId}/publish", ['status' => 'PUBLISHED'])->json('post');
    expect($again['published_at'])->toBe($published['published_at']);
});

it('keeps the blog to staff who run the catalogue', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER');
    app()['auth']->forgetGuards();
    Sanctum::actingAs($teacher);

    $this->postJson('/api/courses/posts', ['title' => 'Nope'])->assertForbidden();
});

// ── the public site ──────────────────────────────────────────────────────────

it('shows only published posts on the public site', function () {
    [$postId, $slug] = publishPost($this);
    $draftId = $this->postJson('/api/courses/posts', ['title' => 'Unfinished draft'])->json('postId');
    $draftSlug = $this->getJson("/api/courses/posts/{$draftId}")->json('post.slug');

    app()['auth']->forgetGuards();

    $list = $this->withHeaders(blogHeaders())->getJson('/api/learn/posts')->assertOk();
    expect($list->json('posts'))->toHaveCount(1);
    $list->assertJsonPath('posts.0.slug', $slug)
        ->assertJsonPath('posts.0.summary', 'Short daily sessions beat one long one.')
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('meta.last_page', 1);

    $this->withHeaders(blogHeaders())->getJson("/api/learn/posts/{$slug}")
        ->assertOk()
        ->assertJsonPath('post.title', 'How to memorise faster')
        ->assertJsonPath('post.content_html', '<p>Short daily sessions beat one long one.</p>');

    $this->withHeaders(blogHeaders())->getJson("/api/learn/posts/{$draftSlug}")->assertNotFound();

    // The header's Blog link reads this count off the site document.
    $this->withHeaders(blogHeaders())->getJson('/api/learn/site')
        ->assertOk()->assertJsonPath('stats.posts', 1);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/courses/posts/{$postId}")->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(blogHeaders())->getJson("/api/learn/posts/{$slug}")->assertNotFound();
    $this->withHeaders(blogHeaders())->getJson('/api/learn/posts')->assertJsonPath('meta.total', 0);
});

it('never shows one academy\'s posts on another\'s site', function () {
    publishPost($this);

    $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'neighbour']);
    app()['auth']->forgetGuards();

    $this->withHeaders(blogHeaders('neighbour'))->getJson('/api/learn/posts')
        ->assertOk()->assertJsonPath('meta.total', 0);
});
