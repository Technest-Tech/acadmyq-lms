import type {
  AcademyStatus,
  HealthResponse,
  InvoiceGrouping,
  ReportFieldType,
  SessionStatus,
} from "@academiq/contracts";

/**
 * Typed HTTP client for the Laravel JSON API.
 *
 * Auth strategy is decided in Sprint 0 and pinned via NEXT_PUBLIC_AUTH_MODE so
 * the contract does not change in Sprint 2:
 *  - "cookie" (default): Sanctum SPA cookie auth — requires a shared registrable
 *    parent domain (app.academiq.com + api.academiq.com). Sends credentials and,
 *    for writes, primes + echoes the XSRF-TOKEN (Sprint 2 §2, §11).
 *  - "token": Sanctum bearer-token fallback when a shared parent domain is not
 *    available — attaches an Authorization header.
 *
 * No business logic lives here; this is a transport wrapper only.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const AUTH_MODE: "cookie" | "token" =
  process.env.NEXT_PUBLIC_AUTH_MODE === "token" ? "token" : "cookie";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Sprint 2 replaces this with the real Sanctum token source (token mode only). */
function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("auth_token");
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * Sanctum SPA writes must carry the XSRF-TOKEN cookie back as an X-XSRF-TOKEN
 * header. Prime the cookie once (GET /sanctum/csrf-cookie) if it isn't present.
 */
