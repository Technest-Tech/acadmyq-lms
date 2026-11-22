<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use App\Services\CourseGraduation;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * The end of a course for its course-only students ({@see CourseGraduation}). Behind
 * `entitled:course_students` + `entitled:groups`, so every academy without the switch gets 402 and
 * nothing else changes for it. Reading the list needs `group.manage`; moving the students needs
 * `student.deactivate` too, the right the single-student button asks for.
 */
final class CourseStudentsController extends Controller
{
    use InteractsWithClassGroups;

    public function __construct(private readonly CourseGraduation $graduation) {}

    /** GET /api/groups/{id}/former-students — who would become a former student, who stays and why. */
    public function preview(string $id): JsonResponse
    {
        Gate::authorize('group.manage');
        $group = $this->findGroup($id);

        return response()->json([
            'course_over' => CourseGraduation::courseOver($group),
            'students' => $this->graduation->preview($group),
        ]);
    }

    /** POST /api/groups/{id}/former-students — do it. Only once the course is over. */
    public function apply(string $id): JsonResponse
    {
        Gate::authorize('group.manage');
        Gate::authorize('student.deactivate');
        $group = $this->findGroup($id);

        if (! CourseGraduation::courseOver($group)) {
            throw ValidationException::withMessages([
                'group' => ['The course is still running: archive it, or wait for its end date. / الكورس لسه شغال: أرشفه أو استنى تاريخ نهايته.'],
            ]);
        }

        $result = $this->graduation->apply($group, $this->ctx()->userId, $this->ctx()->role);

        return response()->json($result + ['students' => $this->graduation->preview($group)]);
    }
}
