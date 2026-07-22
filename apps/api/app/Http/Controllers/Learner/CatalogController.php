<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\BuildsCourseOutline;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
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
        $this->currentAcademyId();

        $courses = DB::table('courses as c')
            ->where('c.status', 'PUBLISHED')
            ->whereNull('c.deleted_at')
            ->orderByDesc('c.published_at')
            ->get([
                'c.id', 'c.title', 'c.slug', 'c.subtitle', 'c.cover_image_path', 'c.published_at',
                DB::raw('(select count(*) from lessons l where l.course_id = c.id) as lesson_count'),
            ])
            ->map(fn (object $c): array => [
                'id' => (string) $c->id,
                'title' => (string) $c->title,
                'slug' => (string) $c->slug,
                'subtitle' => $c->subtitle,
                'cover_image_path' => $c->cover_image_path,
                'lesson_count' => (int) $c->lesson_count,
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
            ->first(['id', 'title', 'slug', 'subtitle', 'description', 'cover_image_path']);
        if ($course === null) {
            abort(404, 'Course not found.');
        }

        return response()->json([
            'course' => [
                'id' => (string) $course->id,
                'title' => (string) $course->title,
                'slug' => (string) $course->slug,
                'subtitle' => $course->subtitle,
                'description' => $course->description,
                'cover_image_path' => $course->cover_image_path,
            ],
            'sections' => $this->outline((string) $course->id, includeContent: false),
        ]);
    }
}
