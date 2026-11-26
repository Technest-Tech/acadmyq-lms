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
 * The same, for any lesson in a package's log (Ahmed 2026-11-26: "edit and delete the lessons inside
 * every package, even the old ones — and every package moves, the due ones and the new ones too"):
 * its outcome corrected (`$status`), or the lesson deleted ({@see delete()}). A lesson that stops
 * counting on a block that finished takes the books back through every block after it, down to the
 * running one ({@see LessonPackages::finishedBlockPlan()} with whole lessons).
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

    /** What a lesson's outcome can be corrected to from the package log — the attendance page's four. */
    public const OUTCOMES = ['ATTENDED', 'FREE', 'CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'];

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
    public function preview(object $session, bool $counts, ?int $teacherPercent, ?string $status = null): array
    {
        $calc = $this->calculate($session, $counts, $teacherPercent, $status);
        unset($calc['plan'], $calc['statement_id']);

        return $calc;
    }

    /**
     * What deleting this lesson would do, without doing it: the blocks it moves, the teacher's line.
     *
     * @return array<string,mixed>
     */
    public function deletePreview(object $session): array
    {
        $calc = $this->calculate($session, false, null, null, delete: true);
        unset($calc['plan'], $calc['statement_id']);

        return $calc;
    }

    /**
     * Delete a lesson from a package's log: off the package (and the blocks after it, as if it never
     * counted), off the teacher's salary, and hidden — a tombstone, as every lesson delete is, so the
     * nightly roll never brings it back ({@see AttendanceService::hide()}). A statement already paid
     * out of the treasury keeps the teacher's line, and says so.
     *
     * @return array<string,mixed> what was done, in the preview's shape
     */
    public function delete(string $sessionId, string $actorUserId, string $actorRole): array
    {
        return DB::transaction(function () use ($sessionId, $actorUserId, $actorRole): array {
            $session = DB::table('sessions')->where('id', $sessionId)->whereNull('hidden_at')->lockForUpdate()->first();
            if ($session === null) {
                abort(404, 'Lesson not found.');
            }

            $calc = $this->calculate($session, false, null, null, delete: true);
            if ($calc['blocker'] !== null) {
                throw ValidationException::withMessages(['session' => [$this->blockedMessage((string) $calc['blocker'])]]);
            }

            return $this->payroll->correcting($calc['statement_id'], function () use ($session, $calc, $actorUserId, $actorRole): array {
                $before = ['status' => (string) $session->status, 'billed' => (bool) $session->billed, 'paid_to_teacher' => (bool) $session->paid_to_teacher];

                if ($calc['student']['mode'] === 'FINISHED_PLAN') {
                    $this->uncountOnFinishedBlock($session, $calc['plan'], $actorUserId, $actorRole);
                }
                if ((string) $session->status !== SessionStatus::Rescheduled->value) {
                    // A statement paid from the treasury keeps the teacher's line: they stay paid.
                    $this->attendance->record($session, SessionStatus::CancelledByTeacher, 'Deleted / حُذفت', $actorUserId, $actorRole, false, $calc['teacher']['percent_after'] > 0);
                }
                $this->attendance->hide((string) $session->id, $actorUserId);

                Audit::log('session.deleted', 'session', (string) $session->id, (string) $session->academy_id, $actorUserId, $actorRole,
                    after: ['from' => 'package_log', 'mode' => $calc['student']['mode']],
                    before: $before);

                $result = $calc;
                unset($result['plan'], $result['statement_id']);

                return $result;
            });
        });
    }

    /**
     * Set it: the package (and the blocks around it) and the salary move together, or nothing does.
     *
     * @return array<string,mixed> what was done, in the preview's shape
     */
    public function apply(string $sessionId, bool $counts, ?int $teacherPercent, string $actorUserId, string $actorRole, ?string $status = null): array
    {
        return DB::transaction(function () use ($sessionId, $counts, $teacherPercent, $actorUserId, $actorRole, $status): array {
            $session = DB::table('sessions')->where('id', $sessionId)->whereNull('hidden_at')->lockForUpdate()->first();
            if ($session === null) {
                abort(404, 'Lesson not found.');
            }

            $calc = $this->calculate($session, $counts, $teacherPercent, $status);
            if ($calc['blocker'] !== null) {
                throw ValidationException::withMessages(['session' => [$this->blockedMessage((string) $calc['blocker'])]]);
            }

            $target = SessionStatus::from((string) $calc['status_after']);
            $cancelled = in_array($target->value, self::STATUSES, true);
            $after = (int) $calc['teacher']['percent_after'];
            // A cancellation carries its own money choice; a delivered lesson keeps the classifier's,
            // except where a statement paid from the treasury holds the teacher as they were.
            $billOverride = $cancelled ? (bool) $calc['student']['counts_after'] : null;
            $teacherOverride = $cancelled || $calc['teacher']['locked'] ? $after > 0 : null;
            $shareBp = $cancelled && $after > 0 && $after < 100 ? $after * 100 : null;
            $reason = $target->value === (string) $session->status ? $session->status_reason : null;

            return $this->payroll->correcting($calc['statement_id'], function () use ($session, $target, $reason, $calc, $billOverride, $teacherOverride, $shareBp, $actorUserId, $actorRole): array {
                if ($calc['student']['mode'] === 'FINISHED_PLAN') {
                    $this->uncountOnFinishedBlock($session, $calc['plan'], $actorUserId, $actorRole);
                }

                $this->attendance->record(
                    $session,
                    $target,
                    $reason,
                    $actorUserId,
                    $actorRole,
                    $billOverride,
                    $teacherOverride,
                    $shareBp,
                );

                Audit::log('session.counting_changed', 'session', (string) $session->id, (string) $session->academy_id, $actorUserId, $actorRole,
                    after: ['status' => $calc['status_after'], 'counts' => $calc['student']['counts_after'], 'teacher_pay_percent' => $calc['teacher']['percent_after'], 'mode' => $calc['student']['mode']],
                    before: ['status' => $calc['status_before'], 'counts' => $calc['student']['counts_before'], 'teacher_pay_percent' => $calc['teacher']['percent_before']]);

                $result = $calc;
                unset($result['plan'], $result['statement_id']);

                return $result;
            });
        });
    }

    /**
     * `$status` — the outcome it is corrected to (null: it stays what it is, and only a cancellation's
     * counting moves). `$delete` — the lesson goes: nothing counts and nobody is paid.
     *
     * @return array{blocker:?string, status_before:string, status_after:string, student:array<string,mixed>, teacher:array<string,mixed>, plan:?array<string,mixed>, statement_id:?string}
     */
    private function calculate(object $session, bool $counts, ?int $teacherPercent, ?string $status = null, bool $delete = false): array
    {
        $current = (string) $session->status;
        $target = $delete ? SessionStatus::CancelledByTeacher->value : ($status ?? $current);
        $cancelled = in_array($target, self::STATUSES, true);

        $blocker = match (true) {
            $delete => null,
            $status === null => in_array($current, self::STATUSES, true) ? null : 'NOT_CANCELLED',
            ! in_array($status, self::OUTCOMES, true) => 'NOT_AN_OUTCOME',
            Carbon::parse($session->scheduled_at_utc)->isFuture() => 'NOT_STARTED',
            default => null,
        };

        // What the outcome makes of it: a delivered lesson counts and pays, one on the house neither;
        // a cancellation is what the office says. A deleted lesson charges and pays nobody.
        $countsAfter = match (true) {
            $delete => false,
            $target === SessionStatus::Attended->value => true,
            $cancelled => $counts,
            default => false,
        };
        $countsBefore = (bool) $session->billed;

        $student = [
            'counts_before' => $countsBefore,
            'counts_after' => $countsAfter,
            // ADD (comes off the open block) · RELEASE (back to its block) · FINISHED_PLAN · UNBILL (a monthly bill line) · null (no change)
            'mode' => null,
            'package' => null,
            'will_complete' => false,
            'reopens' => false,
            'renewal_undone' => false,
            'lessons_moved_back' => null,
            'stays_closed' => null,
            // Every block it moves, before and after — what the owner confirms.
            'blocks' => [],
        ];
        $plan = null;

        if ($blocker === null && $countsAfter !== $countsBefore) {
            $credit = DB::table('lesson_package_credits')->where('session_id', $session->id)->first();

            if ($countsAfter) {
                $student['mode'] = 'ADD';
                $open = $this->packages->forLesson($session);
                if ($open !== null) {
                    $capacity = (int) $open->minutes_total + (int) $open->carried_over_minutes;
                    $left = $capacity - (int) $open->minutes_consumed;
                    $take = LessonPackages::countsLessons($open) ? (int) $open->lesson_minutes : max(1, (int) $session->duration_minutes);
                    $student['package'] = $this->blockSummary($open);
                    $student['will_complete'] = $left <= $take;
                    $student['blocks'] = [LessonPackages::blockRow($open, (int) $open->minutes_consumed, (int) $open->minutes_consumed + $take, $left <= $take ? 'COMPLETED' : 'ACTIVE', 0, 0)];
                }
            } elseif ($credit !== null) {
                $block = DB::table('lesson_packages')->where('id', $credit->package_id)->first();
                $student['package'] = $this->blockSummary($block);
                $consumedAfter = max(0, (int) $block->minutes_consumed - (int) $credit->minutes);

                // A block that ran out goes through the plan whatever its bill says, so the blocks
                // after it give their lessons back; a running one simply takes the lesson back.
                $exhausted = (string) $block->status === 'COMPLETED' && $block->closed_reason === 'EXHAUSTED';
                if ((string) $block->status === 'ACTIVE' || (! $exhausted && ! $this->packages->releaseRefused((string) $session->id))) {
                    $student['mode'] = 'RELEASE';
                    $student['blocks'] = [LessonPackages::blockRow($block, (int) $block->minutes_consumed, $consumedAfter, (string) $block->status, 0, 0)];
                } else {
                    $student['mode'] = 'FINISHED_PLAN';
                    $capacity = (int) $block->minutes_total + (int) $block->carried_over_minutes;
                    $plan = $this->packages->finishedBlockPlan($block, $consumedAfter, max(0, $consumedAfter - $capacity), wholeLessons: true);
                    if ($plan['blocker'] !== null) {
                        $blocker = (string) $plan['blocker'];
                    } else {
                        $student['blocks'] = $this->packages->planBlocks($block, (int) $block->minutes_consumed, $plan);
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
        $percentAfter = match (true) {
            $delete => 0,
            $target === SessionStatus::Attended->value => 100,
            $cancelled => $teacherPercent ?? ($target === $current ? $percentBefore : 0),
            default => 0,
        };
        $statementId = $line !== null ? (string) $line->payout_id : $this->ownStatement($session);
        $statement = $statementId !== null ? DB::table('payouts')->where('id', $statementId)->first(['period_year', 'period_month', 'finalized_at']) : null;
        // A statement already paid from the treasury keeps its figures: the teacher's side stays.
        $locked = $percentAfter !== $percentBefore && $statementId !== null && $this->payroll->carriesCorrections($statementId);

        return [
            'blocker' => $blocker,
            'status_before' => $current,
            'status_after' => $target,
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
            'NOT_AN_OUTCOME' => 'Pick attended, free, or cancelled by the teacher or the student. / اختر حضر أو مجانية أو ألغاها المعلم أو الطالب.',
            'NOT_STARTED' => 'This lesson has not started yet, so it has no outcome to correct. / هذه الحصة لم تبدأ بعد، فلا نتيجة لها لتعديلها.',
            'PACKAGE_CLOSED' => 'This lesson\'s package was closed by hand and settled, so it cannot change any more. / باقة هذه الحصة أُغلقت يدويًا وتمت تسويتها، فلا يمكن تعديلها.',
            'PACKAGE_OVERDRAFT_SETTLED' => 'The extra minutes of this lesson\'s package were already billed, so it cannot change. / الدقائق الزائدة في باقة هذه الحصة تمت فوترتها بالفعل، فلا يمكن تعديلها.',
            default => 'This change cannot be made. / لا يمكن إجراء هذا التعديل.',
        };
    }
}
