import type {
  AcademyStatus,
  HealthResponse,
  InvoiceGrouping,
  ReportFieldType,
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