async function ensureCsrfCookie(): Promise<void> {
  if (AUTH_MODE !== "cookie") return;
  if (readCookie("XSRF-TOKEN")) return;
  await fetch(`${BASE_URL}/sanctum/csrf-cookie`, { credentials: "include" });
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (AUTH_MODE === "token") {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } else if (MUTATING.has(method)) {
    await ensureCsrfCookie();
    const xsrf = readCookie("XSRF-TOKEN");
    if (xsrf) headers.set("X-XSRF-TOKEN", xsrf);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    // Cookie mode needs credentials for the Sanctum session cookie + CSRF.
    credentials: AUTH_MODE === "cookie" ? "include" : "same-origin",
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const message =
      (body as { message?: string } | undefined)?.message ??
      `Request to ${path} failed`;
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

// ── Auth surface (Sprint 2 §8) ───────────────────────────────────────────────

export type AppRole = "SUPER_ADMIN" | "ACADEMY_OWNER" | "TEACHER";

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
}

export interface Session {
  user: SessionUser;
  role: AppRole;
  academyId: string | null;
  permissions: string[];
  locale: "ar" | "en";
}

export interface LoginResult {
  role: AppRole;
  academyId: string | null;
}

/** POST /api/auth/login — email/password → established Sanctum session. */
export function login(email: string, password: string): Promise<LoginResult> {
  return apiFetch<LoginResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** POST /api/auth/logout — invalidate the session. */
export function logout(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

/** GET /api/auth/me — the resolved identity, role, academy, permissions, locale. */
export function getMe(): Promise<Session> {
  return apiFetch<Session>("/api/auth/me");
}

/** PATCH /api/auth/locale — persist the user's language; returns layout direction. */
export function setLocale(
  locale: "ar" | "en",
): Promise<{ locale: "ar" | "en"; dir: "rtl" | "ltr" }> {
  return apiFetch("/api/auth/locale", {
    method: "PATCH",
    body: JSON.stringify({ locale }),
  });
}

/** POST /api/admin/academies/exit — Super Admin returns to the platform view. */
export function exitAcademy(): Promise<{ ok: boolean }> {
  return apiFetch("/api/admin/academies/exit", { method: "POST" });
}

// ── Academy management surface (Sprint 3 §7) ─────────────────────────────────

/** A row in the Super Admin platform list (audited app.admin_list_academies). */
export interface AcademyListItem {
  id: string;
  name: string;
  status: AcademyStatus;
  plan_id: string | null;
  plan_code: string | null;
  default_currency: string;
  timezone: string;
  invoice_grouping: InvoiceGrouping;
  subdomain: string | null;
  student_count: number;
  teacher_count: number;
}

export interface AcademyType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  reportFieldTemplate: ReportFieldTemplateItem[];
}

export interface ReportFieldTemplateItem {
  key: string;
  label_ar: string;
  label_en: string;
  field_type: ReportFieldType;
  options: string[] | null;
  is_required: boolean;
}

/** A persisted, per-academy report-field definition. */
export interface ReportField {
  id: string;
  academy_id: string;
  key: string;
  label_ar: string;
  label_en: string;
  field_type: ReportFieldType;
  options: string[] | null;
  sort_order: number;
  is_required: boolean;
  is_active: boolean;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  price_minor: number;
  currency: string;
  is_active: boolean;
}

/** The wizard payload for creating an academy + seeding fields + first owner. */
export interface CreateAcademyInput {
  name: string;
  academy_type_id: string;
  plan_id?: string | null;
  default_currency: string;
  timezone: string;
  invoice_grouping?: InvoiceGrouping;
  billing_day?: number;
  status?: "ACTIVE" | "TRIAL";
  brand_display_name?: string | null;
  brand_logo_url?: string | null;
  subdomain?: string | null;
  owner_full_name: string;
  owner_email: string;
}

export function listAcademies(): Promise<{ academies: AcademyListItem[] }> {
  return apiFetch("/api/admin/academies");
}

export function getAcademyTypes(): Promise<{ academyTypes: AcademyType[] }> {
  return apiFetch("/api/admin/academy-types");
}

export function getAcademy(
  id: string,
): Promise<{ academy: Record<string, unknown> }> {
  return apiFetch(`/api/admin/academies/${id}`);
}

export function createAcademy(
  input: CreateAcademyInput,
): Promise<{ academyId: string; ownerId: string; reportFields: number }> {
  return apiFetch("/api/admin/academies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAcademy(
  id: string,
  patch: Partial<CreateAcademyInput>,
): Promise<{ ok: boolean; changed: string[]; warning: string | null }> {
  return apiFetch(`/api/admin/academies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function suspendAcademy(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/api/admin/academies/${id}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function reactivateAcademy(
  id: string,
): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/api/admin/academies/${id}/reactivate`, { method: "POST" });
}

export function listReportFields(
  academyId: string,
): Promise<{ reportFields: ReportField[] }> {
  return apiFetch(`/api/academies/${academyId}/report-fields`);
}

export interface ReportFieldInput {
  key?: string;
  label_ar?: string;
  label_en?: string;
  field_type?: ReportFieldType;
  options?: string[] | null;
  sort_order?: number;
  is_required?: boolean;
  is_active?: boolean;
}

export function addReportField(
  academyId: string,
  input: ReportFieldInput,
): Promise<{ reportFieldId: string }> {
  return apiFetch(`/api/academies/${academyId}/report-fields`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateReportField(
  academyId: string,
  fieldId: string,
  patch: ReportFieldInput,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/academies/${academyId}/report-fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteReportField(
  academyId: string,
  fieldId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/academies/${academyId}/report-fields/${fieldId}`, {
    method: "DELETE",
  });
}

export function listPlans(): Promise<{ plans: Plan[]; addOns: unknown[] }> {
  return apiFetch("/api/admin/plans");
}

// ── People: the server-driven DataTable contract (Sprint 4 §6.2) ─────────────

/** A page of a server-driven list: the rows plus the total for pagination. */
export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The query a DataTable sends; serialised to ?search=&filter[k]=&sort=&page=&pageSize=. */
export interface DataTableQuery {
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  filter?: Record<string, string>;
}

/** Serialise a DataTableQuery to a query string (omitting empties). */
export function toQueryString(q: DataTableQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set("search", q.search);
  if (q.sort) params.set("sort", q.sort);
  if (q.page) params.set("page", String(q.page));
  if (q.pageSize) params.set("pageSize", String(q.pageSize));
  for (const [k, v] of Object.entries(q.filter ?? {})) {
    if (v !== "" && v != null) params.set(`filter[${k}]`, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

// ── Guardians (Sprint 4 §8) ──────────────────────────────────────────────────

export interface GuardianRow {
  id: string;
  full_name: string;
  whatsapp_phone: string;
  country: string | null;
  currency: string;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface GuardianChild {
  id: string;
  full_name: string;
  whatsapp_phone: string | null;
  status: string | null;
  is_self_guardian: boolean;
  deleted_at: string | null;
}

export interface GuardianInput {
  full_name?: string;
  whatsapp_phone?: string;
  country?: string | null;
  currency?: string | null;
  notes?: string | null;
}

export function listGuardians(
  q: DataTableQuery = {},
): Promise<ListResult<GuardianRow>> {
  return apiFetch(`/api/guardians${toQueryString(q)}`);
}

export function getGuardian(
  id: string,
): Promise<{ guardian: GuardianRow; children: GuardianChild[] }> {
  return apiFetch(`/api/guardians/${id}`);
}

export function createGuardian(
  input: GuardianInput,
): Promise<{ guardianId: string }> {
  return apiFetch("/api/guardians", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateGuardian(
  id: string,
  patch: GuardianInput,
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/guardians/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deactivateGuardian(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/guardians/${id}/deactivate`, { method: "POST" });
}

// ── Teachers (Sprint 4 §8) ───────────────────────────────────────────────────

export interface AvailabilityWindow {
  weekday: number;
  start_local: string;
  end_local: string;
}

export interface TeacherRow {
  id: string;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  specialization: string | null;
  session_rate_minor: number;
  currency: string;
  timezone: string | null;
  availability: AvailabilityWindow[];
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface TeacherStudent {
  id: string;
  full_name: string;
  started_at: string;
}

export interface TeacherInput {
  full_name?: string;
  phone?: string | null;
  specialization?: string | null;
  session_rate_minor?: number;
  currency?: string | null;
  timezone?: string | null;
  availability?: AvailabilityWindow[];
  create_login?: boolean;
  email?: string | null;
}

export function listTeachers(
  q: DataTableQuery = {},
): Promise<ListResult<TeacherRow>> {
  return apiFetch(`/api/teachers${toQueryString(q)}`);
}

export function getTeacher(
  id: string,
): Promise<{ teacher: TeacherRow; students: TeacherStudent[] }> {
  return apiFetch(`/api/teachers/${id}`);
}

export function createTeacher(
  input: TeacherInput,
): Promise<{ teacherId: string; userId: string | null }> {
  return apiFetch("/api/teachers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTeacher(
  id: string,
  patch: TeacherInput,
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/teachers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deactivateTeacher(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/teachers/${id}/deactivate`, { method: "POST" });
}

// ── Students, subscriptions & teacher assignment (Sprint 4 §8) ───────────────

export interface StudentRow {
  id: string;
  full_name: string;
  whatsapp_phone: string | null;
  status: string | null;
  is_self_guardian: boolean;
  guardian_id: string;
  guardian_name: string | null;
  subscription_id: string | null;
  price_minor: number | null;
  price_currency: string | null;
  price_basis: string | null;
  plan_label: string | null;
  sessions_per_month: number | null;
  start_date: string | null;
  subscription_status: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface SubscriptionInput {
  plan_label: string;
  sessions_per_month?: number | null;
  price_minor: number;
  currency?: string | null;
  price_basis?: "PER_SESSION" | "PER_MONTH";
  start_date: string;
}

export interface StudentInput {
  full_name?: string;
  whatsapp_phone?: string | null;
  country?: string | null;
  status?: string | null;
  notes?: string | null;
  is_self_guardian?: boolean;
  guardian_id?: string | null;
  currency?: string | null;
  teacher_id?: string | null;
  subscription?: SubscriptionInput;
}

export interface StudentDetail {
  student: Record<string, unknown> & {
    id: string;
    full_name: string;
    guardian_id: string;
    is_self_guardian: boolean;
    status: string | null;
  };
  guardian: GuardianRow | null;
  subscription:
    | (Record<string, unknown> & {
        id: string;
        price_minor: number;
        currency: string;
        price_basis: string;
        plan_label: string;
        sessions_per_month: number | null;
        start_date: string;
      })
    | null;
  currentTeacher: {
    teacher_id: string;
    teacher_name: string | null;
    started_at: string;
  } | null;
}

export interface TeacherAssignmentHistoryItem {
  id: string;
  teacher_id: string;
  teacher_name: string | null;
  started_at: string;
  ended_at: string | null;
}

export function listStudents(
  q: DataTableQuery = {},
): Promise<ListResult<StudentRow>> {
  return apiFetch(`/api/students${toQueryString(q)}`);
}

export function getStudent(id: string): Promise<StudentDetail> {
  return apiFetch(`/api/students/${id}`);
}

export function createStudent(
  input: StudentInput,
): Promise<{ studentId: string; guardianId: string }> {
  return apiFetch("/api/students", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateStudent(
  id: string,
  patch: StudentInput,
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/students/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deactivateStudent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/students/${id}/deactivate`, { method: "POST" });
}

export function setSubscription(
  studentId: string,
  input: SubscriptionInput,
): Promise<{ subscriptionId: string }> {
  return apiFetch(`/api/students/${studentId}/subscription`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function changeSubscriptionPrice(
  studentId: string,
  input: {
    price_minor: number;
    currency?: string;
    price_basis?: "PER_SESSION" | "PER_MONTH";
  },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/students/${studentId}/subscription/price`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function reassignTeacher(
  studentId: string,
  input: { teacher_id: string; effective_date?: string },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/students/${studentId}/teacher`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getTeacherHistory(
  studentId: string,
): Promise<{ history: TeacherAssignmentHistoryItem[] }> {
  return apiFetch(`/api/students/${studentId}/teacher-history`);
}

// ── Scheduling & sessions (Sprint 5 §8) ──────────────────────────────────────

/** A per-weekday slot of a recurring schedule (local wall-clock + duration). */
export interface ScheduleSlot {
  id?: string;
  weekday: number; // 0=Sun … 6=Sat
  start_time_local: string; // "17:00" or "17:00:00"
  duration_minutes: number;
}

export interface Schedule {
  id: string;
  student_id: string;
  teacher_id: string;
  timezone: string;
  is_active: boolean;
  version: number;
}

export interface ScheduleInput {
  timezone?: string;
  teacher_id?: string | null;
  slots: ScheduleSlot[];
}

/** Counts returned by every generation run (idempotent: re-running yields 0/0). */
export interface GenerateCounts {
  created: number;
  removed: number;
}

/** A soft, non-blocking guidance warning surfaced on create/reschedule (§3.7). */
export interface SchedulingWarning {
  type: "conflict" | "availability";
  message: string;
  detail?: unknown;
}

/** One materialised occurrence as the calendar feed returns it (UTC instant). */
export interface CalendarSession {
  id: string;
  student_id: string;
  teacher_id: string;
  schedule_id: string | null;
  scheduled_at_utc: string;
  duration_minutes: number;
  status: SessionStatus;
  status_reason: string | null;
  original_session_id: string | null;
  student_name: string | null;
  teacher_name: string | null;
}

export function getStudentSchedule(
  studentId: string,
): Promise<{ schedule: Schedule | null; slots: ScheduleSlot[] }> {
  return apiFetch(`/api/students/${studentId}/schedule`);
}

export function putStudentSchedule(
  studentId: string,
  input: ScheduleInput,
): Promise<{ scheduleId: string; generated: GenerateCounts }> {
  return apiFetch(`/api/students/${studentId}/schedule`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteStudentSchedule(
  studentId: string,
): Promise<{ ok: boolean; generated: GenerateCounts }> {
  return apiFetch(`/api/students/${studentId}/schedule`, { method: "DELETE" });
}

export interface CalendarQuery {
  from: string; // Y-m-d
  to: string; // Y-m-d
  teacherId?: string;
  studentId?: string;
}

export function getCalendar(
  q: CalendarQuery,
): Promise<{ sessions: CalendarSession[]; from: string; to: string }> {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  if (q.teacherId) params.set("teacherId", q.teacherId);
  if (q.studentId) params.set("studentId", q.studentId);
  return apiFetch(`/api/calendar?${params.toString()}`);
}

export interface SessionInput {
  student_id: string;
  teacher_id?: string | null;
  scheduled_at_utc?: string;
  local_datetime?: string;
  timezone?: string;
  duration_minutes: number;
}

export function createSession(
  input: SessionInput,
): Promise<{ sessionId: string; warnings: SchedulingWarning[] }> {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface RescheduleInput {
  scheduled_at_utc?: string;
  local_datetime?: string;
  timezone?: string;
  duration_minutes?: number;
  reason?: string;
}

export function rescheduleSession(
  sessionId: string,
  input: RescheduleInput,
): Promise<{
  sessionId: string;
  originalSessionId: string;
  warnings: SchedulingWarning[];
}> {
  return apiFetch(`/api/sessions/${sessionId}/reschedule`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function cancelSession(
  sessionId: string,
  input: { cancelled_by: "teacher" | "student"; reason?: string },
): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/api/sessions/${sessionId}/cancel`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function generateSessions(
  input: { from?: string; to?: string } = {},
): Promise<{ generated: GenerateCounts }> {
  return apiFetch("/api/admin/generate-sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
