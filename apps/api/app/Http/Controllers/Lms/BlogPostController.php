<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use App\Support\CustomDomain;
use App\Support\DataTable;
use App\Support\Lms\BlogContent;
use App\Support\LmsMedia;
use App\Support\LmsSite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The course site's blog, authoring side (docs/lms/12). Staff write articles in a rich-text editor
 * and publish them to `/blog` on their public site.
 *
 * Reuses the course capabilities, exactly as books do (docs/lms/11 §6): `course.read` /
 * `course.manage` already mean "runs this client's public catalogue", and a client who trusts
 * someone to publish a course is not protected by withholding the blog from them.
 *
 * Every body passes through {@see BlogContent::sanitize} on the way in and {@see BlogContent::render}
 * on the way out — the column holds a stored form, never what the browser sent. RLS scopes every
 * query to the current academy.
 */
final class BlogPostController extends Controller
{
    use InteractsWithLms;

    private const STATUSES = ['DRAFT', 'PUBLISHED'];

    /** GET /api/courses/posts — the server-driven list view. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('course.read');

        $query = DB::table('blog_posts as p')
            ->whereNull('p.deleted_at')
            ->select([
                'p.id', 'p.title', 'p.slug', 'p.status', 'p.cover_image_path',
                'p.excerpt', 'p.auto_excerpt', 'p.author_name', 'p.reading_minutes',
                'p.published_at', 'p.created_at', 'p.updated_at',
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'p.id',
            'searchable' => ['p.title', 'p.excerpt', 'p.auto_excerpt'],
            'sortable' => [
                'updated_at' => 'p.updated_at',
                'created_at' => 'p.created_at',
                'published_at' => 'p.published_at',
                'title' => 'p.title',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('p.status', strtoupper((string) $value)),
            ],
            'defaultSort' => '-updated_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): array => $this->present($r));

        return response()->json($result);
    }

    /** GET /api/courses/posts/summary — headline counts + where the blog lives. */
    public function summary(): JsonResponse
    {
        Gate::authorize('course.read');

        $byStatus = DB::table('blog_posts')
            ->whereNull('deleted_at')
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $counts = [];
        foreach (self::STATUSES as $status) {
            $counts[strtolower($status)] = (int) ($byStatus[$status] ?? 0);
        }

        return response()->json($counts + [
            'total' => array_sum($counts),
            'site_url' => $this->siteUrl(),
        ]);
    }

    /** POST /api/courses/posts — start a draft. The editor opens on it straight away. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate(['title' => ['required', 'string', 'max:255']]);

        $postId = (string) Str::uuid();
        DB::table('blog_posts')->insert([
            'id' => $postId,
            'academy_id' => $academyId,
            'title' => trim($data['title']),
            'slug' => $this->uniqueSlugIn('blog_posts', $academyId, $data['title'], 'post'),
            // A byline from the start — the writer's own name, which they can change or clear.
            'author_name' => DB::table('users')->where('id', $this->ctx()->userId)->value('full_name'),
            'status' => 'DRAFT',
            'created_by' => $this->ctx()->userId,
        ]);

        Audit::log('lms_post.create', 'blog_post', $postId, $academyId,
            $this->ctx()->userId, $this->ctx()->role, after: ['title' => $data['title']]);

        return response()->json(['postId' => $postId], 201);
    }

    /** GET /api/courses/posts/{id} — the editor payload, body rendered for Tiptap to load. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('course.read');

        $post = $this->findPost($id);

        return response()->json([
            'post' => $this->present($post) + [
                'content_html' => BlogContent::render($post->content_html),
                // The author's own summary, raw — the editor must not show the derived one as if
                // they had typed it.
                'excerpt' => $post->excerpt,
            ],
            'site_url' => $this->siteUrl(),
        ]);
    }

    /** PATCH /api/courses/posts/{id} — save the editor. Every field is optional. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $post = $this->findPost($id);
        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'slug' => ['sometimes', 'string', 'max:255', 'regex:/^[a-z0-9-]+$/'],
            'excerpt' => ['sometimes', 'nullable', 'string', 'max:500'],
            'author_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'content_html' => ['sometimes', 'nullable', 'string', 'max:'.BlogContent::MAX_BYTES],
            'cover_media_asset_id' => ['sometimes', 'nullable', 'uuid'],
            'cover_image_path' => ['sometimes', 'nullable', 'string', 'max:1024'],
        ]);

        $update = [];
        foreach (['title', 'excerpt', 'author_name'] as $field) {
            if (array_key_exists($field, $data)) {
                $value = is_string($data[$field]) ? trim($data[$field]) : null;
                $update[$field] = $value === '' && $field !== 'title' ? null : $value;
            }
        }
        if (array_key_exists('slug', $data)) {
            $update['slug'] = $this->uniqueSlugIn('blog_posts', $academyId, $data['slug'], 'post', $id);
        }
        if (array_key_exists('content_html', $data)) {
            $stored = BlogContent::sanitize($data['content_html']);
            $update['content_html'] = $stored;
            $update['auto_excerpt'] = BlogContent::excerpt($stored) ?: null;
            $update['reading_minutes'] = BlogContent::readingMinutes($stored);
        }
        // An uploaded cover wins over a pasted url; either key present (even as null) is an edit.
        if (array_key_exists('cover_media_asset_id', $data) || array_key_exists('cover_image_path', $data)) {
            $update['cover_image_path'] = $this->resolveCover($data);
        }

        // A published post cannot be emptied: the public page would be a title over nothing.
        if ($post->status === 'PUBLISHED' && array_key_exists('content_html', $update)
            && ! BlogContent::hasContent($update['content_html'])) {
            throw ValidationException::withMessages([
                'content_html' => ['A published post needs some content. Unpublish it first to clear it.'],
            ]);
        }

        if ($update === []) {
            return response()->json(['ok' => true, 'changed' => [], 'post' => $this->present($post)]);
        }

        DB::table('blog_posts')->where('id', $id)->update($update + ['updated_at' => now()]);

        // The body is long and already versioned by `updated_at`; the audit trail records THAT it
        // changed, not a 500 KB copy of it.
        $audited = $update;
        if (array_key_exists('content_html', $audited)) {
            $audited['content_html'] = '[updated]';
        }
        Audit::log('lms_post.update', 'blog_post', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            after: $audited, before: ['title' => $post->title]);

        return response()->json([
            'ok' => true,
            'changed' => array_keys($update),
            'post' => $this->present($this->findPost($id)),
        ]);
    }

    /** POST /api/courses/posts/{id}/publish — DRAFT ↔ PUBLISHED. */
    public function setStatus(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $post = $this->findPost($id);
        $status = $request->validate(['status' => ['required', Rule::in(self::STATUSES)]])['status'];

        // A post with no body is not an article — the same reason a course with no lessons and a
        // book with no file cannot be published.
        if ($status === 'PUBLISHED' && ! BlogContent::hasContent($post->content_html)) {
            return response()->json([
                'message' => 'Write something before publishing this post.',
                'errors' => ['status' => ['Write something before publishing this post.']],
            ], 422);
        }

        DB::table('blog_posts')->where('id', $id)->update([
            'status' => $status,
            // The first publish date sticks: unpublishing to fix a typo must not bump an old article
            // to the top of the blog as if it were new.
            'published_at' => $status === 'PUBLISHED' ? ($post->published_at ?? now()) : $post->published_at,
            'updated_at' => now(),
        ]);

        Audit::log('lms_post.set_status', 'blog_post', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => $status], before: ['status' => $post->status]);

