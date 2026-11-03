<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use App\Services\GroupPayroll;
use App\Services\Payroll;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * POST /api/group-lessons/{id}/substitute — a colleague covers ONE group lesson (docs/centre-profile,
 * Phase 2 §3). Body `{teacher_id}`: any active teacher of the academy; null or omitted puts the
 * group's own teacher back.
 *
 * The lesson's `teacher_id` was always the snapshot a substitute could stand in; this sets it, and
 * `original_teacher_id` remembers who was replaced — the marker the generator respects, so a nightly
 * roll never hands the lesson back to the group's teacher, and what the board reads as "بديل".
 *
 * MONEY: the payout line of a held group lesson sits on the LESSON's teacher
 * ({@see GroupPayroll::syncLessonPay()}), so a substitute set before the sheet is saved is simply
 * who gets paid. Set after the lesson is HELD, the same sync moves the line to the substitute's
 * statement for that month; a sealed statement is corrected in place ({@see Payroll::correcting()}).
 * The one refusal: a statement already PAID OUT from the treasury is never rewritten, so once the
 * lesson's line is on one, the teacher can no longer change (422 — void that payment first). A
 * cancelled lesson has nobody to cover: 422.
 */
final class SubstituteController extends Controller
{
    use InteractsWithClassGroups;

    public function __construct(
        private readonly GroupPayroll $payroll,
        private readonly Payroll $statements,
    ) {}

    public function set(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $lesson = $this->findLesson($id);
        $data = $request->validate(['teacher_id' => ['sometimes', 'nullable', 'uuid']]);

        if ($lesson->status === 'CANCELLED') {
            throw ValidationException::withMessages([
                'status' => ['A cancelled lesson has no teacher to replace. / الحصة ملغاة، لا يوجد مدرس لاستبداله.'],
            ]);
        }

        $group = DB::table('class_groups')->where('id', $lesson->group_id)->first(['id', 'academy_id', 'teacher_id']);
        $target = isset($data['teacher_id']) && $data['teacher_id'] !== null ? (string) $data['teacher_id'] : (string) $group->teacher_id;
        $this->assertActiveTeacher($target);

        // Money already out of the building stays where it is: the lesson's line on a statement paid
        // from the treasury pins the teacher.
        $line = DB::table('payout_line_items')->where('class_group_lesson_id', $lesson->id)->first(['payout_id']);
        if ($line !== null && $this->statements->carriesCorrections((string) $line->payout_id)) {
            throw ValidationException::withMessages([
                'teacher_id' => ['This lesson\'s pay was already paid out from the treasury; the teacher can no longer change. / أجر هذه الحصة مصروف من الخزنة بالفعل، لا يمكن تغيير المدرس.'],
            ]);
        }

        $isSubstitute = $target !== (string) $group->teacher_id;
        $original = $isSubstitute ? (string) ($lesson->original_teacher_id ?? $lesson->teacher_id) : null;

        DB::transaction(function () use ($lesson, $target, $original): void {
            DB::table('class_group_lessons')->where('id', $lesson->id)->update([
                'teacher_id' => $target,
                'original_teacher_id' => $original,
                'updated_at' => now(),
            ]);

            // A held lesson's line follows its teacher (and is refused, rolling this back, only where
            // the statement was paid out — checked above, re-checked by Payroll itself).
            if ($lesson->status === 'HELD') {
                $this->payroll->syncLessonPay(DB::table('class_group_lessons')->where('id', $lesson->id)->first());
            }
        });

        Audit::log('class_group_lesson.substituted', 'class_group_lesson', (string) $lesson->id, (string) $lesson->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['teacher_id' => $target, 'original_teacher_id' => $original, 'status' => (string) $lesson->status],
            before: ['teacher_id' => (string) $lesson->teacher_id, 'original_teacher_id' => $lesson->original_teacher_id]);

        $fresh = DB::table('class_group_lessons as l')
            ->leftJoin('teachers as te', 'te.id', '=', 'l.teacher_id')
            ->where('l.id', $id)
            ->first(['l.*', 'te.full_name as teacher_name']);

        return response()->json(['lesson' => $this->presentLesson($fresh, $this->lessonCounts([$id])[$id] ?? null)]);
    }
}
