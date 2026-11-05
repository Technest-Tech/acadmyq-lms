<?php

declare(strict_types=1);

namespace App\Services;

use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;
use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use App\Support\MoneyPolicy;

/**
 * Correct the lessons behind a teacher's salary from the payroll page: take one off, add one that
 * is missing, or count one that is sitting unmarked.
 *
 * A wrong lesson is usually noticed when the salary is checked, which is often after the month was
 * sealed on the 3rd, so these corrections cannot simply refuse a closed month the way the attendance
 * page does. The documents still never change once closed:
 *
 *  - A FINALIZED statement stays as it was paid. The difference lands on the teacher's first open
 *    statement as a reward or deduction, netted against the same statement's recalculation
 *    ({@see Payroll::repriceQuote}) through `repriced_payout_id`, so it is never owed twice.
 *  - A CLOSED student bill or a settled package stays too. The lesson is recorded as a cancellation
 *    that still charges (`bill_override`), the state the classifier already has for "cancelled, but
 *    the family pays", and the owner is told before confirming.
 *
 * Everything else moves both documents through {@see AttendanceService}, like any other outcome.
 */
final class PayrollLessonCorrection
{
    public function __construct(
        private readonly AttendanceService $attendance,
        private readonly Payroll $payroll,
        private readonly LessonPackages $packages,
    ) {}

    /**
     * What removing this lesson would do, without doing it.
     *
     * @return array{amount_minor: int, currency: ?string, payout_sealed: bool, student_locked: bool}
     */
    public function removalPreview(object $session): array
    {
        $line = $this->payoutLine((string) $session->id);

        return [
            'amount_minor' => (int) ($line->amount_minor ?? 0),
            'currency' => $line->currency ?? null,
            // Only a statement paid from the treasury stays as it is; any other is corrected in place.
            'payout_sealed' => $line !== null && $this->payroll->carriesCorrections((string) $line->payout_id),
            'student_locked' => $this->studentLocked((string) $session->id),
        ];
    }

    /**
     * Take a lesson off the salary and off the books, leaving a hidden tombstone so the nightly roll
     * does not generate it again.
     *
     * @return array{amount_minor: int, currency: ?string, payout_sealed: bool, student_locked: bool}
     */
    public function remove(string $sessionId, string $actorUserId, string $actorRole): array
    {
        return $this->payroll->correcting($this->payoutLine($sessionId)?->payout_id, function () use ($sessionId, $actorUserId, $actorRole): array {
            $session = $this->lockedSession($sessionId);
            if (! self::paysTeacher($session)) {
                throw ValidationException::withMessages([
                    'session' => ['This lesson is not on the teacher\'s salary. / هذه الحصة ليست ضمن راتب المعلم.'],
                ]);
            }

            $effect = $this->removalPreview($session);
            $line = $this->payoutLine($sessionId);

            if ($effect['payout_sealed']) {
                $this->payroll->carryLessonDifference(
                    (string) $line->payout_id,
                    -$effect['amount_minor'],
                    'Lesson removed: '.$this->describe($session).' / حذف حصة: '.$this->describe($session),
                    $actorUserId,
                    $actorRole,
                );
                // The sealed line stays, so tell the service there is nothing left for it to reverse.
                $session->paid_to_teacher = false;
            }

            $this->attendance->record(
                $session,
                SessionStatus::CancelledByTeacher,
                'Deleted / حُذفت',
                $actorUserId,
                $actorRole,
                $effect['student_locked'],
                false,
            );
            $this->attendance->hide($sessionId, $actorUserId);

            Audit::log('session.deleted', 'session', $sessionId, (string) $session->academy_id, $actorUserId, $actorRole,
                after: ['source' => 'payroll', ...$effect]);

            return $effect;
        });
    }

