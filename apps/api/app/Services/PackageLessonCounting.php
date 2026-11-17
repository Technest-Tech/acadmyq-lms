<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\SessionStatus;
use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Whether a cancelled lesson counts — on the student's package, and on the teacher's salary
 * (Ahmed 2026-11-17: "a package has cancelled lessons; I want to set each one counted or not, and
 * the system works the packages out again, and the salaries too").
 *
 * The student's side:
 *   • not counted → counts: the lesson is recorded as charged through {@see AttendanceService}, so
 *     it comes off the student's OPEN block exactly as a charged cancellation always has — and if
 *     that empties the block, the block finishes and renews.
 *   • counts → not counted, its block still open (or finished with its bill still open): the
 *     lesson is released through the same path, which gives the minutes back and, on a block that
 *     only ended because of it, re-opens it and undoes a renewal nobody used.
 *   • counts → not counted on a block that finished and was billed: the books are put back as if
 *     the lesson had never counted ({@see LessonPackages::finishedBlockPlan()}) — the next block's
 *     lessons come back in date order until the old one is full again, or the old one re-opens and
 *     an untouched automatic renewal is undone. Where that cannot follow (a next block opened by
 *     hand or already paid, a block closed by hand), the old block keeps a free lesson and asks
 *     what happens to it, as closing early does.
 *
 * The teacher's side: none, a quarter, a half or the whole lesson. The salary line follows on the
 * lesson's own month's statement — corrected in place even once sealed ({@see Payroll::correcting()});
 * only a statement already paid out of the treasury stays as it is, and then the teacher's side
 * is left alone and said so.
 */
final class PackageLessonCounting
{
    /** The outcomes this applies to: the lesson did not happen as a lesson. */
    public const STATUSES = ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_TEACHER', 'ABSENT_EXCUSED', 'ABSENT_UNEXCUSED'];

    /** What the teacher may be paid of it: nothing, a quarter, a half, the whole lesson. */
    public const TEACHER_PERCENTS = [0, 25, 50, 100];

    public function __construct(
        private readonly AttendanceService $attendance,
        private readonly Payroll $payroll,
        private readonly LessonPackages $packages,
    ) {}

    /**
     * What setting this would do, without doing it. `$teacherPercent` null = leave the teacher as is.
     *
     * @return array<string,mixed>
     */
    public function preview(object $session, bool $counts, ?int $teacherPercent): array
    {
        $calc = $this->calculate($session, $counts, $teacherPercent);
        unset($calc['plan'], $calc['statement_id']);

        return $calc;
    }

    /**
     * Set it: the package (and the blocks around it) and the salary move together, or nothing does.
     *
     * @return array<string,mixed> what was done, in the preview's shape
     */
    public function apply(string $sessionId, bool $counts, ?int $teacherPercent, string $actorUserId, string $actorRole): array
    {
        return DB::transaction(function () use ($sessionId, $counts, $teacherPercent, $actorUserId, $actorRole): array {
            $session = DB::table('sessions')->where('id', $sessionId)->lockForUpdate()->first();
            if ($session === null) {
                abort(404, 'Lesson not found.');
            }

            $calc = $this->calculate($session, $counts, $teacherPercent);
            if ($calc['blocker'] !== null) {
                throw ValidationException::withMessages(['session' => [$this->blockedMessage((string) $calc['blocker'])]]);
            }

            $after = (int) $calc['teacher']['percent_after'];
            $teacherOverride = $after > 0;
            $shareBp = $after > 0 && $after < 100 ? $after * 100 : null;

            return $this->payroll->correcting($calc['statement_id'], function () use ($session, $counts, $calc, $teacherOverride, $shareBp, $actorUserId, $actorRole): array {
                if ($calc['student']['mode'] === 'FINISHED_PLAN') {
                    $this->uncountOnFinishedBlock($session, $calc['plan'], $actorUserId, $actorRole);
                }

                $this->attendance->record(
                    $session,
                    SessionStatus::from((string) $session->status),
                    $session->status_reason,
                    $actorUserId,
                    $actorRole,
                    $counts,
                    $teacherOverride,
                    $shareBp,
                );

                Audit::log('session.counting_changed', 'session', (string) $session->id, (string) $session->academy_id, $actorUserId, $actorRole,
                    after: ['counts' => $counts, 'teacher_pay_percent' => $calc['teacher']['percent_after'], 'mode' => $calc['student']['mode']],
                    before: ['counts' => $calc['student']['counts_before'], 'teacher_pay_percent' => $calc['teacher']['percent_before']]);

                $result = $calc;
                unset($result['plan'], $result['statement_id']);

                return $result;
            });
        });
    }

    /**
     * @return array{blocker:?string, student:array<string,mixed>, teacher:array<string,mixed>, plan:?array<string,mixed>, statement_id:?string}
     */
    private function calculate(object $session, bool $counts, ?int $teacherPercent): array
    {
        $blocker = in_array((string) $session->status, self::STATUSES, true) ? null : 'NOT_CANCELLED';
        $countsBefore = (bool) $session->billed;

        $student = [
            'counts_before' => $countsBefore,
            'counts_after' => $counts,
            // ADD (comes off the open block) · RELEASE (back to its block) · FINISHED_PLAN · UNBILL (a monthly bill line) · null (no change)
            'mode' => null,
            'package' => null,
            'will_complete' => false,
            'reopens' => false,
            'renewal_undone' => false,
            'lessons_moved_back' => null,
            'stays_closed' => null,
        ];
        $plan = null;

        if ($blocker === null && $counts !== $countsBefore) {
            $credit = DB::table('lesson_package_credits')->where('session_id', $session->id)->first();

            if ($counts) {
                $student['mode'] = 'ADD';
                $target = $this->packages->forLesson($session);
                if ($target !== null) {
                    $capacity = (int) $target->minutes_total + (int) $target->carried_over_minutes;
                    $left = $capacity - (int) $target->minutes_consumed;
                    $take = LessonPackages::countsLessons($target) ? (int) $target->lesson_minutes : max(1, (int) $session->duration_minutes);
                    $student['package'] = $this->blockSummary($target);
                    $student['will_complete'] = $left <= $take;
                }
            } elseif ($credit !== null) {
                $block = DB::table('lesson_packages')->where('id', $credit->package_id)->first();
                $student['package'] = $this->blockSummary($block);

                if ((string) $block->status === 'ACTIVE' || ! $this->packages->releaseRefused((string) $session->id)) {
                    $student['mode'] = 'RELEASE';
                } else {
                    $student['mode'] = 'FINISHED_PLAN';
                    $capacity = (int) $block->minutes_total + (int) $block->carried_over_minutes;
                    $consumedAfter = max(0, (int) $block->minutes_consumed - (int) $credit->minutes);
                    $plan = $this->packages->finishedBlockPlan($block, $consumedAfter, max(0, $consumedAfter - $capacity), wholeLessons: true);
                    if ($plan['blocker'] !== null) {
                        $blocker = (string) $plan['blocker'];
                    }
                    $student['reopens'] = (bool) $plan['reopens'];
                    $student['renewal_undone'] = $plan['renewal'] !== null;
                    $student['stays_closed'] = $plan['stays_closed'];
                    $student['lessons_moved_back'] = $plan['moved_from'] !== null
                        ? ['sequence_no' => (int) $plan['moved_from']->sequence_no, 'lessons' => count($plan['moves'])]
                        : null;
                }
            } else {
                $student['mode'] = 'UNBILL';
            }
        }

        // The teacher: what they are paid of it now, and after.
        $line = DB::table('payout_line_items as li')
            ->join('payouts as p', 'p.id', '=', 'li.payout_id')
            ->where('li.session_id', $session->id)
            ->first(['li.payout_id', 'li.amount_minor', 'li.currency', 'p.finalized_at', 'p.period_year', 'p.period_month']);
        $percentBefore = (bool) $session->paid_to_teacher
            ? ($session->teacher_pay_share_bp !== null ? intdiv((int) $session->teacher_pay_share_bp, 100) : 100)
            : 0;
        $percentAfter = $teacherPercent ?? $percentBefore;
        $statementId = $line !== null ? (string) $line->payout_id : $this->ownStatement($session);
        $statement = $statementId !== null ? DB::table('payouts')->where('id', $statementId)->first(['period_year', 'period_month', 'finalized_at']) : null;
        // A statement already paid from the treasury keeps its figures: the teacher's side stays.
        $locked = $percentAfter !== $percentBefore && $statementId !== null && $this->payroll->carriesCorrections($statementId);

        return [
            'blocker' => $blocker,
            'student' => $student,
            'teacher' => [
                'percent_before' => $percentBefore,
                'percent_after' => $locked ? $percentBefore : $percentAfter,
                'amount_before' => $line !== null ? (int) $line->amount_minor : 0,
                'currency' => $line?->currency !== null ? trim((string) $line->currency) : null,
                'statement' => $statement !== null ? [
                    'year' => (int) $statement->period_year,
                    'month' => (int) $statement->period_month,
                    'sealed' => $statement->finalized_at !== null,
                ] : null,
                'locked' => $locked,
            ],
            'plan' => $plan,
            'statement_id' => $statementId,
        ];
    }

    /**
     * Take the lesson off a finished, billed block and put the books back as if it never counted —
     * the plan worked out above. The session's own flags are then written by the recording.
     *
     * @param  array<string,mixed>  $plan
     */
    private function uncountOnFinishedBlock(object $session, array $plan, string $actorUserId, string $actorRole): void
    {
        $credit = DB::table('lesson_package_credits')->where('session_id', $session->id)->first();
        if ($credit === null) {
            return;
        }
        // Read before the minutes move: the plan compares against the block as it stood.
        $block = DB::table('lesson_packages')->where('id', $credit->package_id)->first();

        DB::table('lesson_package_credits')->where('id', $credit->id)->delete();
        DB::table('lesson_packages')->where('id', $block->id)->update([
            'minutes_consumed' => (int) $plan['consumed_after'],
            'minutes_overdrawn' => (int) $plan['overdrawn_after'],
            'updated_at' => now(),
        ]);
        $this->packages->applyFinishedBlockPlan($block, $plan, $actorUserId, $actorRole);

        Audit::log('lesson_package.lesson_uncounted', 'lesson_package', (string) $block->id, (string) $block->academy_id, $actorUserId, $actorRole,
            after: ['session_id' => (string) $session->id, 'minutes' => (int) $credit->minutes, 'consumed_after' => (int) $plan['consumed_after'], 'reopens' => (bool) $plan['reopens']],
            before: ['minutes_consumed' => (int) $block->minutes_consumed, 'status' => (string) $block->status]);
    }

    /** @return array{id:string, sequence_no:int, status:string, label:string} */
    private function blockSummary(object $block): array
    {
        return [
            'id' => (string) $block->id,
            'sequence_no' => (int) $block->sequence_no,
            'status' => (string) $block->status,
            'label' => (string) $block->label,
        ];
    }

    /** The teacher's statement for the lesson's own month on the academy's calendar, if it exists. */
    private function ownStatement(object $session): ?string
    {
        $timezone = (string) (DB::table('academies')->where('id', $session->academy_id)->value('timezone') ?: 'UTC');
        $local = Carbon::parse($session->scheduled_at_utc)->setTimezone($timezone);
        $id = DB::table('payouts')
            ->where('teacher_id', $session->teacher_id)
            ->where('period_year', $local->year)
            ->where('period_month', $local->month)
            ->value('id');

        return $id !== null ? (string) $id : null;
    }

    private function blockedMessage(string $blocker): string
    {
        return match ($blocker) {
            'NOT_CANCELLED' => 'Only a cancelled or missed lesson can be set to count or not. / يمكن تعديل احتساب الحصص الملغاة أو الغياب فقط.',
            'PACKAGE_CLOSED' => 'This lesson\'s package was closed by hand and settled, so it cannot change any more. / باقة هذه الحصة أُغلقت يدويًا وتمت تسويتها، فلا يمكن تعديلها.',
            'PACKAGE_OVERDRAFT_SETTLED' => 'The extra minutes of this lesson\'s package were already billed, so it cannot change. / الدقائق الزائدة في باقة هذه الحصة تمت فوترتها بالفعل، فلا يمكن تعديلها.',
            default => 'This change cannot be made. / لا يمكن إجراء هذا التعديل.',
        };
    }
}
