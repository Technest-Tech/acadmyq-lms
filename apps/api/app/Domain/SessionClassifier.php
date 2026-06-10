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
 *   ABSENT_UNEXCUSED       → bill: true,  teacher: false   (no-show, no notice → charged)
 *   ABSENT_EXCUSED         → bill: false, teacher: false   (absent but gave notice)
 *   CANCELLED_BY_TEACHER   → bill: false, teacher: false
 *   CANCELLED_BY_STUDENT   → bill: false, teacher: false
 *   SCHEDULED | RESCHEDULED→ bill: false, teacher: false   (no outcome yet)
 */
final class SessionClassifier
{
    /**
     * @return array{billableToStudent: bool, countsForTeacher: bool}
     */
    public static function classify(SessionStatus $status): array
    {
        return match ($status) {
            SessionStatus::Attended => ['billableToStudent' => true, 'countsForTeacher' => true],
            SessionStatus::AbsentUnexcused => ['billableToStudent' => true, 'countsForTeacher' => false],
            SessionStatus::AbsentExcused,
            SessionStatus::CancelledByTeacher,
            SessionStatus::CancelledByStudent,
            SessionStatus::Scheduled,
            SessionStatus::Rescheduled => ['billableToStudent' => false, 'countsForTeacher' => false],
        };
    }

    /** Convenience: classify from the raw enum string stored in `sessions.status`. */
    public static function classifyValue(string $status): array
    {
        return self::classify(SessionStatus::from($status));
    }

    public static function billableToStudent(SessionStatus $status): bool
    {
        return self::classify($status)['billableToStudent'];
    }

    public static function countsForTeacher(SessionStatus $status): bool
    {
        return self::classify($status)['countsForTeacher'];
    }
}
