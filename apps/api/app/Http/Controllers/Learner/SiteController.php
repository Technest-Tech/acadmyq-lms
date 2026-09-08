<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Support\LmsSite;
use App\Support\LmsSiteProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The public course site's own content (docs/lms/09) — everything the shared template needs to
 * render this academy's version of it: brand, section copy, contact details, SEO. Fetched once,
 * server-side, by the learner-site layout, which is why it also carries the headline counts the
 * stats band shows (a second round-trip for four numbers would be silly).
 *
 * No auth: this IS the public site. RLS scopes it to the subdomain's academy via
 * ResolveAcademyContext, so a site can only ever describe itself.
 */
final class SiteController extends Controller
{
    use InteractsWithLearner;

    /** GET /api/learn/site — the merged site profile + live catalogue counts. */
    public function show(): JsonResponse
    {
        $academyId = $this->currentAcademyId();

        // Readable under the LEARNER context: academies_select is `id = app.current_academy_id()`.
        $academy = DB::table('academies')
            ->where('id', $academyId)
            ->first(['name', 'brand_display_name', 'brand_logo_url', 'subdomain']);

        $stored = DB::table('lms_site_profiles')->where('academy_id', $academyId)->value('content');
        $stored = is_string($stored) ? json_decode($stored, true) : $stored;

        return response()->json([
            'site' => LmsSiteProfile::merge(
                is_array($stored) ? $stored : [],
                $academy === null ? [] : (array) $academy,
            ),
            'stats' => $this->stats(),
            'commerce' => $this->commerce(),
            'academy' => [
                'name' => (string) ($academy->name ?? ''),
                'subdomain' => $academy->subdomain ?? null,
                // The site's own canonical origin, so the template can emit a canonical link and
                // absolute OG urls per tenant instead of guessing from the request host.
                'url' => LmsSite::url(
                    isset($academy->subdomain) ? (string) $academy->subdomain : null,
                    LmsSite::ownsRoot((string) $academyId),
                ),
            ],
        ]);
    }

    /**
     * Which doors into a course this client actually has open, across the published catalogue.
     *
     * The storefront has to adapt to it in three places — the hero's CTAs, the FAQ's answers and
     * the footer's payment line — and all three render ABOVE the catalogue fetch, so the facts
     * travel with the site document rather than being inferred later from a list of cards (which
     * would mean a layout shift, and a wrong answer on every page that never loads the catalogue).
     *
     * Every value is derived from real rows: a client with no free course never advertises one.
     *
     * @return array<string,mixed>
     */
    private function commerce(): array
    {
        $published = fn () => DB::table('courses')
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at');

        // The newest free course is the one the hero offers as a taster; naming it lets the button
        // go straight to the course instead of dumping the visitor in an unfiltered catalogue.
        $free = $published()
            ->where('price_minor', 0)
            // With lessons, always: offering "start with a free course" and landing the visitor on
            // an empty one is worse than not offering it.
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('lessons')
                ->whereColumn('lessons.course_id', 'courses.id'))
            ->orderByDesc('published_at')
            ->first(['slug', 'title']);

        $acceptsPayments = DB::table('lms_payment_methods')->where('is_active', true)->exists();

        return [
            'free' => $free !== null,
            'free_course' => $free === null ? null : [
                'slug' => (string) $free->slug,
                'title' => (string) $free->title,
            ],
            // A Buy button is only honest when the course allows checkout AND somewhere exists to
            // send the money (docs/lms/10 §1) — the same predicate the catalogue applies per card.
            'checkout' => $acceptsPayments && $published()->where('price_minor', '>', 0)
                ->where('checkout_enabled', true)->exists(),
            'codes' => $published()->where('code_enabled', true)->exists(),
            'paid' => $published()->where('price_minor', '>', 0)->exists(),
            'books' => $this->books($acceptsPayments),
        ];
    }

    /**
     * The bookshop half (docs/lms/11) — whether this client sells digital products at all, and on
     * what terms.
     *
     * It travels with the site document for the same reason the course commerce block does: the
     * HEADER decides whether to show a "Books" link, and the header renders before any catalogue
     * fetch. A client who has never published a book must never see the link flicker into
     * existence, and one who has must not have it appear a beat late.
     *
     * @return array<string,mixed>
     */
    private function books(bool $acceptsPayments): array
    {
        $published = fn () => DB::table('digital_products')
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at');

        // A book with no file is a dead Buy button, so "any" means "any we can actually deliver" —
        // the same rule that stops a free course with no lessons being advertised above.
        $deliverable = fn () => $published()
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('digital_product_files')
                ->whereColumn('digital_product_files.product_id', 'digital_products.id'));

        $free = $deliverable()
            ->where('price_minor', 0)
            ->orderByDesc('published_at')
            ->first(['slug', 'title']);

        return [
            'any' => $deliverable()->exists(),
            'count' => (int) $deliverable()->count(),
            'free' => $free !== null,
            'free_book' => $free === null ? null : [
                'slug' => (string) $free->slug,
                'title' => (string) $free->title,
            ],
            'paid' => $deliverable()->where('price_minor', '>', 0)->exists(),
            'checkout' => $acceptsPayments && $deliverable()->where('price_minor', '>', 0)
                ->where('checkout_enabled', true)->exists(),
            // At least one free sample chapter anywhere in the shop — the hero's "read a sample"
            // promise is only made when one exists.
            'preview' => $published()->whereExists(fn ($q) => $q->select(DB::raw(1))
                ->from('digital_product_files')
                ->whereColumn('digital_product_files.product_id', 'digital_products.id')
                ->where('digital_product_files.is_preview', true))->exists(),
        ];
    }

    /**
     * The counters the stats band falls back to when the client hasn't written their own — real
     * numbers, so an unconfigured site still says something true about the academy.
     *
     * @return array<string,int>
     */
    private function stats(): array
    {
        $publishedCourses = DB::table('courses')
            ->where('status', 'PUBLISHED')->whereNull('deleted_at');

        return [
            'courses' => (int) (clone $publishedCourses)->count(),
            'lessons' => (int) DB::table('lessons')
                ->whereIn('course_id', (clone $publishedCourses)->select('id'))
                ->count(),
            'learners' => (int) DB::table('learners')->where('status', 'ACTIVE')->count(),
            'certificates' => (int) DB::table('course_certificates')->count(),
            'books' => (int) DB::table('digital_products')
                ->where('status', 'PUBLISHED')->whereNull('deleted_at')->count(),
        ];
    }
}
