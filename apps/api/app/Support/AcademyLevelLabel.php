<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * What an academy calls its classification (docs/centre-profile/02-COHERENCE-AUDIT §3): LEVEL (an
 * English course's A1 … C2), GRADE (a curriculum centre's school grades) or YEAR. Stored on
 * `academies.level_label`; null — every academy before the setting existed — reads as LEVEL, the
 * word every screen already used.
 */
final class AcademyLevelLabel
{
    public const LEVEL = 'LEVEL';

    public const GRADE = 'GRADE';

    public const YEAR = 'YEAR';

    public const ALL = [self::LEVEL, self::GRADE, self::YEAR];

    public static function of(mixed $stored): string
    {
        $value = strtoupper(trim((string) ($stored ?? '')));

        return in_array($value, self::ALL, true) ? $value : self::LEVEL;
    }

    /** The current academy's word (read under its own tenant context). */
    public static function forAcademy(string $academyId): string
    {
        return self::of(DB::table('academies')->where('id', $academyId)->value('level_label'));
    }
}
