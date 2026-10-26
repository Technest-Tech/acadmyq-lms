/**
 * Group classes (docs/groups) — the API client for /api/groups and /api/group-lessons.
 *
 * Kept out of `api.ts` the way `learn-api.ts` is: a module of its own, behind its own feature
 * switch (`groups`). A group lesson is NOT a session — it has its own ids, its own statuses and an
 * attendance sheet of its own — so none of these types are shared with the private-lesson ones.
 */
import { apiFetch } from "@/lib/api";

export type GroupState = "UPCOMING" | "RUNNING" | "FINISHED" | "ARCHIVED";
export type GroupMode = "ONLINE" | "OFFLINE";
export type GroupLessonStatus = "SCHEDULED" | "HELD" | "CANCELLED";
export type GroupAttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";
export type GroupBillingMode = "MONTHLY" | "PER_LESSON" | "COURSE";
/** null = the teacher's own rate, as for a private lesson of that length. */
export type GroupTeacherPayMode = "PER_LESSON" | "PER_HOUR" | "PER_STUDENT" | "REVENUE_SHARE" | null;

/** What the student pays (docs/groups §Money). null on the row for whoever may not see money. */
export interface GroupPricing {
  billing_mode: GroupBillingMode;
  /** null = the group bills nothing. Minor units. */
  price_minor: number | null;
  currency: string | null;
  /** PER_LESSON only: charge an unexcused absence too. */
  charge_absent: boolean;
  /** MONTHLY only: pro-rate a late joiner's first month by the lessons left. */
  prorate_join: boolean;
  /**
   * MONTHLY only: the hours one month buys, in minutes. Set = a member's next month is raised when
   * the group has held that many hours since their last one; null = the calendar month.
   */
  month_minutes: number | null;
  /** Hours group only: a lesson with ONE student on the roster counts this long against their hours; null = its real length. */
  solo_billed_minutes: number | null;
}

/** What the teacher earns per held lesson (or, REVENUE_SHARE, per month). */
export interface GroupTeacherPay {
  mode: GroupTeacherPayMode;
  amount_minor: number | null;
  /** Basis points: 5000 = 50 %. */
  share_bp: number | null;
  /** The teacher's pay currency — what amount_minor is in. */
  currency: string | null;
}

export interface GroupSlot {
  /** 0 = Sunday … 6 = Saturday, as the private timetable. */
  weekday: number;
  /** "HH:MM" in the group's own timezone. */
  start_time_local: string;
  duration_minutes: number;
}

export interface GroupLessonCounters {
  held: number;
  cancelled: number;
  upcoming: number;
  /** Lessons whose time has passed with no sheet saved and no cancellation. */
  overdue: number;
  next_lesson_at: string | null;
}

export interface GroupRow {
  id: string;
  name: string;
  specialization_id: string | null;
  specialization_name: string | null;
  level: string | null;
  teacher_id: string;
  teacher_name: string | null;
  /** null = no seat limit. */
  capacity: number | null;
  member_count: number;
  mode: GroupMode;
  location: string | null;
  meeting_url: string | null;
  timezone: string;
  start_date: string;
  end_date: string | null;
  status: "ACTIVE" | "ARCHIVED";
  /** Derived server-side from the dates; only ARCHIVED is stored. */
  state: GroupState;
  slots: GroupSlot[];
  lessons: GroupLessonCounters;
  pricing: GroupPricing | null;
  teacher_pay: GroupTeacherPay | null;
}

export interface MemberAttendance {
  present: number;
  late: number;
  absent: number;
  excused: number;
  marked: number;
  /** (present + late) / marked, 0–1; null before the first held lesson. */
  rate: number | null;
}

export interface GroupMember {
  id: string;
  student_id: string;
  full_name: string;
  guardian_name: string | null;
  joined_on: string;
  left_on: string | null;
  status: "ACTIVE" | "LEFT";
  left_reason: string | null;
  /** The student has since been removed from the academy. */
  student_removed: boolean;
  attendance: MemberAttendance | null;
  /** This member's own price (null = the group's, or hidden). Minor units. */
  price_minor: number | null;
  /**
   * An hours group, for whoever sees money: the months bought so far and the minutes they bought
   * (carried-in hours included) against the minutes the group has held for them. null otherwise.
   */
  hour_month?: { months: number; bought_minutes: number; used_minutes: number } | null;
}

