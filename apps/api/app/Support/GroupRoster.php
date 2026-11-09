<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Whether a group lesson has anyone to take attendance for: a live student whose membership covers
 * the lesson's date (the half-open `joined_on <= d < left_on` range the sheet expects them by).
 *
 * A group with nobody in it yet (created first, students added later) asks for no sheet — it stays
 * off the attendance lists, the "sheets owed" counters and the not-marked alert until a student
 * joins (lingo, 2026-11-09). It still sits on the timetable and the calendar: the room is taken.
 */
final class GroupRoster
{
    /** SQL `exists (...)` for the lesson aliased `$lesson` (needs its group_id + occurrence_local_date). */
    public static function hasStudentsSql(string $lesson = 'l'): string
    {
        return "exists (select 1 from class_group_members rm_m join students rm_s on rm_s.id = rm_m.student_id
                 where rm_m.group_id = {$lesson}.group_id
                   and rm_m.joined_on <= {$lesson}.occurrence_local_date
                   and (rm_m.left_on is null or rm_m.left_on > {$lesson}.occurrence_local_date)
                   and rm_s.deleted_at is null)";
    }
}
