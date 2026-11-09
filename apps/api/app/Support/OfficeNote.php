<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\Gate;

/**
 * Who reads and writes the office's note on a lesson (`admin_note`): whoever runs attendance from
 * the office — never a teacher, never a family. Everyone else gets no `admin_note` key at all.
 */
final class OfficeNote
{
    public const MAX = 2000;

    public static function visible(?string $role): bool
    {
        return ! in_array($role, ['TEACHER', 'GUARDIAN', 'STUDENT'], true) && Gate::allows('session.mark_attendance');
    }

    /** Trimmed, empty → null, capped. */
    public static function clean(?string $note): ?string
    {
        $note = $note !== null ? trim($note) : '';

        return $note === '' ? null : mb_substr($note, 0, self::MAX);
    }
}
