<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Canonical session lifecycle statuses (Master Spec §9).
 *
 * The billable/payout semantics in Master Spec §5.4 are intentionally NOT
 * encoded here in Sprint 0 (no business logic); they land with the billing
 * engine in later sprints.
 */
enum SessionStatus: string
{
    case Scheduled = 'SCHEDULED';
    case Attended = 'ATTENDED';
    case Free = 'FREE';
    case AbsentUnexcused = 'ABSENT_UNEXCUSED';
    case AbsentExcused = 'ABSENT_EXCUSED';
    case CancelledByTeacher = 'CANCELLED_BY_TEACHER';
    case CancelledByStudent = 'CANCELLED_BY_STUDENT';
    case Rescheduled = 'RESCHEDULED';
}
