<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\MarksOwnGroup;
use App\Services\GroupAssessments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * A group's grade sheet (docs/centre-profile, Phase 2 §5) — `/api/groups/{id}/assessments`,
 * `/grades` and `/assessments/{aid}/scores`, behind `entitled:centre` + `entitled:groups`.
 *
 * Reading is `group.read` (a TEACHER sees their own groups' sheets). Writing a column or a cell is
 * {@see MarksOwnGroup::authorizeMarking}: running groups, or being this group's teacher. Every
 * number lives in {@see GroupAssessments}; this controller validates and answers.
 */
final class GroupAssessmentController extends Controller
{
    use MarksOwnGroup;

    public function __construct(private readonly GroupAssessments $assessments) {}

    /** GET /api/groups/{id}/assessments — the columns, each with how many cells are graded. */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);

        return response()->json([
            'assessments' => $this->assessments->assessments((string) $group->id),
            'can_mark' => $this->canMark($group),
            'can_publish' => Gate::allows('group.manage'),
        ]);
    }

    /** POST /api/groups/{id}/assessments */
    public function store(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);
        $this->authorizeMarking($group);

        $data = $request->validate($this->rules(creating: true));

        return response()->json([
            'assessment' => $this->assessments->create($group, $data, $this->ctx()->userId, $this->ctx()->role),
        ], 201);
    }

    /** PATCH /api/groups/{id}/assessments/{aid} */
    public function update(Request $request, string $id, string $aid): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);
        $this->authorizeMarking($group);
        $assessment = $this->assessments->findAssessment((string) $group->id, $aid);

        $data = $request->validate($this->rules(creating: false));

        return response()->json([
            'assessment' => $this->assessments->update($group, $assessment, $data, $this->ctx()->userId, $this->ctx()->role),
        ]);
    }

    /** DELETE /api/groups/{id}/assessments/{aid}?force=1 — refused with scores on it unless forced. */
    public function destroy(Request $request, string $id, string $aid): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);
        $this->authorizeMarking($group);
        $assessment = $this->assessments->findAssessment((string) $group->id, $aid);

        $this->assessments->delete($group, $assessment, $request->boolean('force'), $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['ok' => true]);
    }

    /** GET /api/groups/{id}/grades — the whole sheet: members × assessments, with totals. */
    public function sheet(string $id): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);

        return response()->json($this->assessments->sheet($group) + [
            'can_mark' => $this->canMark($group),
            'can_publish' => Gate::allows('group.manage'),
        ]);
    }

    /** PUT /api/groups/{id}/assessments/{aid}/scores — one column's cells, all or nothing. */
    public function scores(Request $request, string $id, string $aid): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);
        $this->authorizeMarking($group);
        $assessment = $this->assessments->findAssessment((string) $group->id, $aid);

        $data = $request->validate([
            'scores' => ['required', 'array', 'max:500'],
            'scores.*.student_id' => ['required', 'uuid'],
            'scores.*.score' => ['nullable', 'numeric', 'min:0'],
            'scores.*.absent' => ['sometimes', 'boolean'],
            'scores.*.note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $this->assessments->saveScores($group, $assessment, $data['scores'], $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->assessments->sheet($group) + [
            'can_mark' => true,
            'can_publish' => Gate::allows('group.manage'),
        ]);
    }

    /** @return array<string, list<mixed>> */
    private function rules(bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return [
            'title' => [$req, 'string', 'max:120'],
            'kind' => ['sometimes', Rule::in(GroupAssessments::KINDS)],
            'held_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'max_score' => [$req, 'numeric', 'gt:0', 'max:99999'],
            'weight' => ['sometimes', 'numeric', 'min:0', 'max:999'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ];
    }
}
