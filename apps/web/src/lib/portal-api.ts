/**
 * The parent's page (`/p/{token}`) — one private link per family showing the children, their
 * lessons, reports and the family's bills, with no account and no password.
 *
 * Two halves live here: the staff calls behind the family page's "Parent page" card (make, replace,
 * switch off, WhatsApp the link), and the payload the public page renders — typed once so the
 * server page and its client view agree. Kept out of `api.ts` like `groups-api.ts`.
 */
import { apiFetch } from "@/lib/api";

// ── Staff: the family's link ─────────────────────────────────────────────────

export interface PortalLink {
  /** On the academy's own address; null until the academy makes one. */
  url: string | null;
  issued_at: string | null;
}

export function getPortalLink(guardianId: string): Promise<PortalLink> {
  return apiFetch(`/api/guardians/${guardianId}/portal`);
}

/** Make the link, or with `rotate` replace it — the old link stops working at once. */
export function issuePortalLink(guardianId: string, rotate = false): Promise<PortalLink> {
  return apiFetch(`/api/guardians/${guardianId}/portal`, {
    method: "POST",
    body: JSON.stringify({ rotate }),
  });
}

export function revokePortalLink(guardianId: string): Promise<PortalLink> {
  return apiFetch(`/api/guardians/${guardianId}/portal`, { method: "DELETE" });
}

/** WhatsApp the link from the academy's number; `sent: false` → open wa.me with `message`. */
export function sendPortalLink(guardianId: string): Promise<{
  url: string;
  phone: string;
  message: string;
  transport: string;
  sent: boolean;
}> {
  return apiFetch(`/api/guardians/${guardianId}/portal/send`, { method: "POST" });
}

// ── Public: what the parent's page renders (GuardianPortal::build) ───────────

/** How a lesson went, as a parent reads it — private and group lessons share one vocabulary. */
export type PortalLessonStatus =
  | "SCHEDULED"
  | "ATTENDED"
  | "LATE"
  | "ABSENT"
  | "EXCUSED"
  | "CANCELLED"
  | "CANCELLED_BY_TEACHER"
  | "CANCELLED_BY_STUDENT"
  | "HELD";

export interface PortalReportField {
  label_ar: string;
  label_en: string;
  type: "TEXT" | "TEXTAREA" | "NUMBER" | "SELECT" | "RATING";
  value: string;
}

export interface PortalLesson {
  id: string;
  child_id: string;
  kind: "PRIVATE" | "GROUP";
  group_name: string | null;
  teacher: string | null;
  /** UTC instant, ISO-8601. */
  starts_at: string;
  duration_minutes: number;
  status: PortalLessonStatus;
  /** Private lessons: the teacher's report, null when none was written. */
  report?: PortalReportField[] | null;
  /** Group lessons: what was taught and the homework. */
  topic?: string | null;
  homework?: string | null;
}

/**
 * A child's group as a CENTRE's page shows it (GuardianPortalCentre): the chip's `name`/`teacher`
 * plus the timetable. The extra fields exist only when the academy holds `groups`.
 */
export interface PortalGroup {
  name: string;
  teacher: string | null;
  id?: string;
  level?: string | null;
  teacher_name?: string | null;
  slots?: PortalGroupSlot[];
  /** "YYYY-MM-DD" */
  joined_on?: string;
}

export interface PortalGroupSlot {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** "HH:MM" on the academy's clock. */
  start_time_local: string;
  duration_minutes: number;
}

export type PortalAttendanceMark = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

export interface PortalGroupLesson {
  id: string;
  group_id: string;
  group_name: string;
  /** UTC instant, ISO-8601. */
  starts_at: string;
  duration_minutes: number;
  /** Upcoming lessons carry the lesson's status. */
  status?: string;
  /** Held lessons carry the child's own mark — null when the sheet skipped them. */
  attendance?: PortalAttendanceMark | null;
  topic?: string | null;
  homework?: string | null;
}

/** Marks over the last 30 days; `rate` (percent, late counts as present) is null without a sheet. */
export interface PortalAttendanceSummary {
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number | null;
}

/** Where the family stands on the receipts ledger (academies holding `accounting`). */
export interface PortalFamilyAccount {
  currency: string;
  due_minor: number;
  /** Still owed from a month before this one. */
  overdue_minor: number;
  credit_minor: number;
  recent_receipts: { number: string; received_on: string; amount_minor: number; currency: string; method: string }[];
  /** The family's card-payment page, when a payment can be taken; null otherwise. */
  pay_url: string | null;
}

export interface PortalSubscription {
  label: string;
  teacher_name: string | null;
  course: string | null;
  lessons_sold: number;
  lessons_used: number;
  lessons_left: number;
  status: "OPEN" | "FINISHED" | "CLOSED" | "CANCELLED";
}

export interface PortalChild {
  id: string;
  name: string;
  teachers: { name: string; course: string | null }[];
  groups: PortalGroup[];
  packages: {
    label: string;
    course: string | null;
    total_minutes: number;
    remaining_minutes: number;
    lesson_minutes?: number | null;
    expires_on: string | null;
  }[];
  month: { attended: number; absent: number; minutes: number };
  /** A centre's private subscriptions (docs/centre-profile/01): lessons left of sold per subject; replaces the package bars when present. */
  subscriptions?: PortalSubscription[];
  next_lesson: PortalLesson | null;
  /** A centre's blocks (`groups` held): the week ahead and the latest sheets, and the 30-day marks. */
  group_lessons?: { upcoming: PortalGroupLesson[]; recent: PortalGroupLesson[] };
  attendance_summary?: PortalAttendanceSummary;
  /** Term reports the centre PUBLISHED for this child (docs/centre-profile, Phase 2 §5); the key is absent until one is. */
  term_reports?: PortalTermReport[];
}

/** One graded assessment on a published term report — the parent's view, no staff note. */
export interface PortalTermGrade {
  title: string;
  kind: string;
  held_on: string | null;
  max_score: number;
  weight: number;
  score: number | null;
  absent: boolean;
  /** 0–100; null when not graded. */
  percent: number | null;
}

export interface PortalTermReport {
  group_id: string;
  group_name: string;
  level: string | null;
  teacher_name: string | null;
  /** The membership window the report covers (YYYY-MM-DD). */
  period: { from: string; to: string; left: boolean };
  attendance: { present: number; late: number; absent: number; excused: number; rate: number | null; lessons_held: number };
  grades: PortalTermGrade[];
  total: { weighted_percent: number | null };
  comment: string | null;
  overall_grade: string | null;
  published_at: string;
}

export interface PortalProgressReport {
  id: string;
  child_id: string;
  /** "YYYY-MM" */
  month: string;
  title: string;
  body: string;
  teacher: string | null;
}

export interface PortalInvoice {
  id: string;
  period_year: number;
  period_month: number;
  state: "PAID" | "PARTIAL" | "UNPAID";
  /** The month still running — its bill grows as lessons are taken. */
  running: boolean;
  currency: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  lesson_count: number;
  /** An itemised bill's first line (a package, books…); null for a lessons bill. */
  title: string | null;
  /** Set when the bill is addressed to one child rather than the family. */
  child_name: string | null;
  url: string;
}

export interface PortalPayload {
  academy: { name: string; logo_url: string | null; timezone: string };
  guardian: { name: string };
  children: PortalChild[];
  upcoming: PortalLesson[];
  recent: PortalLesson[];
  progress_reports: PortalProgressReport[];
  invoices: PortalInvoice[];
  balance: { currency: string; due_minor: number }[];
  /** Only for an academy holding `accounting`. */
  family_account?: PortalFamilyAccount;
}
