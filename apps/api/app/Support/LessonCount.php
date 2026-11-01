<?php

declare(strict_types=1);

namespace App\Support;

/**
 * A centre's private subscription read the way it was sold: in whole lessons, never hours. The block
 * still runs on minutes underneath, so a stray remainder (a 60-minute lesson on a 40-minute block) is
 * simply not a lesson: what is left is what can still be taught.
 */
final class LessonCount
{
    public static function whole(int $minutes, int $lessonMinutes): int
    {
        return $lessonMinutes > 0 ? intdiv(max(0, $minutes), $lessonMinutes) : 0;
    }

    public static function ar(int $count): string
    {
        return match (true) {
            $count === 1 => 'حصة واحدة',
            $count === 2 => 'حصتان',
            $count >= 3 && $count <= 10 => "{$count} حصص",
            default => "{$count} حصة",
        };
    }

    public static function en(int $count): string
    {
        return $count === 1 ? '1 lesson' : "{$count} lessons";
    }
}
