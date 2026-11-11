import type { SessionStatus } from "@academiq/contracts";
import type { TrialRow } from "@/lib/api";

/** One of the week's trials as a dashboard lists it: a trial lesson, or a trial booked on the Trials page. */
export interface WeekTrial {
  id: string;
  student_name: string | null;
  teacher_name: string | null;
  scheduled_at_utc: string;
  /** In lesson terms, so one list paints both kinds the same way. */
  status: SessionStatus;
}

/**
 * Trials booked on the Trials page (or from the CRM), in the shape the dashboards' "this week's
 * trials" list draws. They are not lessons, so the list built from lessons alone never showed
 * them: an academy booked a trial and looked for it there in vain. Attended and converted read as
 * attended, a no-show as missed; a cancelled trial is left out.
 */
export function bookedTrialsAsLessons(rows: TrialRow[]): WeekTrial[] {
  return rows
    .filter((r) => r.status !== "CANCELLED")
    .map((r) => ({
      id: `trial-${r.id}`,
      student_name: r.display_name ?? r.student_name ?? r.lead_name,
      teacher_name: r.teacher_name,
      scheduled_at_utc: r.scheduled_at_utc,
      status: r.status === "SCHEDULED" ? "SCHEDULED" : r.status === "NO_SHOW" ? "ABSENT_UNEXCUSED" : "ATTENDED",
    }));
}

/** Both kinds in time order. */
export function mergeWeekTrials(lessons: WeekTrial[], booked: WeekTrial[]): WeekTrial[] {
  return [...lessons, ...booked].sort((a, b) => a.scheduled_at_utc.localeCompare(b.scheduled_at_utc));
}