export interface GroupDetail extends GroupRow {
  notes: string | null;
  /** The group's own link, else its teacher's. */
  effective_meeting_url: string | null;
  members: GroupMember[];
  attendance_rate: number | null;
}

export interface GroupLessonCounts {
  present: number;
  late: number;
  absent: number;
  excused: number;
  marked: number;
  expected: number;
}

export interface GroupLesson {
  id: string;
  group_id: string;
  teacher_id: string;
  teacher_name: string | null;
  slot_id: string | null;
  occurrence_local_date: string;
  scheduled_at_utc: string;
  duration_minutes: number;
  status: GroupLessonStatus;
  cancel_reason: string | null;
  moved: boolean;
  /** Added by hand (حصة تعويض), not produced by a weekly slot. */
  extra: boolean;
  topic: string | null;
  homework: string | null;
  notes: string | null;
  outcome_set_at: string | null;
  counts: GroupLessonCounts | null;
}

export interface RosterEntry {
  student_id: string;
  full_name: string;
  /** null = not marked yet. */
  status: GroupAttendanceStatus | null;
  note: string | null;
  /** false = no longer a member on that date, but already on this sheet. */
  member: boolean;
}

export interface GroupLessonSheet {
  lesson: GroupLesson;
  group: {
    id: string;
    name: string;
    level: string | null;
    timezone: string;
    status: "ACTIVE" | "ARCHIVED";
    mode: GroupMode;
    location: string | null;
    meeting_url: string | null;
  };
  roster: RosterEntry[];
}

export interface SchedulingWarning {
  type: string;
  message: string;
}

export interface GroupInput {
  name: string;
  teacher_id: string;
  specialization_id?: string | null;
  level?: string | null;
  capacity?: number | null;
  mode?: GroupMode;
  location?: string | null;
  meeting_url?: string | null;
  timezone?: string | null;
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
  slots: GroupSlot[];
  student_ids?: string[];
  allow_over_capacity?: boolean;
  billing_mode?: GroupBillingMode;
  price_minor?: number | null;
  currency?: string | null;
  charge_absent?: boolean;
  prorate_join?: boolean;
  month_minutes?: number | null;
  solo_billed_minutes?: number | null;
  teacher_pay_mode?: GroupTeacherPayMode;
  teacher_pay_minor?: number | null;
  teacher_share_bp?: number | null;
}

export interface GroupMoneyLine {
  id: string;
  student_id: string | null;
  student_name: string | null;
  description: string;
  amount_minor: number;
  currency: string;
  charge: "MONTHLY" | "LESSON" | "COURSE";
  period: string;
  invoice_id: string;
  invoice_status: "OPEN" | "CLOSED" | "PAID" | "PARTIALLY_PAID" | "VOID";
}

export interface GroupMoney {
  month: string;
  lines: GroupMoneyLine[];
  totals: { currency: string; billed_minor: number; paid_minor: number; outstanding_minor: number }[];
  /** null for whoever cannot read payroll. */
  teacher_cost: { currency: string; amount_minor: number; lessons: number }[] | null;
}

type Generated = { created: number; removed: number };

export function listGroups(params: {
  state?: GroupState | "ACTIVE";
  teacher_id?: string;
  q?: string;
} = {}): Promise<{ groups: GroupRow[]; counts: Record<GroupState, number> }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const query = qs.toString();
  return apiFetch(`/api/groups${query ? `?${query}` : ""}`);
}

export function getGroup(id: string): Promise<{ group: GroupDetail }> {
  return apiFetch(`/api/groups/${id}`);
}

export function createGroup(input: GroupInput): Promise<{ group: GroupDetail; generated: Generated }> {
  return apiFetch("/api/groups", { method: "POST", body: JSON.stringify(input) });
}

