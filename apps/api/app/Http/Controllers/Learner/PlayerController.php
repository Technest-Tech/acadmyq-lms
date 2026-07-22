<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\BuildsCourseOutline;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Http\Controllers\Learner\Concerns\IssuesCertificates;
use App\Support\LmsMedia;
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
    use BuildsCourseOutline, InteractsWithLearner, IssuesCertificates;

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

    /**
     * GET /api/learn/lessons/{id}/playback — a short-lived signed URL for an uploaded lesson's media
     * (VIDEO_UPLOAD / uploaded AUDIO, docs/lms/04). Gated by the same enrollment check as the player
     * (a free-preview lesson is playable un-enrolled). The raw storage key never leaves the server.
     */
    public function playback(string $lessonId): JsonResponse
    {
        $this->currentAcademyId();

        $lesson = DB::table('lessons')->where('id', $lessonId)
            ->first(['id', 'course_id', 'type', 'is_preview', 'media_asset_id']);
        if ($lesson === null) {
            abort(404, 'Lesson not found.');
        }
        if (! (bool) $lesson->is_preview) {
            $this->assertEnrolled((string) $lesson->course_id);
        }
        if (! in_array((string) $lesson->type, ['VIDEO_UPLOAD', 'AUDIO'], true) || $lesson->media_asset_id === null) {
            abort(404, 'This lesson has no playable media.');
        }

        $asset = DB::table('media_assets')
            ->where('id', $lesson->media_asset_id)
            ->where('status', 'READY')
            ->first(['id', 'kind', 'playback_path', 'storage_key']);
        if ($asset === null) {
            abort(409, 'This lesson is still processing.');
        }

        return response()->json([
            'kind' => (string) $asset->kind,
            'url' => LmsMedia::playbackUrl($asset),
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

        // Completing the final lesson (of any type) may finish the course → issue the certificate.
        $certificate = $completed
            ? $this->maybeIssueCertificate($academyId, (string) $learner->getKey(), (string) $lesson->course_id)
            : null;

        return response()->json([
            'ok' => true,
            'certificate' => $certificate !== null ? ['serial' => (string) $certificate->serial] : null,
        ]);
    }

    /**
     * GET /api/learn/courses/{slug}/certificate — the learner's course-completion certificate, if
     * issued. Enrollment-gated (the same course they studied); returns the serial + printable details.
     */
    public function certificate(string $slug): JsonResponse
    {
        $this->currentAcademyId();
        $learner = $this->learner();

        $course = DB::table('courses')->where('slug', $slug)->whereNull('deleted_at')
            ->first(['id', 'title']);
        if ($course === null) {
            abort(404, 'Course not found.');
        }
        $this->assertEnrolled((string) $course->id);

        $cert = DB::table('course_certificates')
            ->where('learner_id', $learner->getKey())
            ->where('course_id', $course->id)
            ->first(['serial', 'issued_at']);
        if ($cert === null) {
            abort(404, 'No certificate yet — finish every lesson to earn it.');
        }

        return response()->json([
            'serial' => (string) $cert->serial,
            'issued_at' => $this->iso($cert->issued_at),
            'course_title' => (string) $course->title,
            'learner_name' => (string) $learner->full_name,
        ]);
    }
}
