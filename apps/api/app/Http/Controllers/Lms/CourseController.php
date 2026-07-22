<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Courses (LMS module, entitled:lms). A course is a publishable unit of learning — sections of
 * lessons (video / YouTube / audio / PDF / text / quiz) an academy's learners watch on the public
 * subdomain (docs/lms). This controller is the authoring side: staff build and publish courses.
 *
 * Two capabilities gate the surface: `course.read` (list + open the editor) and `course.manage`
 * (create / edit / publish / archive / delete). Both are OWNER-only by default, delegated to a
 * course-team employee through a custom role. RLS scopes every query to the current academy.
 */
final class CourseController extends Controller
{
    use InteractsWithLms;

    private const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

    /** GET /api/courses — the server-driven list view. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('course.read');

        $query = DB::table('courses as c')
            ->whereNull('c.deleted_at')
            ->select([
                'c.id', 'c.title', 'c.slug', 'c.subtitle', 'c.status',
                'c.cover_image_path', 'c.published_at', 'c.created_at',
                DB::raw('(select count(*) from lessons l where l.course_id = c.id) as lesson_count'),
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'c.id',
            'searchable' => ['c.title', 'c.subtitle'],
            'sortable' => [
                'created_at' => 'c.created_at',
                'title' => 'c.title',
                'status' => 'c.status',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('c.status', strtoupper((string) $value)),
            ],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): object => $this->presentCourse($r));

        return response()->json($result);
    }

    /** GET /api/courses/summary — headline counts for the page. */
    public function summary(): JsonResponse
    {
        Gate::authorize('course.read');

        $byStatus = DB::table('courses')
            ->whereNull('deleted_at')
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $counts = [];
        foreach (self::STATUSES as $status) {
            $counts[strtolower($status)] = (int) ($byStatus[$status] ?? 0);
        }

        return response()->json($counts + ['total' => array_sum($counts)]);
    }

    /** POST /api/courses — create a draft course. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:10000'],
        ]);

        $courseId = (string) Str::uuid();
        DB::table('courses')->insert([
            'id' => $courseId,
            'academy_id' => $academyId,
            'title' => trim($data['title']),
            'slug' => $this->uniqueCourseSlug($academyId, $data['title']),
            'subtitle' => $data['subtitle'] ?? null,
            'description' => $data['description'] ?? null,
            'status' => 'DRAFT',
            'created_by' => $this->ctx()->userId,
        ]);

        Audit::log('course.create', 'course', $courseId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'title' => $data['title'],
        ]);

        return response()->json(['courseId' => $courseId], 201);
    }

    /** GET /api/courses/{id} — one course with its full section→lesson outline (the editor payload). */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('course.read');

        $course = $this->findCourse($id);

        $sections = DB::table('course_sections')
            ->where('course_id', $id)
            ->orderBy('position')
            ->orderBy('created_at')
            ->get(['id', 'title', 'position']);

        $lessons = DB::table('lessons')
            ->where('course_id', $id)
            ->orderBy('position')
            ->orderBy('created_at')
            ->get([
                'id', 'section_id', 'title', 'type', 'position', 'is_preview',
                'duration_seconds', 'media_asset_id', 'youtube_video_id',
                'attachment_path', 'body', 'quiz_id',
            ]);

        $bySection = [];
        foreach ($lessons as $lesson) {
            $bySection[(string) $lesson->section_id][] = [
                'id' => (string) $lesson->id,
                'title' => (string) $lesson->title,
                'type' => (string) $lesson->type,
                'position' => (int) $lesson->position,
                'is_preview' => (bool) $lesson->is_preview,
                'duration_seconds' => $lesson->duration_seconds !== null ? (int) $lesson->duration_seconds : null,
                'media_asset_id' => $lesson->media_asset_id,
                'youtube_video_id' => $lesson->youtube_video_id,
                'attachment_path' => $lesson->attachment_path,
                'body' => $lesson->body,
                'quiz_id' => $lesson->quiz_id,
            ];
        }

        return response()->json([
            'course' => $this->presentCourse($course),
            'sections' => $sections->map(fn (object $s): array => [
                'id' => (string) $s->id,
                'title' => (string) $s->title,
                'position' => (int) $s->position,
                'lessons' => $bySection[(string) $s->id] ?? [],
            ]),
        ]);
    }

    /** PATCH /api/courses/{id} — edit metadata (title/subtitle/description/slug/cover). */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $course = $this->findCourse($id);

        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'slug' => ['sometimes', 'string', 'max:255', 'regex:/^[a-z0-9-]+$/'],
            'cover_image_path' => ['sometimes', 'nullable', 'string', 'max:1024'],
        ]);

        $update = [];
        foreach (['title', 'subtitle', 'description', 'cover_image_path'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = is_string($data[$field]) ? trim($data[$field]) : $data[$field];
            }
        }
        if (array_key_exists('slug', $data)) {
            $update['slug'] = $this->uniqueCourseSlug($academyId, $data['slug'], $id);
        }

        if ($update === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('courses')->where('id', $id)->update($update + ['updated_at' => now()]);

        Audit::log('course.update', 'course', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: $update, before: ['title' => $course->title]);

        return response()->json(['ok' => true, 'changed' => array_keys($update)]);
    }

    /** POST /api/courses/{id}/publish — set the course's status (DRAFT ↔ PUBLISHED ↔ ARCHIVED). */
    public function setStatus(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $course = $this->findCourse($id);

        $data = $request->validate([
            'status' => ['required', Rule::in(self::STATUSES)],
        ]);
        $status = $data['status'];

        // Publishing needs at least one lesson — an empty course on the public site is a dead link.
        if ($status === 'PUBLISHED' && DB::table('lessons')->where('course_id', $id)->doesntExist()) {
            return response()->json([
                'message' => 'Add at least one lesson before publishing this course.',
                'errors' => ['status' => ['Add at least one lesson before publishing this course.']],
            ], 422);
        }

        DB::table('courses')->where('id', $id)->update([
            'status' => $status,
            'published_at' => $status === 'PUBLISHED' ? ($course->published_at ?? now()) : $course->published_at,
            'updated_at' => now(),
        ]);

        Audit::log('course.set_status', 'course', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => $status], before: ['status' => $course->status]);

        return response()->json(['ok' => true, 'status' => $status]);
    }

    /** DELETE /api/courses/{id} — soft-delete (enrollments/history outlive an editorial delete). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $course = $this->findCourse($id);

        DB::table('courses')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);

        Audit::log('course.delete', 'course', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['title' => $course->title, 'status' => $course->status]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Normalise a course row for the client (ISO timestamps, typed counts). */
    private function presentCourse(object $c): object
    {
        $c->created_at = $this->iso($c->created_at ?? null);
        if (property_exists($c, 'published_at')) {
            $c->published_at = $this->iso($c->published_at);
        }
        if (property_exists($c, 'lesson_count')) {
            $c->lesson_count = (int) $c->lesson_count;
        }

        return $c;
    }
}
