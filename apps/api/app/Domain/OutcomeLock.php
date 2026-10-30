<?php

declare(strict_types=1);

namespace App\Domain;

use Illuminate\Validation\ValidationException;

/**
 * Once the office has recorded a lesson's outcome, the teacher cannot take it back.
 *
 * A TEACHER may change or undo an outcome only while the lesson is still pending, or when they
 * recorded it themselves. An outcome set by anybody else — the owner, a supervisor, an approved
 * cancellation, an imported history row with no marker — is final for them: re-marking it,
 * re-saving a group sheet over it, or reverting it is refused. Office staff are never locked.
 *
 * One rule for private sessions and group lessons alike: both carry `status` + `outcome_set_by`.
 */
final class OutcomeLock
{
    public static function locks(string $actorRole, string $actorUserId, bool $pending, ?string $outcomeSetBy): bool
    {
        return $actorRole === 'TEACHER' && ! $pending && $outcomeSetBy !== $actorUserId;
    }

    public static function assertOpen(string $actorRole, string $actorUserId, bool $pending, ?string $outcomeSetBy): void
    {
        if (self::locks($actorRole, $actorUserId, $pending, $outcomeSetBy)) {
            throw ValidationException::withMessages([
                'status' => ['The administration has already recorded this lesson; only they can change it. / سجّلت الإدارة هذه الحصة بالفعل؛ لا يمكن تعديلها إلا من الإدارة.'],
            ]);
        }
    }
}
