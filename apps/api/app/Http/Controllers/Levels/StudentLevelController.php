<?php

declare(strict_types=1);

namespace App\Http\Controllers\Levels;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Services\StudentLevels;
use App\Support\Entitlement;
use App\Support\TeacherStudents;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A student's level (docs/centre-profile, Phase 2.1): the promotion that moves them up a level —
 * and, when asked, into a group of it — and the history of every such move. Behind
 * `entitled:centre`. Promoting changes the student (`student.update`) and may move a membership
 * (`group.manage`), so it needs both; reading the history is reading the student.
 */
final class StudentLevelController extends Controller
{
    use InteractsWithPeople;

    public function __construct(private readonly StudentLevels $levels) {}

    /**
     * POST /api/students/{id}/promote — `to_level_id` (required), `to_group_id` (optional, an
     * unarchived group), `effective_on` (default today), `note`. Moving into a group is a group
     * feature, so it also needs the `groups` switch — a centre without it still promotes by level.
     */
    public function promote(Request $request, string $id): JsonResponse
    {
        Gate::authorize('student.update');
        Gate::authorize('group.manage');

        $student = DB::table('students')->where('id', $id)->whereNull('deleted_at')->first();
        if ($student === null) {
            abort(404, 'Student not found.');
        }

        $data = $request->validate([
            'to_level_id' => ['required', 'uuid'],
            'to_group_id' => ['sometimes', 'nullable', 'uuid'],
            'effective_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
            'allow_over_capacity' => ['sometimes', 'boolean'],
        ]);

        if (! empty($data['to_group_id']) && ! Entitlement::check($this->ctx(), 'groups')) {
            return response()->json([
                'error' => 'upgrade_required',
                'message' => 'Group classes are not included in your current plan.',
                'feature' => 'groups',
            ], 402);
        }

        $result = $this->levels->promote($student, $data, $this->ctx()->userId, $this->ctx()->role);

        return response()->json([
            'ok' => true,
            'promotion' => $result + [
                'to_level_name' => $this->levels->nameOf($result['to_level_id']),
            ],
            'history' => $this->levels->history($id),
        ]);
    }

    /** GET /api/students/{id}/level-history — newest first, with the level and group names. */
    public function history(string $id): JsonResponse
    {
        Gate::authorize('student.read');

        $student = DB::table('students')->where('id', $id)->first();
        if ($student === null) {
            abort(404, 'Student not found.');
        }
        $this->assertTeacherMayRead($id);

        return response()->json([
            'level_id' => $student->level_id !== null ? (string) $student->level_id : null,
            'level_name' => $this->levels->nameOf($student->level_id !== null ? (string) $student->level_id : null),
            'history' => $this->levels->history($id),
        ]);
    }

    /** A teacher reads only the students they teach — the same rule as the student page. */
    private function assertTeacherMayRead(string $studentId): void
    {
        $ctx = $this->ctx();
        if ($ctx->role !== 'TEACHER') {
            return;
        }
        $teacherId = DB::table('teachers')->where('user_id', $ctx->userId)->value('id');
        if (! TeacherStudents::teaches($teacherId !== null ? (string) $teacherId : null, $studentId, (string) $ctx->academyId)) {
            abort(403, 'You may only view your own students.');
        }
    }
}