    /**
     * Add a lesson that happened but is missing. When that exact slot already exists unmarked, it is
     * counted rather than duplicated.
     *
     * @return array{session_id: string, statement_year: int, statement_month: int, carried: bool}
     */
    public function add(string $academyId, string $teacherId, string $studentId, Carbon $startUtc, int $duration, string $actorUserId, string $actorRole): array
    {
        $this->assertHappened($startUtc);

        return DB::transaction(function () use ($academyId, $teacherId, $studentId, $startUtc, $duration, $actorUserId, $actorRole): array {
            $at = $startUtc->format('Y-m-d H:i:sP');
            $existing = DB::table('sessions')
                ->where('teacher_id', $teacherId)
                ->where('student_id', $studentId)
                ->where('scheduled_at_utc', $at)
                ->where('status', '<>', SessionStatus::Rescheduled->value)
                ->whereNull('hidden_at')
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                if (self::paysTeacher($existing)) {
                    // Taught but on no statement: the one it was on was deleted. Count it again.
                    if ($this->payoutLine((string) $existing->id) !== null) {
                        throw ValidationException::withMessages([
                            'session' => ['This lesson is already on the salary. / هذه الحصة موجودة بالفعل في الراتب.'],
                        ]);
                    }

                    return $this->payAgain($existing);
                }
                DB::table('sessions')->where('id', $existing->id)->update(['duration_minutes' => $duration, 'updated_at' => now()]);
                $sessionId = (string) $existing->id;
            } else {
                $sessionId = (string) Str::uuid();
                DB::table('sessions')->insert([
                    'id' => $sessionId,
                    'academy_id' => $academyId,
                    'student_id' => $studentId,
                    'teacher_id' => $teacherId,
                    'schedule_id' => null, // ad-hoc: the generator never touches it
                    'slot_id' => null,
                    'occurrence_local_date' => null,
                    'scheduled_at_utc' => $at,
                    'duration_minutes' => $duration,
                    'status' => SessionStatus::Scheduled->value,
                ]);
                Audit::log('session.created', 'session', $sessionId, $academyId, $actorUserId, $actorRole, after: [
                    'student_id' => $studentId,
                    'teacher_id' => $teacherId,
                    'scheduled_at_utc' => $startUtc->toIso8601String(),
                    'duration_minutes' => $duration,
                    'ad_hoc' => true,
                    'source' => 'payroll',
                ]);
            }

            return $this->markAttended($sessionId, $actorUserId, $actorRole);
        });
    }

    /**
     * Count a lesson that exists but pays nothing (unmarked, cancelled or free) as attended.
     *
     * @return array{session_id: string, statement_year: int, statement_month: int, carried: bool}
     */
    public function attend(string $sessionId, string $actorUserId, string $actorRole): array
    {
        return DB::transaction(function () use ($sessionId, $actorUserId, $actorRole): array {
            $session = $this->lockedSession($sessionId);
            $this->assertHappened(Carbon::parse($session->scheduled_at_utc));

            if ($session->hidden_at !== null || (string) $session->status === SessionStatus::Rescheduled->value) {
                throw ValidationException::withMessages([
                    'session' => ['This lesson was removed or moved. / تم حذف هذه الحصة أو نقلها.'],
                ]);
            }
            if (self::paysTeacher($session)) {
                throw ValidationException::withMessages([
                    'session' => ['This lesson is already on the salary. / هذه الحصة موجودة بالفعل في الراتب.'],
                ]);
            }

            return $this->markAttended($sessionId, $actorUserId, $actorRole);
        });
    }

    /** Whether a session row counts for the teacher right now, per the one classification matrix. */
    public static function paysTeacher(object $session): bool
    {
        return SessionClassifier::classifyValue(
            (string) $session->status,
            $session->bill_override !== null ? (bool) $session->bill_override : null,
            $session->teacher_override !== null ? (bool) $session->teacher_override : null,
        )['countsForTeacher'];
    }

    /** @return array{session_id: string, statement_year: int, statement_month: int, carried: bool} */
    private function markAttended(string $sessionId, string $actorUserId, string $actorRole): array
    {
        $session = DB::table('sessions')->where('id', $sessionId)->first();
        $this->payroll->correcting($this->ownStatement($session), fn () => $this->attendance->record($session, SessionStatus::Attended, null, $actorUserId, $actorRole));

        return $this->counted($sessionId);
    }

    /** @return array{session_id: string, statement_year: int, statement_month: int, carried: bool} */
    private function payAgain(object $session): array
    {
        $this->payroll->correcting($this->ownStatement($session), fn () => $this->payroll->onSessionAttended($session));

        return $this->counted((string) $session->id);
    }

    /** The teacher's statement for the lesson's own month, if there is one. */
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

    /** @return array{session_id: string, statement_year: int, statement_month: int, carried: bool} */
    private function counted(string $sessionId): array
    {
        $line = $this->payoutLine($sessionId);
        $own = Carbon::parse((string) $line->session_date);

        return [
            'session_id' => $sessionId,
            'statement_year' => (int) $line->period_year,
            'statement_month' => (int) $line->period_month,
            'carried' => (int) $line->period_year !== $own->year || (int) $line->period_month !== $own->month,
        ];
    }

    private function assertHappened(Carbon $startUtc): void
    {
        if ($startUtc->isFuture()) {
            throw ValidationException::withMessages([
                'scheduled_at_utc' => ['A salary lesson must have already happened. / لا يمكن احتساب حصة لم يحن موعدها بعد.'],
            ]);
        }
    }

    private function lockedSession(string $sessionId): object
    {
        $session = DB::table('sessions')->where('id', $sessionId)->lockForUpdate()->first();
        if ($session === null) {
            throw ValidationException::withMessages(['session' => ['Session not found. / الحصة غير موجودة.']]);
        }

        return $session;
    }

    private function payoutLine(string $sessionId): ?object
    {
        return DB::table('payout_line_items as li')
            ->join('payouts as p', 'p.id', '=', 'li.payout_id')
            ->where('li.session_id', $sessionId)
            ->first(['li.payout_id', 'li.amount_minor', 'li.currency', 'li.session_date', 'p.finalized_at', 'p.period_year', 'p.period_month']);
    }

    /** Whether the student's side of this lesson can no longer be taken back: closed bill, settled package. */
    private function studentLocked(string $sessionId): bool
    {
        $invoiceStatus = DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->where('li.session_id', $sessionId)
            ->value('i.status');

        if ($invoiceStatus !== null && $invoiceStatus !== 'OPEN') {
            return true;
        }
        // A centre's subscription takes a lesson back whatever its bill says; its old package row is history.
        $academyId = (string) DB::table('sessions')->where('id', $sessionId)->value('academy_id');

        return ! MoneyPolicy::usesSubscriptions($academyId) && $this->packages->releaseRefused($sessionId);
    }

    /** "12/06/2026 · Omar", for the reason shown on the statement that carries the difference. */
    private function describe(object $session): string
    {
        $timezone = (string) (DB::table('academies')->where('id', $session->academy_id)->value('timezone') ?: 'UTC');
        $name = DB::table('students')->where('id', $session->student_id)->value('full_name');

        return Carbon::parse($session->scheduled_at_utc)->setTimezone($timezone)->format('d/m/Y').' · '.($name ?? '—');
    }
}
