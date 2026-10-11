<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Support\Lms\BlogContent;
use App\Support\LmsMedia;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The blog on the public course site (docs/lms/12). Entirely public — an article that needs an
 * account to read is not marketing — and read-only. Only PUBLISHED, non-deleted posts exist here;
 * a draft's slug answers 404 exactly like a slug that was never written.
 *
 * RLS scopes every row to the subdomain's academy (ResolveAcademyContext), and so does the media
 * lookup inside {@see BlogContent::render}: a body can only ever show this academy's uploads.
 */
final class BlogController extends Controller
{
    use InteractsWithLearner;

    private const PER_PAGE = 12;

    /** GET /api/learn/posts?page=N — the newest articles first. */
    public function index(Request $request): JsonResponse
    {
        $this->currentAcademyId();
        $page = max(1, (int) $request->query('page', '1'));

        $published = $this->published();
        $total = (clone $published)->count();
        $lastPage = max(1, (int) ceil($total / self::PER_PAGE));

        $posts = $published
            ->orderByDesc('published_at')
            ->orderByDesc('created_at')
            ->offset(($page - 1) * self::PER_PAGE)
            ->limit(self::PER_PAGE)
            ->get($this->cardColumns())
            ->map(fn (object $p): array => $this->card($p));

        return response()->json([
            'posts' => $posts,
            'meta' => [
                'page' => $page,
                'per_page' => self::PER_PAGE,
                'total' => $total,
                'last_page' => $lastPage,
            ],
        ]);
    }

    /** GET /api/learn/posts/{slug} — one article, plus a few more to read next. */
    public function show(string $slug): JsonResponse
    {
        $this->currentAcademyId();

        $post = $this->published()->where('slug', $slug)
            ->first([...$this->cardColumns(), 'content_html']);
        if ($post === null) {
            abort(404, 'Post not found.');
        }

        $more = $this->published()
            ->where('id', '!=', $post->id)
            ->orderByDesc('published_at')
            ->limit(3)
            ->get($this->cardColumns())
            ->map(fn (object $p): array => $this->card($p));

        return response()->json([
            'post' => $this->card($post) + [
                'content_html' => BlogContent::render($post->content_html),
            ],
            'more' => $more,
        ]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function published(): Builder
    {
        return DB::table('blog_posts')
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at');
    }

    /** @return list<string> */
    private function cardColumns(): array
    {
        return [
            'id', 'title', 'slug', 'cover_image_path', 'excerpt', 'auto_excerpt',
            'author_name', 'reading_minutes', 'published_at', 'updated_at',
        ];
    }

    /** @return array<string,mixed> */
    private function card(object $p): array
    {
        return [
            'id' => (string) $p->id,
            'title' => (string) $p->title,
            'slug' => (string) $p->slug,
            'cover_image_path' => LmsMedia::coverUrl($p->cover_image_path),
            'summary' => $p->excerpt ?: $p->auto_excerpt,
            'author_name' => $p->author_name,
            'reading_minutes' => (int) $p->reading_minutes,
            'published_at' => $this->iso($p->published_at),
            'updated_at' => $this->iso($p->updated_at),
        ];
    }
}