        return response()->json(['ok' => true, 'status' => $status, 'post' => $this->present($this->findPost($id))]);
    }

    /** DELETE /api/courses/posts/{id} — soft-delete (the slug stays reserved, links stay dead). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $post = $this->findPost($id);

        DB::table('blog_posts')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);

        Audit::log('lms_post.delete', 'blog_post', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            before: ['title' => $post->title, 'status' => $post->status]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function findPost(string $id): object
    {
        $post = DB::table('blog_posts')->where('id', $id)->whereNull('deleted_at')->first();
        if ($post === null) {
            abort(404, 'Post not found.');
        }

        return $post;
    }

    /**
     * The public site's base URL, so the dashboard can link "view on site" without assembling it —
     * the same LmsSite contract the site editor and the LMS dashboard use.
     */
    private function siteUrl(): ?string
    {
        $academyId = $this->currentAcademyId();
        $subdomain = DB::table('academies')->where('id', $academyId)->value('subdomain');

        return LmsSite::url(
            $subdomain === null ? null : (string) $subdomain,
            LmsSite::ownsRoot($academyId),
            CustomDomain::primaryOrigin($academyId, 'LMS'),
        );
    }

    /**
     * Same contract as a course or book cover: an uploaded asset's storage key, else a pasted url,
     * else null — so one `LmsMedia::coverUrl()` resolves either on read.
     *
     * @param  array<string,mixed>  $data
     */
    private function resolveCover(array $data): ?string
    {
        $assetId = $data['cover_media_asset_id'] ?? null;
        if ($assetId !== null) {
            $asset = DB::table('media_assets')->where('id', $assetId)->first(['storage_key', 'kind', 'status']);
            if ($asset === null || (string) $asset->kind !== 'IMAGE' || (string) $asset->status !== 'READY') {
                throw ValidationException::withMessages([
                    'cover_media_asset_id' => ['That image is not ready yet — please re-upload it.'],
                ]);
            }

            return (string) $asset->storage_key;
        }

        $url = $data['cover_image_path'] ?? null;

        return is_string($url) && trim($url) !== '' ? trim($url) : null;
    }

    /** @return array<string,mixed> */
    private function present(object $p): array
    {
        return [
            'id' => (string) $p->id,
            'title' => (string) $p->title,
            'slug' => (string) $p->slug,
            'status' => (string) $p->status,
            'cover_image_path' => LmsMedia::coverUrl($p->cover_image_path ?? null),
            // What the card shows: the author's summary, else the opening of the body.
            'summary' => ($p->excerpt ?? null) ?: ($p->auto_excerpt ?? null),
            'author_name' => $p->author_name ?? null,
            'reading_minutes' => (int) ($p->reading_minutes ?? 1),
            'published_at' => $this->iso($p->published_at ?? null),
            'created_at' => $this->iso($p->created_at ?? null),
            'updated_at' => $this->iso($p->updated_at ?? null),
        ];
    }
}
