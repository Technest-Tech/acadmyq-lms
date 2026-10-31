<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Reports\LessonReportMessage;
use App\Services\Reports\LessonReportPresets;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\ReportFields;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Settings → Lesson report (the `lesson_report` capability): the academy's form and its message.
 *
 * The form IS the academy's report fields (edited through ReportFieldController — this adds their
 * section and "out of" max); this controller owns the message those values are poured into, its
 * live preview, and the ready-made presets. Everything is `report_field.manage` — the people who
 * already shape what a session report asks for.
 */
final class LessonReportController extends Controller
{
    /** GET /api/lesson-report — every field (inactive too, to bring back), the message, the presets. */
    public function show(): JsonResponse
    {
        Gate::authorize('report_field.manage');
        $academyId = $this->academyId();

        return response()->json([
            'fields' => ReportFields::map(DB::table('report_field_definitions')->where('academy_id', $academyId)->orderBy('sort_order')->get()),
            'message' => (string) (DB::table('lesson_report_templates')->where('academy_id', $academyId)->value('message') ?? ''),
            'facts' => LessonReportMessage::FACTS,
            'presets' => LessonReportPresets::catalog(),
        ]);
    }

    /** PUT /api/lesson-report/message — save the academy's message. */
    public function updateMessage(Request $request): JsonResponse
    {
        Gate::authorize('report_field.manage');
        $data = $request->validate(['message' => ['present', 'nullable', 'string', 'max:5000']]);
        $academyId = $this->academyId();
        $ctx = app(AuthContext::class);

        $before = DB::table('lesson_report_templates')->where('academy_id', $academyId)->value('message');
        LessonReportPresets::saveMessage($academyId, (string) ($data['message'] ?? ''));

        Audit::log('lesson_report.message_saved', 'academy', $academyId, $academyId, $ctx->userId, $ctx->role,
            after: ['message' => $data['message'] ?? ''], before: $before !== null ? ['message' => $before] : null);

        return response()->json(['ok' => true]);
    }

    /** POST /api/lesson-report/preview — the message as a parent would read it, with stand-in values. */
    public function preview(Request $request, LessonReportMessage $renderer): JsonResponse
    {
        Gate::authorize('report_field.manage');
        $data = $request->validate(['message' => ['present', 'nullable', 'string', 'max:5000']]);
        $academyId = $this->academyId();
        $message = (string) ($data['message'] ?? '');

        $fields = ReportFields::active($academyId);
        $academyName = trim((string) DB::table('academies')->where('id', $academyId)->value('name'));

        return response()->json([
            'text' => $renderer->render($message, LessonReportMessage::sampleFacts($academyName, $message), $fields, LessonReportMessage::sampleValues($fields)),
        ]);
    }

    /** POST /api/lesson-report/presets/{preset} — replace the form and message with a ready-made one. */
    public function applyPreset(LessonReportPresets $presets, string $preset): JsonResponse
    {
        Gate::authorize('report_field.manage');
        $ctx = app(AuthContext::class);

        $presets->apply($this->academyId(), $preset, $ctx->userId, $ctx->role);

        return $this->show();
    }

    private function academyId(): string
    {
        $academyId = app(AuthContext::class)->academyId;
        if ($academyId === null) {
            abort(403, 'Enter an academy to manage its lesson report.');
        }

        return $academyId;
    }
}
