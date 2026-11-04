/**
 * A learning centre's private subscriptions (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md,
 * "API contract") — the client for /api/subscriptions*.
 *
 * Kept out of `api.ts` the way `groups-api.ts` is: its own module behind its own switch (`centre`).
 * A subscription is a block of LESSONS sold for a subject (teacher + course) — never minutes, never
 * an hour clock — and its money moves only when the desk sells, edits or closes it. None of these
 * types are shared with the Quran academy's lesson packages, which keep serving `/packages*`.
 */
import { apiFetch } from "@/lib/api";

export type SubscriptionStatus = "OPEN" | "FINISHED" | "CLOSED" | "CANCELLED";
export type SubscriptionSettlementMode = "CREDIT" | "REFUND" | "KEEP";
export type SubscriptionSettlement = null | "PENDING" | SubscriptionSettlementMode;
/** The four pages of the subscriptions screen, each its own sidebar row. */
export type SubscriptionView = "open" | "due" | "finished" | "outside";
export type SubscriptionReminderKind = "PAYMENT" | "FINISHED";

export interface SubscriptionRow {
  id: string;
  sequence_no: number;
  student: { id: string; full_name: string; guardian_id: string | null; guardian_name: string | null; is_self_guardian: boolean };
  /** Null = untied: any lesson of a student with one teacher. */
  teacher: { id: string; full_name: string } | null;
  course: string | null;
  label: string;
  lessons_sold: number;
  lessons_used: number;
  lessons_left: number;
  /** The expected lesson length — display and timetable default only; a lesson counts one whatever it ran. */
  lesson_minutes: number | null;
  lesson_price_minor: number;
  price_minor: number;
  currency: string;
  starts_on: string;
  status: SubscriptionStatus;
  finished_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  closed_by_name: string | null;
  invoice_id: string | null;
  invoice_line_id: string | null;
  invoice_paid_minor: number;
  outstanding_minor: number;
  settlement: SubscriptionSettlement;
  settlement_minor: number | null;
  /** This subject's timetable. */
  next_lesson_at: string | null;
  upcoming_lesson_count: number;
  /** Lessons attended after it finished, not yet on any block. */
  outside_count: number;
  /** Pay-first: an earlier line of this subject is unpaid, so the next sale waits. */
  renewal_held: boolean;
  /** Nothing counted and nothing paid: it can be cancelled outright. */
  deletable: boolean;
  opened_by_name: string | null;
  created_at: string;
}

export interface SubscriptionSummary {
  open: number;
  finished_unrenewed: number;
  outside_students: number;
  due_count: number;
  outstanding: { currency: string; minor: number }[];
  /** Open blocks with two lessons or fewer left. */
  ending: number;
}

/** One of a student's subjects, from the picker's point of view. */
export interface StudentPickSubject {
  teacher_id: string;
  teacher_name: string;
  course: string | null;
  open_subscription_id: string | null;
}

export interface StudentPick {
  id: string;
  full_name: string;
  guardian_name: string | null;
  status: string;
  subjects: StudentPickSubject[];
  /** Teachers this student has a timetable with. */
  has_timetable_for: string[];
}

export interface SellInput {
  student_id: string;
  teacher_id?: string | null;
  course?: string | null;
  /** The teacher is not yet one of the student's: link them as the block opens. */
  new_subject?: boolean;
  label?: string;
  lessons_sold: number;
  lesson_minutes?: number | null;
  lesson_price_minor: number;
  /** Default sold × price. */
  price_minor?: number;
  /** Default: the family's. */
  currency?: string;
  /** Default: the first outside lesson of this subject, else today. */
  starts_on?: string;
  override_pay_first?: boolean;
}

/** `SellInput` without the student: what POST /students and the enrolment wizard carry. */
export type SellTerms = Omit<SellInput, "student_id">;

export interface EditInput {
  label?: string;
  teacher_id?: string | null;
  course?: string | null;
  lessons_sold?: number;
  lesson_minutes?: number | null;
  lesson_price_minor?: number;
  price_minor?: number;
  starts_on?: string;
}

export interface SubscriptionLessonRow {
  session_id: string;
  scheduled_at_utc: string;
  duration_minutes: number;
  teacher_name: string | null;
  status: string;
  counted_at: string | null;
  /** 1..sold on the block; null for one attended outside it. */
  number: number | null;
}

export interface SubscriptionSettlementPreview {
  paid_minor: number;
  used_value_minor: number;
  owed_back_minor: number;
  currency: string;
  can_refund: boolean;
}

export interface SubscriptionRefund {
  method: string;
  reference?: string | null;
  note?: string | null;
}

