<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\MarksOwnGroup;
use App\Services\GroupAssessments;
use App\Services\GuardianPortalCentre;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A student's term report in a group (docs/centre-profile, Phase 2 §5) — `/api/groups/{id}/reports`
 * and `/api/groups/{id}/students/{studentId}/report`, behind `entitled:centre` + `entitled:groups`.
 *
 * The report is composed on read ({@see GroupAssessments::report}): attendance from the sheets,
 * grades from the scores, the weighted total. What is written here is the teacher's comment and the
 * overall grade — by whoever may grade the group ({@see MarksOwnGroup}) — and the publish switch,
 * which is the office's alone (`group.manage`): a teacher writes, the academy decides what the
 * parent reads. Published reports reach the parent's page through {@see GuardianPortalCentre}.
 */
final class GroupTermReportController extends Controller
{
    use MarksOwnGroup;

    public function __construct(private readonly GroupAssessments $assessments) {}

    /** GET /api/groups/{id}/reports — one row per student on the sheet. */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);

        return response()->json([
            'reports' => $this->assessments->reportRows($group),
            'can_mark' => $this->canMark($group),
            'can_publish' => Gate::allows('group.manage'),
        ]);
    }

    /** GET /api/groups/{id}/students/{studentId}/report */
    public function show(string $id, string $studentId): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);

        return response()->json($this->payload($group, $studentId));
    }

    /** PUT /api/groups/{id}/students/{studentId}/report — the comment and the overall grade. */
    public function update(Request $request, string $id, string $studentId): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);
        $this->authorizeMarking($group);

        $data = $request->validate([
            'comment' => ['present', 'nullable', 'string', 'max:4000'],
            'overall_grade' => ['sometimes', 'nullable', 'string', 'max:40'],
        ]);

        $this->assessments->saveReport($group, $studentId, $data['comment'], $data['overall_grade'] ?? null, $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->payload($group, $studentId));
    }

    /** POST /api/groups/{id}/students/{studentId}/report/publish */
    public function publish(string $id, string $studentId): JsonResponse
    {
        return $this->setPublished($id, $studentId, true);
    }

    /** POST /api/groups/{id}/students/{studentId}/report/unpublish */
    public function unpublish(string $id, string $studentId): JsonResponse
    {
        return $this->setPublished($id, $studentId, false);
    }

    /** POST /api/groups/{id}/reports/publish-all — every report not yet out. */
    public function publishAll(string $id): JsonResponse
    {
        Gate::authorize('group.manage');
        $group = $this->findGroup($id);

        $count = $this->assessments->publishAll($group, $this->ctx()->userId, $this->ctx()->role);

        return response()->json([
            'published' => $count,
            'reports' => $this->assessments->reportRows($group),
            'can_mark' => true,
            'can_publish' => true,
        ]);
    }

    private function setPublished(string $id, string $studentId, bool $published): JsonResponse
    {
        Gate::authorize('group.manage');
        $group = $this->findGroup($id);

        $this->assessments->setPublished($group, $studentId, $published, $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->payload($group, $studentId));
    }

    /** @return array<string, mixed> */
    private function payload(object $group, string $studentId): array
    {
        $report = $this->assessments->report($group, $studentId);
        if ($report === null) {
            abort(404, 'Student is not on this group\'s sheet.');
        }

        // The academy's own brand on the printed page, the way the parent's page shows it.
        $academy = DB::table('academies')->where('id', $group->academy_id)->first(['name', 'brand_display_name', 'brand_logo_url']);

        return [
            'report' => $report,
            'academy' => [
                'name' => trim((string) ($academy?->brand_display_name ?? '')) ?: (string) ($academy?->name ?? ''),
                'logo_url' => trim((string) ($academy?->brand_logo_url ?? '')) ?: null,
            ],
            'can_mark' => $this->canMark($group),
            'can_publish' => Gate::allows('group.manage'),
        ];
    }
}
