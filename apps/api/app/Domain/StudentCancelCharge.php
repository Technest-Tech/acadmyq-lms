<?php

declare(strict_types=1);

namespace App\Domain;

use App\Enums\SessionStatus;
use App\Support\Entitlement;

/**
 * Whether a lesson the student cancelled is charged — taken off their package, or billed — when
 * nobody allowed to decide said either way.
 *
 * Off (every academy by default), a cancellation is not charged unless the office chooses to
 * charge it ({@see SessionClassifier}). With `student_cancel_charged` switched on for an academy
 * (Alrayan, 2026-11-17: "a lesson the student cancels is a lesson taken"), a student's cancellation
 * is charged unless the office chooses not to — so one a teacher marks, who cannot decide money,
 * counts too. A teacher's cancellation and a free lesson are never charged by default.
 */
final class StudentCancelCharge
{
    public const CAPABILITY = 'student_cancel_charged';

    /**
     * @param  bool|null  $chosen  what someone holding session.bill_override chose; null when nobody did
     */
    public static function charge(string $academyId, SessionStatus $status, ?bool $chosen): bool
    {
        if ($chosen !== null) {
            return $chosen;
        }

        return $status === SessionStatus::CancelledByStudent
            && Entitlement::hasCapability($academyId, self::CAPABILITY);
    }

    /**
     * The choice a request carries: `charge_student` as sent by someone allowed to make it, else null.
     *
     * @param  array<string, mixed>  $data
     */
    public static function chosen(array $data, bool $mayBill): ?bool
    {
        return $mayBill && array_key_exists('charge_student', $data) && $data['charge_student'] !== null
            ? (bool) $data['charge_student']
            : null;
    }
}