export interface CloseInput {
  reason: string;
  settlement?: SubscriptionSettlementMode;
  refund?: SubscriptionRefund;
  /** Why the academy keeps the money (KEEP), or a word on the credit. Web addition — see the doc's "web needs". */
  settlement_note?: string | null;
}

export interface SubscriptionListFilters {
  view?: SubscriptionView;
  student_id?: string;
  teacher_id?: string;
  q?: string;
  page?: number;
  per_page?: number;
}

export interface SubscriptionListResponse {
  rows: SubscriptionRow[];
  summary: SubscriptionSummary;
  meta: { current_page: number; last_page: number; per_page: number; total: number };
}

export function listSubscriptions(filters: SubscriptionListFilters = {}): Promise<SubscriptionListResponse> {
  const params = new URLSearchParams();
  if (filters.view) params.set("view", filters.view);
  if (filters.student_id) params.set("student_id", filters.student_id);
  if (filters.teacher_id) params.set("teacher_id", filters.teacher_id);
  if (filters.q) params.set("q", filters.q);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.per_page) params.set("per_page", String(filters.per_page));
  const qs = params.toString();
  return apiFetch(`/api/subscriptions${qs ? `?${qs}` : ""}`);
}

export function getSubscriptionsSummary(): Promise<SubscriptionSummary> {
  return apiFetch("/api/subscriptions/summary");
}

/** Every active student with their subjects — who a block can be sold to. */
export function listSubscriptionStudents(q?: string): Promise<{ rows: StudentPick[] }> {
  return apiFetch(`/api/subscriptions/students${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export interface SellResult {
  subscription: SubscriptionRow;
  invoice_id: string | null;
  due_minor: number;
  warnings: string[];
}

export function sellSubscription(input: SellInput): Promise<SellResult> {
  return apiFetch("/api/subscriptions", { method: "POST", body: JSON.stringify(input) });
}

export function getSubscription(id: string): Promise<{ subscription: SubscriptionRow; lessons: SubscriptionLessonRow[] }> {
  return apiFetch(`/api/subscriptions/${id}`);
}

export interface EditResult {
  subscription: SubscriptionRow;
  invoice_id: string | null;
  /** Money the re-issued line gave back to the family's credit. */
  credited_minor: number;
  /** What a dearer block leaves owed. */
  due_minor: number;
  /** Lessons that followed the block to its new teacher / course / start. */
  moved_lessons: number;
}

export function updateSubscription(id: string, input: EditInput): Promise<EditResult> {
  return apiFetch(`/api/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function getSubscriptionSettlement(id: string): Promise<SubscriptionSettlementPreview> {
  return apiFetch(`/api/subscriptions/${id}/settlement`);
}

export interface CloseResult {
  subscription: SubscriptionRow;
  settlement: { mode: SubscriptionSettlementMode; amount_minor: number; currency: string; expense_number?: string | null } | null;
}

export function closeSubscription(id: string, input: CloseInput): Promise<CloseResult> {
  return apiFetch(`/api/subscriptions/${id}/close`, { method: "POST", body: JSON.stringify(input) });
}

/** Only while nothing was counted and nothing paid; voids the bill line. */
export function cancelSubscription(id: string, note?: string): Promise<void> {
  return apiFetch(`/api/subscriptions/${id}/cancel`, { method: "POST", body: JSON.stringify({ note: note || undefined }) });
}

export function remindSubscription(id: string, kind: SubscriptionReminderKind): Promise<{ sent: boolean; preview: string }> {
  return apiFetch(`/api/subscriptions/${id}/remind`, { method: "POST", body: JSON.stringify({ kind }) });
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** The lesson lengths a centre sells, shortest first. */
export const SUBSCRIPTION_LESSON_LENGTHS = [15, 20, 30, 40, 45, 60, 90, 120];

/** One subject of a student: a teacher and what they teach them (a teacher can teach them two). */
export function subscriptionSubjectKey(teacherId: string | null | undefined, course?: string | null): string {
  return teacherId ? `${teacherId}::${(course ?? "").trim().toLowerCase()}` : "";
}

/** The scope a row belongs to — the same key the pickers use. */
export function subscriptionScope(row: Pick<SubscriptionRow, "teacher" | "course">): string {
  return subscriptionSubjectKey(row.teacher?.id ?? null, row.course);
}

/** The subject as the desk says it: "English · Mr Ali", or the teacher alone, or nothing for an untied block. */
export function subscriptionSubjectText(row: Pick<SubscriptionRow, "teacher" | "course">): string {
  return [row.course, row.teacher?.full_name].filter(Boolean).join(" · ");
}
