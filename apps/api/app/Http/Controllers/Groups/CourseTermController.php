<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use App\Services\CourseTerm;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * The end of a course term (docs/centre-profile, Phase 2 §2): renew it, promote its students, or
 * close it. Behind `entitled:centre` + `entitled:groups`; `group.manage` throughout, and a
 * promotion changes the students too (`student.update`), exactly as the single-student one does.
 * The group payloads these return are the same shape as GET /groups/{id}.
 */
final class CourseTermController extends Controller
{
    use InteractsWithClassGroups;

    public function __construct(private readonly CourseTerm $terms) {}

    /**
     * POST /api/groups/{id}/renew — a new term from `start_date` (`end_date`, `lessons_planned`,
     * `price_minor`, `name` optional), with every member (`keep_members`) or the `member_ids` given.
     * Answers with the successor; the old group is archived RENEWED.
     */
    public function renew(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $data = $request->validate([
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'lessons_planned' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000000000'],
            'name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'keep_members' => ['sometimes', 'boolean'],
            'member_ids' => ['sometimes', 'array', 'max:500'],
            'member_ids.*' => ['uuid'],
        ]);
        if (array_key_exists('price_minor', $data)) {
            Gate::authorize('student.set_price');
        }

        $newId = $this->terms->renew($group, $data, $this->ctx()->userId, $this->ctx()->role);

        return response()->json([
            'group' => app(ClassGroupController::class)->payload($newId),
            'previous_group_id' => $id,
        ], 201);
    }

    /**
     * POST /api/groups/{id}/promote — `member_ids` (who passed) move to `to_level_id` (default: the
     * next level) in a new term from `start_date`; the rest leave and keep their level, and are
     * returned as `not_promoted` so the page can say so.
     */
    public function promote(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');
        Gate::authorize('student.update');

        $group = $this->findGroup($id);
        $data = $request->validate([
            'to_level_id' => ['sometimes', 'nullable', 'uuid'],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'lessons_planned' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000000000'],
            'name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'member_ids' => ['present', 'array', 'max:500'],
            'member_ids.*' => ['uuid'],
        ]);
        if (array_key_exists('price_minor', $data)) {
            Gate::authorize('student.set_price');
        }

        $result = $this->terms->promote($group, $data, $this->ctx()->userId, $this->ctx()->role);

        return response()->json([
            'group' => app(ClassGroupController::class)->payload($result['group_id']),
            'previous_group_id' => $id,
            'to_level_id' => $result['to_level_id'],
            'promoted' => $result['promoted'],
            'not_promoted' => $result['not_promoted'],
        ], 201);
    }

    /** POST /api/groups/{id}/close — the course ended for good (`reason` optional, kept in the audit trail). */
    public function close(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $data = $request->validate(['reason' => ['sometimes', 'nullable', 'string', 'max:500']]);

        $this->terms->close($group, $data['reason'] ?? null, $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['group' => app(ClassGroupController::class)->payload($id)]);
    }
}
