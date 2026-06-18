<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Internal performance reports written ABOUT a teacher by the academy owner/support — an incident
 * (the teacher did something wrong), a note, or praise. Tenant-scoped by RLS; gated on
 * `teacher_report.manage` (owner/super-admin by default, grantable to any support role purely as a
 * data change). Not visible to the teacher. Distinct from the per-session lesson reports.
 */
final class TeacherReportController extends Controller
{
    private const KINDS = ['NOTE', 'INCIDENT', 'PRAISE'];

    /** GET /api/teachers/{id}/reports — list reports about a teacher, newest first. */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('teacher_report.manage');

        $this->assertTeacherExists($id);

        $reports = DB::table('teacher_reports')
            ->where('teacher_id', $id)
            ->orderByDesc('created_at')
            ->get(['id', 'kind', 'body', 'author_user_id', 'author_name', 'created_at']);

        return response()->json(['reports' => $reports]);
    }

    /** POST /api/teachers/{id}/reports — write a report about a teacher. */
    public function store(Request $request, string $id): JsonResponse
    {
        Gate::authorize('teacher_report.manage');

        $this->assertTeacherExists($id);

        $data = $request->validate([
            'kind' => ['sometimes', Rule::in(self::KINDS)],
            'body' => ['required', 'string', 'max:5000'],
        ]);

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $reportId = (string) Str::uuid();
        $authorName = $ctx->userId !== null
            ? DB::table('users')->where('id', $ctx->userId)->value('full_name')
            : null;

        DB::table('teacher_reports')->insert([
            'id' => $reportId,
            'academy_id' => $academyId,
            'teacher_id' => $id,
            'author_user_id' => $ctx->userId,
            'author_name' => $authorName,
            'kind' => $data['kind'] ?? 'NOTE',
            'body' => $data['body'],
        ]);

        Audit::log('teacher_report.manage', 'teacher_report', $reportId, $academyId, $ctx->userId, $ctx->role, after: [
            'teacher_id' => $id,
            'kind' => $data['kind'] ?? 'NOTE',
        ]);

        return response()->json(['reportId' => $reportId], 201);
    }

    /** DELETE /api/teachers/{id}/reports/{reportId} — remove a report. */
    public function destroy(string $id, string $reportId): JsonResponse
    {
        Gate::authorize('teacher_report.manage');

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $existing = DB::table('teacher_reports')
            ->where('id', $reportId)
            ->where('teacher_id', $id)
            ->first();
        if ($existing === null) {
            abort(404, 'Report not found.');
        }

        DB::table('teacher_reports')->where('id', $reportId)->delete();

        Audit::log('teacher_report.manage', 'teacher_report', $reportId, $academyId, $ctx->userId, $ctx->role, before: [
            'teacher_id' => $id,
            'kind' => $existing->kind,
        ]);

        return response()->json(['ok' => true]);
    }

    private function assertTeacherExists(string $id): void
    {
        if (! DB::table('teachers')->where('id', $id)->exists()) {
            abort(404, 'Teacher not found.');
        }
    }

    private function academyId(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its teacher reports.');
        }

        return $ctx->academyId;
    }
}
