<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\BuildsCourseOutline;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The enrolled-learner course player (docs/lms/04). Requires an ACTIVE enrollment (via a redeemed
 * code) for the course — that is the gate the whole LMS turns on. Serves every lesson's content and
 * the learner's progress, and records the resume point + completion as they watch. Reuses the
 * section→lesson outline (BuildsCourseOutline, content included here).
 */
final class PlayerController extends Controller
{
    use BuildsCourseOutline, InteractsWithLearner;

    /** GET /api/learn/courses/{slug}/content — the full player payload for an enrolled learner. */
    public function content(string $slug): JsonResponse
    {
        $this->currentAcademyId();

        // Enrolled learners keep access to a PUBLISHED or later-ARCHIVED course (never a draft).
        $course = DB::table('courses')
            ->where('slug', $slug)
            ->whereIn('status', ['PUBLISHED', 'ARCHIVED'])
            ->whereNull('deleted_at')
            ->first(['id', 'title', 'slug', 'subtitle', 'description', 'cover_image_path']);
        if ($course === null) {
            abort(404, 'Course not found.');
        }

        $this->assertEnrolled((string) $course->id);

        $progress = DB::table('lesson_progress')
            ->where('learner_id', $this->learner()->getKey())
            ->where('course_id', $course->id)
            ->get(['lesson_id', 'status', 'position_seconds', 'completed_at'])
            ->keyBy('lesson_id')
            ->map(fn (object $p): array => [
                'status' => (string) $p->status,
                'position_seconds' => (int) $p->position_seconds,
                'completed_at' => $this->iso($p->completed_at),
            ]);

        return response()->json([
            'course' => [
                'id' => (string) $course->id,
                'title' => (string) $course->title,
                'slug' => (string) $course->slug,
                'subtitle' => $course->subtitle,
                'description' => $course->description,
                'cover_image_path' => $course->cover_image_path,
            ],
            'sections' => $this->outline((string) $course->id, includeContent: true),
            'progress' => $progress,
        ]);
    }

    /** POST /api/learn/lessons/{id}/progress — save the resume point / completion for one lesson. */
    public function progress(Request $request, string $lessonId): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $learner = $this->learner();

        $lesson = DB::table('lessons')->where('id', $lessonId)->first(['id', 'course_id']);
        if ($lesson === null) {
            abort(404, 'Lesson not found.');
        }
        $this->assertEnrolled((string) $lesson->course_id);

        $data = $request->validate([
            'position_seconds' => ['sometimes', 'integer', 'min:0', 'max:360000'],
            'completed' => ['sometimes', 'boolean'],
        ]);

        $existing = DB::table('lesson_progress')
            ->where('learner_id', $learner->getKey())
            ->where('lesson_id', $lessonId)
            ->first(['status', 'position_seconds']);

        $completed = (bool) ($data['completed'] ?? ($existing?->status === 'COMPLETED'));
        $position = $data['position_seconds'] ?? (int) ($existing->position_seconds ?? 0);

        DB::table('lesson_progress')->updateOrInsert(
            ['learner_id' => $learner->getKey(), 'lesson_id' => $lessonId],
            [
                'academy_id' => $academyId,
                'course_id' => $lesson->course_id,
                'status' => $completed ? 'COMPLETED' : 'IN_PROGRESS',
                'position_seconds' => $position,
                'completed_at' => $completed ? now() : null,
                'updated_at' => now(),
            ],
        );

        return response()->json(['ok' => true]);
    }

    /** ACTIVE enrollment in $courseId for the current learner, or 403. */
    private function assertEnrolled(string $courseId): void
    {
        $ok = DB::table('enrollments')
            ->where('learner_id', $this->learner()->getKey())
            ->where('course_id', $courseId)
            ->where('status', 'ACTIVE')
            ->exists();
        if (! $ok) {
            abort(403, 'Enroll with a code to watch this course.');
        }
    }
}
