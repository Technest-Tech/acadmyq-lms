import type { SessionStatus } from "@academiq/contracts";
import type { CalendarGroupLesson, CalendarSession } from "@/lib/api";

/**
 * Group-class lessons folded into the session shape the calendar and the dashboard count with —
 * held as attended, cancelled as cancelled, the rest scheduled. `group` is what tells a view it is
 * not a session (one block for the whole class, never dragged, its sheet on the group page), and
 * an empty student / null schedule keep it out of student and trial counts.
 */
export function groupLessonsAsSessions(lessons: CalendarGroupLesson[]): CalendarSession[] {
  return lessons.map((gl) => ({
    id: gl.id,
    student_id: "",
    teacher_id: gl.teacher_id,
    schedule_id: null,
    scheduled_at_utc: gl.scheduled_at_utc,
    duration_minutes: gl.duration_minutes,
    status: (gl.status === "HELD" ? "ATTENDED" : gl.status === "CANCELLED" ? "CANCELLED_BY_TEACHER" : "SCHEDULED") as SessionStatus,
    status_reason: gl.cancel_reason,
    original_session_id: null,
    student_name: `${gl.group_name} (${gl.member_count})`,
    teacher_name: gl.teacher_name,
    group: gl,
  }));
}