export function updateGroup(
  id: string,
  input: Partial<GroupInput>,
): Promise<{ group: GroupDetail; generated: Generated }> {
  return apiFetch(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveGroup(id: string): Promise<{ group: GroupDetail; generated: Generated }> {
  return apiFetch(`/api/groups/${id}/archive`, { method: "POST" });
}

export function restoreGroup(id: string): Promise<{ group: GroupDetail; generated: Generated }> {
  return apiFetch(`/api/groups/${id}/restore`, { method: "POST" });
}

export function deleteGroup(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/groups/${id}`, { method: "DELETE" });
}

export function addGroupMembers(
  id: string,
  input: { student_ids: string[]; joined_on?: string; allow_over_capacity?: boolean },
): Promise<{ added: number; group: GroupDetail }> {
  return apiFetch(`/api/groups/${id}/members`, { method: "POST", body: JSON.stringify(input) });
}

export function removeGroupMember(
  id: string,
  studentId: string,
  input: { left_on?: string; reason?: string | null } = {},
): Promise<{ group: GroupDetail }> {
  return apiFetch(`/api/groups/${id}/members/${studentId}`, {
    method: "DELETE",
    body: JSON.stringify(input),
  });
}

export function updateGroupMember(
  id: string,
  studentId: string,
  input: { price_minor?: number | null; joined_on?: string },
): Promise<{ group: GroupDetail }> {
  return apiFetch(`/api/groups/${id}/members/${studentId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function getGroupMoney(id: string, month?: string): Promise<GroupMoney> {
  return apiFetch(`/api/groups/${id}/money${month ? `?month=${month}` : ""}`);
}

/** A student added by mistake: the membership and its unpaid charges go (`credited_minor` = paid money now credit). */
export function undoGroupMember(id: string, studentId: string): Promise<{ group: GroupDetail; credited_minor: number }> {
  return apiFetch(`/api/groups/${id}/members/${studentId}/undo`, { method: "POST" });
}

export function moveGroupMember(
  id: string,
  studentId: string,
  input: { to_group_id: string; on?: string; allow_over_capacity?: boolean },
): Promise<{ group: GroupDetail; to_group_id: string }> {
  return apiFetch(`/api/groups/${id}/members/${studentId}/move`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listGroupLessons(
  id: string,
  params: { from?: string; to?: string } = {},
): Promise<{ lessons: GroupLesson[]; from: string; to: string }> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const query = qs.toString();
  return apiFetch(`/api/groups/${id}/lessons${query ? `?${query}` : ""}`);
}

export function addGroupLesson(
  id: string,
  input: { local_datetime: string; duration_minutes: number; timezone?: string; teacher_id?: string; topic?: string | null },
): Promise<{ lesson: GroupLesson; warnings: SchedulingWarning[] }> {
  return apiFetch(`/api/groups/${id}/lessons`, { method: "POST", body: JSON.stringify(input) });
}

export function getGroupLesson(id: string): Promise<GroupLessonSheet> {
  return apiFetch(`/api/group-lessons/${id}`);
}

export function saveGroupAttendance(
  id: string,
  input: {
    entries: { student_id: string; status: GroupAttendanceStatus; note?: string | null }[];
    topic?: string | null;
    homework?: string | null;
    notes?: string | null;
    override_timing?: boolean;
  },
): Promise<GroupLessonSheet> {
  return apiFetch(`/api/group-lessons/${id}/attendance`, { method: "POST", body: JSON.stringify(input) });
}

export function revertGroupLesson(id: string): Promise<GroupLessonSheet> {
  return apiFetch(`/api/group-lessons/${id}/attendance/revert`, { method: "POST" });
}

export function cancelGroupLesson(id: string, reason?: string | null): Promise<GroupLessonSheet> {
  return apiFetch(`/api/group-lessons/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export function rescheduleGroupLesson(
  id: string,
  input: { local_datetime?: string; duration_minutes?: number; teacher_id?: string; timezone?: string },
): Promise<GroupLessonSheet & { warnings: SchedulingWarning[] }> {
  return apiFetch(`/api/group-lessons/${id}/reschedule`, { method: "POST", body: JSON.stringify(input) });
}

// ── The section's cross-group pages (GroupBoardController) ─────────────────────

export interface BoardLesson extends GroupLesson {
  group: { id: string; name: string; level: string | null; timezone: string; mode: GroupMode; location: string | null };
}

export function listBoardLessons(params: {
  view: "day" | "week" | "owed";
  date?: string;
  group_id?: string;
  teacher_id?: string;
}): Promise<{ view: string; from: string; to: string; timezone: string; lessons: BoardLesson[] }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return apiFetch(`/api/group-lessons?${qs.toString()}`);
}

/** The sidebar counter: group sheets owed, and today's group lessons. */
export function getGroupLessonsSummary(): Promise<{ owed: number; today: number }> {
  return apiFetch("/api/group-lessons/summary");
}

export interface BoardMember {
  id: string;
  group_id: string;
  group_name: string;
  group_level: string | null;
  teacher_id: string;
  teacher_name: string | null;
  student_id: string;
  full_name: string;
  guardian_name: string | null;
  student_removed: boolean;
  joined_on: string;
  left_on: string | null;
  status: "ACTIVE" | "LEFT";
  /** Why they left: "PAUSED[: note]", "STOPPED[: note]" or free text ("Moved to A2"). */
  left_reason: string | null;
  /** Listed for one student: true when it can still be undone as a mistake (nothing held, no closed bill). */
  deletable?: boolean | null;
  attendance: MemberAttendance;
  /** Newest first, at most five. */
  recent: GroupAttendanceStatus[];
  absent_streak: number;
  /** This month's group charge — null for whoever cannot see money, or when nothing was charged. */
  charge: { currency: string; billed_minor: number; outstanding_minor: number } | null;
}

export type MemberFlag = "absent_streak" | "low_attendance" | "unpaid";

export function listBoardMembers(params: {
  status?: "ACTIVE" | "LEFT" | "ALL";
  flag?: MemberFlag;
  group_id?: string;
  teacher_id?: string;
  student_id?: string;
  q?: string;
} = {}): Promise<{ members: BoardMember[]; thresholds: { streak: number; low_rate: number }; sees_money: boolean }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const query = qs.toString();
  return apiFetch(`/api/group-members${query ? `?${query}` : ""}`);
}

export interface GroupPaymentsRow {
  id: string;
  name: string;
  level: string | null;
  teacher_name: string | null;
  billing_mode: GroupBillingMode;
  price_minor: number | null;
  currency: string | null;
  money: {
    currency: string;
    billed_minor: number;
    paid_minor: number;
    outstanding_minor: number;
    charges: number;
    /** null for whoever cannot read payroll. */
    teacher_cost_minor: number | null;
  }[];
}

export interface GroupPayments {
  month: string;
  groups: GroupPaymentsRow[];
  totals: { currency: string; billed_minor: number; paid_minor: number; outstanding_minor: number; teacher_cost_minor: number }[];
  unpaid: {
    line_id: string;
    group_id: string;
    group_name: string;
    student_id: string | null;
    student_name: string | null;
    description: string;
    amount_minor: number;
    /** What receipts have paid on it and what is left (exact on receipts; else 0 / the amount). */
    paid_minor?: number;
    remaining_minor?: number;
    currency: string;
    invoice_status: string;
  }[];
  sees_teacher_cost: boolean;
  /** The academy is on receipts (accounting): paid amounts are exact, partial payments included. */
  accounting?: boolean;
}

export function getGroupPayments(month?: string): Promise<GroupPayments> {
  return apiFetch(`/api/group-payments${month ? `?month=${month}` : ""}`);
}

export interface ReportLessons {
  held: number;
  cancelled: number;
  owed: number;
  upcoming: number;
  minutes: number;
}

export interface ReportAttendance {
  marked: number;
  came: number;
  absent: number;
  excused: number;
  rate: number | null;
}

export interface GroupReports {
  from: string;
  to: string;
  totals: { groups: number; members: number; capacity: number | null; lessons: ReportLessons; attendance: ReportAttendance };
  groups: {
    id: string;
    name: string;
    level: string | null;
    teacher_name: string | null;
    status: "ACTIVE" | "ARCHIVED";
    members: number;
    capacity: number | null;
    occupancy: number | null;
    lessons: ReportLessons;
    attendance: ReportAttendance;
    /** null for whoever cannot see money. */
    billed: { currency: string; amount_minor: number }[] | null;
  }[];
  teachers: { id: string; name: string | null; groups: number; lessons: ReportLessons; attendance: ReportAttendance }[];
}

export function getGroupReports(params: { from?: string; to?: string } = {}): Promise<GroupReports> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const query = qs.toString();
  return apiFetch(`/api/group-reports${query ? `?${query}` : ""}`);
}
