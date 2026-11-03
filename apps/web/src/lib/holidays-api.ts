import { apiFetch } from "@/lib/api";
import type { GroupLesson } from "@/lib/groups-api";

/**
 * A centre's holidays and the substitute teacher (docs/centre-profile, Phase 2 §3) — all behind the
 * `centre` switch on the API. Declaring a holiday cancels the pending lessons inside it from today
 * on; deleting it brings them back and the generators fill in the days they skipped. The substitute
 * call lives here rather than in groups-api so the groups client stays untouched; it answers with
 * the lesson in the same shape the group screens already read.
 */

export interface HolidayCounts {
  group_lessons: number;
  sessions: number;
}

export interface Holiday {
  id: string;
  name: string;
  /** YYYY-MM-DD in the academy's own calendar. */
  starts_on: string;
  ends_on: string;
  /** What still stands cancelled in its days. */
  cancelled: HolidayCounts;
  created_at: string;
}

/** The marker a lesson cancelled by a holiday carries in `cancel_reason` / `status_reason`. */
export const HOLIDAY_REASON = "HOLIDAY";

export function listHolidays(): Promise<{ holidays: Holiday[] }> {
  return apiFetch("/api/holidays");
}

/** What declaring this range would cancel — the confirm step's numbers. */
export function previewHoliday(startsOn: string, endsOn: string): Promise<HolidayCounts> {
  const params = new URLSearchParams({ starts_on: startsOn, ends_on: endsOn });
  return apiFetch(`/api/holidays/preview?${params.toString()}`);
}

export function createHoliday(input: { name: string; starts_on: string; ends_on: string }): Promise<{ holiday: Holiday; cancelled: HolidayCounts }> {
  return apiFetch("/api/holidays", { method: "POST", body: JSON.stringify(input) });
}

export function deleteHoliday(id: string): Promise<{ ok: boolean; restored: HolidayCounts }> {
  return apiFetch(`/api/holidays/${id}`, { method: "DELETE" });
}

/** A colleague covers this one lesson (and is paid for it); `null` puts the group's teacher back. */
export function setGroupLessonSubstitute(lessonId: string, teacherId: string | null): Promise<{ lesson: GroupLesson }> {
  return apiFetch(`/api/group-lessons/${lessonId}/substitute`, {
    method: "POST",
    body: JSON.stringify({ teacher_id: teacherId }),
  });
}
