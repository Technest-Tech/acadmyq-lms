/**
 * The centre's public enrolment form (docs/centre-profile Phase 2 §6) — the API client for
 * /api/enrolment (the staff card and inbox) and the shape of the public page's data (/api/e/{token}).
 *
 * Kept out of `api.ts` like `groups-api.ts`: a centre feature behind its own switch (`centre`).
 * The public page does not use `apiFetch` (no session, no CSRF cookie); its calls live beside it in
 * `app/e/[token]` and only share these types.
 */
import { apiFetch } from "@/lib/api";

// ── The form and its link ────────────────────────────────────────────────────

/** What the form says and asks; the staff card and the public page read the same keys. */
export interface EnrolmentFormSettings {
  title: string;
  intro: string | null;
  is_open: boolean;
  ask_subject: boolean;
  ask_level: boolean;
  ask_schedule: boolean;
  success_message: string | null;
}

export interface EnrolmentForm extends EnrolmentFormSettings {
  id: string;
  /** The public link, on the academy's own address. */
  url: string;
  created_at: string;
  updated_at: string;
}

export function getEnrolmentForm(): Promise<{ form: EnrolmentForm }> {
  return apiFetch("/api/enrolment/form");
}

export function updateEnrolmentForm(patch: Partial<EnrolmentFormSettings>): Promise<{ form: EnrolmentForm }> {
  return apiFetch("/api/enrolment/form", { method: "PATCH", body: JSON.stringify(patch) });
}

/** A new link; the old one answers 404 from now on. */
export function rotateEnrolmentToken(): Promise<{ form: EnrolmentForm }> {
  return apiFetch("/api/enrolment/form/rotate-token", { method: "POST" });
}

// ── The inbox ────────────────────────────────────────────────────────────────

export const ENROLMENT_STATUSES = ["NEW", "CONTACTED", "PLACEMENT_BOOKED", "ENROLLED", "CLOSED"] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

export interface EnrolmentRequest {
  id: string;
  student_name: string;
  guardian_name: string | null;
  /** E.164. */
  phone: string;
  email: string | null;
  age: number | null;
  subject_id: string | null;
  /** The subject picked from the list, or typed. */
  subject: string | null;
  level: string | null;
  /** Weekday ints, 0 = Sunday … 6 = Saturday. */
  preferred_days: number[];
  /** HH:MM on the academy's clock. */
  preferred_time: string | null;
  message: string | null;
  source: string;
  status: EnrolmentStatus;
  staff_note: string | null;
  handled_by: string | null;
  trial: {
    id: string;
    scheduled_at_utc: string | null;
    status: string | null;
    teacher_name: string | null;
  } | null;
  student: { id: string; name: string } | null;
  status_changed_at: string;
  created_at: string;
}

export interface EnrolmentInbox {
  rows: EnrolmentRequest[];
  counts: Record<EnrolmentStatus, number>;
}

export function listEnrolmentRequests(params: { status?: EnrolmentStatus | ""; q?: string } = {}): Promise<EnrolmentInbox> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q?.trim()) qs.set("q", params.q.trim());
  const s = qs.toString();
  return apiFetch(`/api/enrolment/requests${s ? `?${s}` : ""}`);
}

/** `{new}` — the sidebar badge. */
export function getEnrolmentSummary(): Promise<{ new: number }> {
  return apiFetch("/api/enrolment/requests/summary");
}

export function updateEnrolmentRequest(
  id: string,
  patch: { status?: EnrolmentStatus; staff_note?: string | null },
): Promise<{ request: EnrolmentRequest }> {
  return apiFetch(`/api/enrolment/requests/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export interface PlacementInput {
  teacher_id: string;
  /** "YYYY-MM-DD HH:MM" on the academy's clock. */
  local_datetime: string;
  timezone?: string;
  duration_minutes: number;
}

/** Book the placement lesson: a real trial through the trials board's own writer. */
export function bookPlacement(
  id: string,
  input: PlacementInput,
): Promise<{ trialId: string; warnings: { message: string }[]; request: EnrolmentRequest }> {
  return apiFetch(`/api/enrolment/requests/${id}/placement`, { method: "POST", body: JSON.stringify(input) });
}

// ── The public page ──────────────────────────────────────────────────────────

/** GET /api/e/{token}. */
export interface PublicEnrolmentPayload {
  academy: {
    name: string;
    displayName: string;
    logoUrl: string | null;
    timezone: string;
    /** ISO-2, the dial code the phone field opens on. */
    country: string | null;
  };
  form: EnrolmentFormSettings;
  subjects: { id: string; name: string }[];
}

/** POST /api/e/{token}. */
export interface PublicEnrolmentSubmit {
  student_name: string;
  guardian_name: string | null;
  phone: string;
  email: string | null;
  age: number | null;
  subject_id: string | null;
  subject_text: string | null;
  level_text: string | null;
  preferred_days: number[];
  preferred_time: string | null;
  message: string | null;
  /** The honeypot — always empty from a person. */
  website: string;
}
