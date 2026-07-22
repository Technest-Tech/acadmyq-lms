<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Lessons (LMS module, entitled:lms) — the items inside a section. A lesson's `type` selects which
 * payload matters (docs/lms/04-CONTENT-VOD-AND-QUIZZES):
 *   - YOUTUBE  → youtube_video_id (parsed from the pasted URL)
 *   - TEXT     → body (markdown)
 *   - PDF      → attachment_path (a link for now; direct upload arrives with the media pipeline)
 *   - AUDIO    → attachment_path (a link for now; upload+transcode is phase 3)
 * VIDEO_UPLOAD and QUIZ are recognised by the schema but not yet accepted here — they need the media
 * pipeline (phase 3) and the quiz subsystem (phase 4). They are rejected with a clear message so the
 * editor can grey them out without the API silently accepting a half-built lesson.
 *
 * `course.manage` gates everything; RLS scopes to the academy.
 */
final class LessonController extends Controller
{
    use InteractsWithLms;

    /** Types the phase-1 authoring API accepts (no media/quiz pipeline required). */
    private const SUPPORTED_TYPES = ['YOUTUBE', 'TEXT', 'PDF', 'AUDIO'];

    /** Recognised in the schema but not yet buildable here. */
    private const DEFERRED_TYPES = ['VIDEO_UPLOAD', 'QUIZ'];

    /** POST /api/courses/{course}/lessons — add a lesson to a section. */
    public function store(Request $request, string $courseId): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $this->findCourse($courseId);

        $data = $request->validate($this->rules(creating: true));
        $this->assertSupportedType($data['type']);
        $this->assertSectionInCourse($courseId, $data['section_id']);

        $payload = $this->buildTypePayload($data['type'], $data);

        $lessonId = (string) Str::uuid();
        DB::table('lessons')->insert([
            'id' => $lessonId,
            'academy_id' => $academyId,
            'course_id' => $courseId,
            'section_id' => $data['section_id'],
            'title' => trim($data['title']),
            'type' => $data['type'],
            'position' => $this->nextPosition($data['section_id']),
            'is_preview' => (bool) ($data['is_preview'] ?? false),
            'duration_seconds' => $data['duration_seconds'] ?? null,
        ] + $payload);

        Audit::log('lesson.create', 'lesson', $lessonId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['course_id' => $courseId, 'type' => $data['type'], 'title' => $data['title']]);

