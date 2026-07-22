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

/**
 * Course sections (LMS module, entitled:lms) — the ordered chapters inside a course. Every route is
 * nested under its course and re-verifies the course belongs to the current academy (RLS is the
 * backstop). `course.manage` gates all of it — sections are pure authoring structure.
 */
final class SectionController extends Controller
{
    use InteractsWithLms;

    /** POST /api/courses/{course}/sections — append a section. */
    public function store(Request $request, string $courseId): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $this->findCourse($courseId);

        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
        ]);

        $sectionId = (string) Str::uuid();
        DB::table('course_sections')->insert([
            'id' => $sectionId,
            'academy_id' => $academyId,
            'course_id' => $courseId,
            'title' => trim($data['title']),
            'position' => $this->nextPosition($courseId),
        ]);

        Audit::log('course_section.create', 'course_section', $sectionId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['course_id' => $courseId, 'title' => $data['title']]);

        return response()->json(['sectionId' => $sectionId], 201);
    }

    /** PATCH /api/courses/{course}/sections/{id} — rename a section. */
    public function update(Request $request, string $courseId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $section = $this->findSection($courseId, $id);

        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
        ]);

        DB::table('course_sections')->where('id', $id)->update([
            'title' => trim($data['title']),
            'updated_at' => now(),
        ]);

        Audit::log('course_section.update', 'course_section', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['title' => $data['title']], before: ['title' => $section->title]);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/courses/{course}/sections/{id} — remove a section (its lessons cascade away). */
    public function destroy(string $courseId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $section = $this->findSection($courseId, $id);

        DB::table('course_sections')->where('id', $id)->delete();

        Audit::log('course_section.delete', 'course_section', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['title' => $section->title]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/courses/{course}/sections/reorder — persist a new section order. */
    public function reorder(Request $request, string $courseId): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $this->findCourse($courseId);

        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['uuid'],
        ]);

        $valid = DB::table('course_sections')->where('course_id', $courseId)->pluck('id')->map('strval')->all();
        foreach ($data['ids'] as $position => $id) {
            if (! in_array((string) $id, $valid, true)) {
                continue; // ignore ids that aren't this course's sections
            }
            DB::table('course_sections')->where('id', $id)->update(['position' => $position, 'updated_at' => now()]);
        }

        Audit::log('course_section.reorder', 'course', $courseId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['order' => $data['ids']]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function findSection(string $courseId, string $id): object
    {
        $this->findCourse($courseId);
        $section = DB::table('course_sections')->where('id', $id)->where('course_id', $courseId)->first();
        if ($section === null) {
            abort(404, 'Section not found.');
        }

        return $section;
    }

    private function nextPosition(string $courseId): int
    {
        return (int) DB::table('course_sections')->where('course_id', $courseId)->max('position') + 1;
    }
}
