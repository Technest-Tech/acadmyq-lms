/**
 * Exams, grades and the term report (docs/centre-profile, Phase 2 §5) — the API client for a group's
 * `/assessments`, `/grades`, `/reports` and a student's `/report`. A module of its own like
 * `groups-api.ts`: every call sits behind the `centre` switch (402 for a Quran academy), so nothing
 * in `api.ts` grows a grade.
 */
import { apiFetch } from "@/lib/api";

export type AssessmentKind = "QUIZ" | "HOMEWORK" | "MIDTERM" | "FINAL" | "ORAL" | "PROJECT" | "OTHER";
export const ASSESSMENT_KINDS: AssessmentKind[] = ["QUIZ", "HOMEWORK", "MIDTERM", "FINAL", "ORAL", "PROJECT", "OTHER"];

/** One column of the grade sheet. */
export interface Assessment {
  id: string;
  group_id: string;
  title: string;
  kind: AssessmentKind;
  /** YYYY-MM-DD, or null when it has no day. */
  held_on: string | null;
  max_score: number;
  /** Its share of the weighted total; 1 unless the academy says otherwise, 0 = shown but not counted. */
  weight: number;
  sort_order: number;
  /** How many cells of this column hold a score or an absence. */
  graded_count: number;
}

export interface AssessmentInput {
  title: string;
  kind: AssessmentKind;
  held_on?: string | null;
  max_score: number;
  weight?: number;
}

/** One cell — an empty cell still names its column, with `score` null and `percent` null. */
export interface ScoreCell {
  assessment_id: string;
  title: string;
  kind: AssessmentKind;
  held_on: string | null;
  max_score: number;
  weight: number;
  score: number | null;
  /** Absent from the assessment: counts as 0 in the total and is flagged. */
  absent: boolean;
  note: string | null;
  /** 0–100 with one decimal; null when not graded. */
  percent: number | null;
}

export interface SheetMember {
  student_id: string;
  full_name: string;
  level: string | null;
  joined_on: string;
  left_on: string | null;
  /** No open membership — they left after the group started and keep their place on the sheet. */
  left: boolean;
}

export interface GradeSheet {
  members: SheetMember[];
  assessments: Assessment[];
  /** student id → assessment id → cell */
  scores: Record<string, Record<string, ScoreCell>>;
  /** student id → weighted total (0–100), null when nothing graded */
  totals: Record<string, number | null>;
  /** The caller may write columns and cells (runs groups, or teaches this one). */
  can_mark: boolean;
  /** The caller may publish reports (group.manage). */
  can_publish: boolean;
}

export interface ScoreEntry {
  student_id: string;
  score: number | null;
  absent?: boolean;
  note?: string | null;
}

export interface ReportAttendance {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Percent, late counting as present; null without a mark. */
  rate: number | null;
  /** Held lessons dated inside the membership window. */
  lessons_held: number;
}

export interface TermReport {
  student: { id: string; full_name: string; level: string | null };
  group: { id: string; name: string; level: string | null; teacher_name: string | null };
  period: { from: string; to: string; left: boolean };
  attendance: ReportAttendance;
  grades: ScoreCell[];
  total: { weighted_percent: number | null };
  comment: string | null;
  overall_grade: string | null;
  published_at: string | null;
  published_by_name: string | null;
  updated_at: string | null;
}

export interface TermReportResponse {
  report: TermReport;
  academy: { name: string; logo_url: string | null };
  can_mark: boolean;
  can_publish: boolean;
}

export interface TermReportRow {
  student_id: string;
  full_name: string;
  left: boolean;
  attendance: ReportAttendance;
  total: { weighted_percent: number | null };
  graded_count: number;
  has_comment: boolean;
  overall_grade: string | null;
  published_at: string | null;
}

export interface TermReportList {
  reports: TermReportRow[];
  can_mark: boolean;
  can_publish: boolean;
}

export function listAssessments(groupId: string): Promise<{ assessments: Assessment[]; can_mark: boolean; can_publish: boolean }> {
  return apiFetch(`/api/groups/${groupId}/assessments`);
}

export function createAssessment(groupId: string, input: AssessmentInput): Promise<{ assessment: Assessment }> {
  return apiFetch(`/api/groups/${groupId}/assessments`, { method: "POST", body: JSON.stringify(input) });
}

export function updateAssessment(groupId: string, assessmentId: string, patch: Partial<AssessmentInput>): Promise<{ assessment: Assessment }> {
  return apiFetch(`/api/groups/${groupId}/assessments/${assessmentId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Refused (422) while scores sit on the column unless `force`, which takes them with it. */
export function deleteAssessment(groupId: string, assessmentId: string, force = false): Promise<{ ok: boolean }> {
  return apiFetch(`/api/groups/${groupId}/assessments/${assessmentId}${force ? "?force=1" : ""}`, { method: "DELETE" });
}

export function getGradeSheet(groupId: string): Promise<GradeSheet> {
  return apiFetch(`/api/groups/${groupId}/grades`);
}

/** One column's cells, all or nothing; answers with the whole sheet. */
export function saveScores(groupId: string, assessmentId: string, scores: ScoreEntry[]): Promise<GradeSheet> {
  return apiFetch(`/api/groups/${groupId}/assessments/${assessmentId}/scores`, { method: "PUT", body: JSON.stringify({ scores }) });
}

export function listTermReports(groupId: string): Promise<TermReportList> {
  return apiFetch(`/api/groups/${groupId}/reports`);
}

export function publishAllTermReports(groupId: string): Promise<TermReportList & { published: number }> {
  return apiFetch(`/api/groups/${groupId}/reports/publish-all`, { method: "POST" });
}

export function getTermReport(groupId: string, studentId: string): Promise<TermReportResponse> {
  return apiFetch(`/api/groups/${groupId}/students/${studentId}/report`);
}

export function saveTermReport(
  groupId: string,
  studentId: string,
  input: { comment: string | null; overall_grade?: string | null },
): Promise<TermReportResponse> {
  return apiFetch(`/api/groups/${groupId}/students/${studentId}/report`, { method: "PUT", body: JSON.stringify(input) });
}

export function publishTermReport(groupId: string, studentId: string): Promise<TermReportResponse> {
  return apiFetch(`/api/groups/${groupId}/students/${studentId}/report/publish`, { method: "POST" });
}

export function unpublishTermReport(groupId: string, studentId: string): Promise<TermReportResponse> {
  return apiFetch(`/api/groups/${groupId}/students/${studentId}/report/unpublish`, { method: "POST" });
}

/** The colour a percent reads in: under 50 is a worry, 85 and up is a win. */
export function percentTone(percent: number | null): "low" | "high" | "mid" | "none" {
  if (percent === null) return "none";
  if (percent < 50) return "low";
  if (percent >= 85) return "high";
  return "mid";
}