        return response()->json(['lessonId' => $lessonId], 201);
    }

    /** PATCH /api/courses/{course}/lessons/{id} — edit a lesson (title, preview, payload, or move section). */
    public function update(Request $request, string $courseId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $lesson = $this->findLesson($courseId, $id);

        $data = $request->validate($this->rules(creating: false));

        $update = [];
        if (array_key_exists('title', $data)) {
            $update['title'] = trim($data['title']);
        }
        if (array_key_exists('is_preview', $data)) {
            $update['is_preview'] = (bool) $data['is_preview'];
        }
        if (array_key_exists('duration_seconds', $data)) {
            $update['duration_seconds'] = $data['duration_seconds'];
        }
        if (array_key_exists('section_id', $data)) {
            $this->assertSectionInCourse($courseId, $data['section_id']);
            if ((string) $data['section_id'] !== (string) $lesson->section_id) {
                $update['section_id'] = $data['section_id'];
                $update['position'] = $this->nextPosition($data['section_id']);
            }
        }

        // Payload is only rebuilt when the caller sends type-specific fields (or a new type).
        $type = $data['type'] ?? (string) $lesson->type;
        if (isset($data['type']) || $this->touchesPayload($data)) {
            $this->assertSupportedType($type);
            $update['type'] = $type;
            $update += $this->buildTypePayload($type, $data, $lesson);
        }

        if ($update === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('lessons')->where('id', $id)->update($update + ['updated_at' => now()]);

        Audit::log('lesson.update', 'lesson', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: array_keys($update), before: ['title' => $lesson->title]);

        return response()->json(['ok' => true, 'changed' => array_keys($update)]);
    }

    /** DELETE /api/courses/{course}/lessons/{id}. */
    public function destroy(string $courseId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $lesson = $this->findLesson($courseId, $id);

        DB::table('lessons')->where('id', $id)->delete();

        Audit::log('lesson.delete', 'lesson', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['title' => $lesson->title, 'type' => $lesson->type]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/courses/{course}/lessons/reorder — persist a new order within a section. */
    public function reorder(Request $request, string $courseId): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $this->findCourse($courseId);

        $data = $request->validate([
            'section_id' => ['required', 'uuid'],
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['uuid'],
        ]);
        $this->assertSectionInCourse($courseId, $data['section_id']);

        $valid = DB::table('lessons')
            ->where('course_id', $courseId)
            ->where('section_id', $data['section_id'])
            ->pluck('id')->map('strval')->all();

        foreach ($data['ids'] as $position => $id) {
            if (! in_array((string) $id, $valid, true)) {
                continue;
            }
            DB::table('lessons')->where('id', $id)->update(['position' => $position, 'updated_at' => now()]);
        }

        Audit::log('lesson.reorder', 'course', $courseId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['section_id' => $data['section_id'], 'order' => $data['ids']]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** @return array<string, list<mixed>> */
    private function rules(bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return [
            'title' => [$req, 'string', 'max:255'],
            'type' => [$req, Rule::in([...self::SUPPORTED_TYPES, ...self::DEFERRED_TYPES])],
            'section_id' => [$req, 'uuid'],
            'is_preview' => ['sometimes', 'boolean'],
            'duration_seconds' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:360000'],
            // type payloads (validated for presence by buildTypePayload):
            'youtube_url' => ['sometimes', 'nullable', 'string', 'max:1024'],
            'body' => ['sometimes', 'nullable', 'string', 'max:100000'],
            'url' => ['sometimes', 'nullable', 'string', 'max:2048', 'url'],
        ];
    }

    /** Does this payload carry any type-specific field (so update() should rebuild the payload)? */
    private function touchesPayload(array $data): bool
    {
        return array_key_exists('youtube_url', $data)
            || array_key_exists('body', $data)
            || array_key_exists('url', $data);
    }

    private function assertSupportedType(string $type): void
    {
        if (in_array($type, self::DEFERRED_TYPES, true)) {
            throw ValidationException::withMessages([
                'type' => [$type === 'QUIZ'
                    ? 'Quiz lessons arrive in a later release.'
                    : 'Uploaded-video lessons arrive in a later release — use a YouTube link for now.'],
            ]);
        }
        if (! in_array($type, self::SUPPORTED_TYPES, true)) {
            throw ValidationException::withMessages(['type' => ["Unsupported lesson type: {$type}."]]);
        }
    }

    /**
     * The columns that carry a lesson's content for its type. All non-relevant payload columns are
     * NULLed so a type change from (say) YOUTUBE to TEXT doesn't leave a stale video id behind.
     *
     * @return array<string, mixed>
     */
    private function buildTypePayload(string $type, array $data, ?object $existing = null): array
    {
        $blank = [
            'youtube_video_id' => null,
            'body' => null,
            'attachment_path' => null,
            'media_asset_id' => null,
            'quiz_id' => null,
        ];

        switch ($type) {
            case 'YOUTUBE':
                $raw = $data['youtube_url'] ?? null;
                if ($raw === null && $existing !== null && $existing->type === 'YOUTUBE') {
                    return []; // nothing to change
                }
                $videoId = $raw !== null ? $this->parseYoutubeId((string) $raw) : null;
                if ($videoId === null) {
                    throw ValidationException::withMessages(['youtube_url' => ['Enter a valid YouTube link.']]);
                }

                return ['youtube_video_id' => $videoId] + $blank;

            case 'TEXT':
                $body = $data['body'] ?? ($existing?->type === 'TEXT' ? $existing->body : null);
                if ($body === null || trim((string) $body) === '') {
                    throw ValidationException::withMessages(['body' => ['Text lessons need some content.']]);
                }

                return ['body' => (string) $body] + $blank;

            case 'PDF':
            case 'AUDIO':
                $url = $data['url'] ?? ($existing !== null && $existing->type === $type ? $existing->attachment_path : null);
                if ($url === null || trim((string) $url) === '') {
                    throw ValidationException::withMessages(['url' => ['Provide a link to the file.']]);
                }

                return ['attachment_path' => (string) $url] + $blank;
        }

        return $blank;
    }

    private function assertSectionInCourse(string $courseId, string $sectionId): void
    {
        $ok = DB::table('course_sections')->where('id', $sectionId)->where('course_id', $courseId)->exists();
        if (! $ok) {
            throw ValidationException::withMessages(['section_id' => ['That section is not part of this course.']]);
        }
    }

    private function findLesson(string $courseId, string $id): object
    {
        $this->findCourse($courseId);
        $lesson = DB::table('lessons')->where('id', $id)->where('course_id', $courseId)->first();
        if ($lesson === null) {
            abort(404, 'Lesson not found.');
        }

        return $lesson;
    }

    private function nextPosition(string $sectionId): int
    {
        return (int) DB::table('lessons')->where('section_id', $sectionId)->max('position') + 1;
    }
}
