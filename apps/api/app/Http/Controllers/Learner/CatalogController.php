<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\BuildsCourseOutline;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The PUBLIC course catalog on the LMS learner site (docs/lms/06). No auth — anyone on the academy's
 * subdomain can browse PUBLISHED courses and open a course's outline. Lesson CONTENT is withheld
 * unless the lesson is a free preview; the enrollment-gated player (PlayerController) serves the rest
 * to redeemed learners. RLS scopes everything to the subdomain's academy.
 */
final class CatalogController extends Controller
{
    use BuildsCourseOutline, InteractsWithLearner;

    /** GET /api/learn/courses — the published catalog. */
    public function index(): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $currency = $this->academyCurrency($academyId);
        $acceptsPayments = $this->siteAcceptsPayments();

        $courses = DB::table('courses as c')
            ->where('c.status', 'PUBLISHED')
            ->whereNull('c.deleted_at')
            ->orderByDesc('c.published_at')
            ->get([
                'c.id', 'c.title', 'c.slug', 'c.subtitle', 'c.cover_image_path', 'c.price_minor', 'c.published_at',
                'c.updated_at', 'c.checkout_enabled', 'c.code_enabled', 'c.level', 'c.category',
                // The card's facts (docs/lms/09). Correlated counts, not joins: a catalogue is tens of
                // rows, and this keeps one row per course without a group-by over every lesson.
                DB::raw('(select count(*) from lessons l where l.course_id = c.id) as lesson_count'),
                DB::raw('(select count(*) from course_sections s where s.course_id = c.id) as section_count'),
                DB::raw('(select coalesce(sum(l.duration_seconds), 0) from lessons l where l.course_id = c.id) as duration_seconds'),
                DB::raw('(select count(*) from lessons l where l.course_id = c.id and l.is_preview) as preview_count'),
                DB::raw("(select count(*) from enrollments e where e.course_id = c.id and e.status = 'ACTIVE') as learner_count"),
            ])
            ->map(fn (object $c): array => [
                'id' => (string) $c->id,
                'title' => (string) $c->title,
                'slug' => (string) $c->slug,
                'subtitle' => $c->subtitle,
                'cover_image_path' => LmsMedia::coverUrl($c->cover_image_path),
                'lesson_count' => (int) $c->lesson_count,
                'section_count' => (int) $c->section_count,
                'duration_seconds' => (int) $c->duration_seconds,
                'preview_count' => (int) $c->preview_count,
                'learner_count' => (int) $c->learner_count,
                'published_at' => $this->iso($c->published_at),
                'updated_at' => $this->iso($c->updated_at),
                'price_minor' => (int) $c->price_minor,
                'currency' => $currency,
                'is_free' => (int) $c->price_minor === 0,
                // Two chips, and only when the client set them (docs/lms/09 §3). The catalogue's
                // level and topic facets are built from exactly these values, so a client who
                // never filled them in gets no facets rather than a filter over "null".
                'level' => $c->level,
                'category' => $c->category,
            ] + $this->channels($c, $acceptsPayments));

        return response()->json(['courses' => $courses]);
    }

    /**
     * How this course may be unlocked, as the sales page has to render it (docs/lms/10 §1).
     *
     * `sells_online` is deliberately NOT just the course's own flag: a Buy button with no receiving
     * account behind it strands the buyer on a checkout with nowhere to pay, so the site-wide fact
     * "this client has a live payment method" is folded in here, once, rather than in the template.
     *
     * @return array<string,bool>
     */
    private function channels(object $c, bool $acceptsPayments): array
    {
        $free = (int) $c->price_minor === 0;

        return [
            'checkout_enabled' => (bool) $c->checkout_enabled,
            'code_enabled' => (bool) $c->code_enabled,
            'sells_online' => ! $free && (bool) $c->checkout_enabled && $acceptsPayments,
        ];
    }

    /**
     * A jsonb list column as a clean list of strings. Postgres hands it back as a JSON string; a
     * malformed or absent value degrades to `[]` so a sales block is hidden rather than half-drawn.
     *
     * @return list<string>
     */
    private function jsonList(mixed $value): array
    {
        $decoded = is_array($value) ? $value : (is_string($value) ? json_decode($value, true) : null);
        if (! is_array($decoded)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn ($v): string => is_string($v) ? trim($v) : '', $decoded),
            fn (string $v): bool => $v !== '',
        ));
    }

    /**
     * Does this client have any active receiving account?
     *
     * Deliberately NOT memoised on the instance: Laravel caches the controller object on the Route,
     * so an instance property survives between requests and would happily serve a stale "yes" after
     * the client switched their last method off. Each action computes it once and passes it down.
     */
    private function siteAcceptsPayments(): bool
    {
        return DB::table('lms_payment_methods')->where('is_active', true)->exists();
    }

    /** GET /api/learn/courses/{slug} — a course's public outline (preview lessons carry content). */
    public function show(string $slug): JsonResponse
    {
        $this->currentAcademyId();

        $course = DB::table('courses')
            ->where('slug', $slug)
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at')
            ->first([
                'id', 'title', 'slug', 'subtitle', 'description', 'cover_image_path', 'price_minor',
                'published_at', 'updated_at', 'checkout_enabled', 'code_enabled',
                'level', 'category', 'outcomes', 'requirements', 'audience',
            ]);
        if ($course === null) {
            abort(404, 'Course not found.');
        }

        // Real social proof for the sales page — an actual enrolment count, never an invented one.
        // The site renders it only when it is worth showing, so a brand-new course reads as new.
        $learners = (int) DB::table('enrollments')
            ->where('course_id', $course->id)
            ->where('status', 'ACTIVE')
            ->count();

        return response()->json([
            'course' => [
                'id' => (string) $course->id,
                'title' => (string) $course->title,
                'slug' => (string) $course->slug,
                'subtitle' => $course->subtitle,
                'description' => $course->description,
                'cover_image_path' => LmsMedia::coverUrl($course->cover_image_path),
                'learner_count' => $learners,
                'published_at' => $this->iso($course->published_at),
                'updated_at' => $this->iso($course->updated_at),
                'price_minor' => (int) $course->price_minor,
                'currency' => $this->academyCurrency((string) $this->currentAcademyId()),
                'is_free' => (int) $course->price_minor === 0,
                'level' => $course->level,
                'category' => $course->category,
                // "What you'll learn" / "You'll need" / "This is for you if…" — empty lists are the
                // normal state and the sales page hides those blocks entirely (docs/lms/09 §4).
                'outcomes' => $this->jsonList($course->outcomes),
                'requirements' => $this->jsonList($course->requirements),
                'audience' => $this->jsonList($course->audience),
            ] + $this->channels($course, $this->siteAcceptsPayments()),
            'sections' => $this->outline((string) $course->id, includeContent: false),
        ]);
    }
}
