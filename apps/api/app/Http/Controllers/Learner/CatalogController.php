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

        $courses = DB::table('courses as c')
            ->where('c.status', 'PUBLISHED')
            ->whereNull('c.deleted_at')
            ->orderByDesc('c.published_at')
            ->get([
                'c.id', 'c.title', 'c.slug', 'c.subtitle', 'c.cover_image_path', 'c.price_minor', 'c.published_at',
                'c.updated_at',
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
            ]);

        return response()->json(['courses' => $courses]);
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
                'published_at', 'updated_at',
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
            ],
            'sections' => $this->outline((string) $course->id, includeContent: false),
        ]);
    }
}
