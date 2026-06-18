<?php

declare(strict_types=1);

namespace App\Domain;

use App\Enums\SessionStatus;

/**
 * THE classification matrix (Sprint 6 §3.1 / §4, mirroring Master Spec §5.4).
 *
 * Billable-to-student and counts-for-teacher are DERIVED from a session's status — never
 * stored as independent truth. `sessions.billed` / `sessions.paid_to_teacher` are idempotency
 * guards (Sprint 1 §6.5), not classification. This is the ONE place the matrix lives: Sprint 6
 * (attendance/billing hook), Sprint 7 (invoicing) and Sprint 8 (payroll) all call this single
 * pure function, so the rule can never disagree across the codebase (decision §3.1, risk §11).
 *
 *   ATTENDED               → bill: true,  teacher: true
 *   FREE                   → bill: false, teacher: false   (lesson delivered but on the house —
 *                                                           free for student, teacher AND academy)
 *   ABSENT_UNEXCUSED       → bill: true,  teacher: false   (legacy — no longer selectable)
 *   ABSENT_EXCUSED         → bill: false, teacher: false   (legacy — no longer selectable)
 *   CANCELLED_BY_TEACHER   → bill: false, teacher: false   (default — overridable per cancellation)
 *   CANCELLED_BY_STUDENT   → bill: false, teacher: false   (default — overridable per cancellation)
 *   SCHEDULED | RESCHEDULED→ bill: false, teacher: false   (no outcome yet)
 *
 * Per-cancellation override: the academy may decide, when cancelling, to still charge the student
 * and/or pay the teacher (a late-cancel fee). `$billOverride` / `$teacherOverride` carry that
 * decision (from `sessions.bill_override` / `teacher_override`). NULL = no override → the status
 * default above stands. ATTENDED/FREE are never passed an override, so the matrix is unchanged for
 * them: this stays a single source of truth, now parameterised for the cancellation case only.
 */
final class SessionClassifier
{
    /**
     * @return array{billableToStudent: bool, countsForTeacher: bool}
     */
    public static function classify(SessionStatus $status, ?bool $billOverride = null, ?bool $teacherOverride = null): array
    {
        $base = match ($status) {
            SessionStatus::Attended => ['billableToStudent' => true, 'countsForTeacher' => true],
            SessionStatus::AbsentUnexcused => ['billableToStudent' => true, 'countsForTeacher' => false],
            SessionStatus::Free,
            SessionStatus::AbsentExcused,
            SessionStatus::CancelledByTeacher,
            SessionStatus::CancelledByStudent,
            SessionStatus::Scheduled,
            SessionStatus::Rescheduled => ['billableToStudent' => false, 'countsForTeacher' => false],
        };

        return [
            'billableToStudent' => $billOverride ?? $base['billableToStudent'],
            'countsForTeacher' => $teacherOverride ?? $base['countsForTeacher'],
        ];
    }

    /** Convenience: classify from the raw enum string stored in `sessions.status` (+ overrides). */
    public static function classifyValue(string $status, ?bool $billOverride = null, ?bool $teacherOverride = null): array
    {
        return self::classify(SessionStatus::from($status), $billOverride, $teacherOverride);
    }

    public static function billableToStudent(SessionStatus $status, ?bool $billOverride = null): bool
    {
        return self::classify($status, $billOverride)['billableToStudent'];
    }

    public static function countsForTeacher(SessionStatus $status, ?bool $teacherOverride = null): bool
    {
        return self::classify($status, null, $teacherOverride)['countsForTeacher'];
    }
}
