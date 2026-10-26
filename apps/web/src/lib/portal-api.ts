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

export interface PortalChild {
  id: string;
  name: string;
  teachers: { name: string; course: string | null }[];
  groups: { name: string; teacher: string | null }[];
  packages: {
    label: string;
    course: string | null;
    total_minutes: number;
    remaining_minutes: number;
    expires_on: string | null;
  }[];
  month: { attended: number; absent: number; minutes: number };
  next_lesson: PortalLesson | null;
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
}
