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
 * header. Prime the cookie (GET /sanctum/csrf-cookie) if it isn't present, or
 * when `force` is set — used to recover from a stale token (419) by fetching a
 * fresh one bound to the current session.
 */
async function ensureCsrfCookie(force = false): Promise<void> {
  if (AUTH_MODE !== "cookie") return;
  if (!force && readCookie("XSRF-TOKEN")) return;
  await fetch(`${BASE_URL}/sanctum/csrf-cookie`, { credentials: "include" });
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const isCookieWrite = AUTH_MODE === "cookie" && MUTATING.has(method);

  async function send(forceCsrf = false): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    if (AUTH_MODE === "token") {
      const token = getAuthToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } else if (isCookieWrite) {
      await ensureCsrfCookie(forceCsrf);
      const xsrf = readCookie("XSRF-TOKEN");
      if (xsrf) headers.set("X-XSRF-TOKEN", xsrf);
    }

    return fetch(`${BASE_URL}${path}`, {
      ...init,
      method,
      headers,
      // Cookie mode needs credentials for the Sanctum session cookie + CSRF.
      credentials: AUTH_MODE === "cookie" ? "include" : "same-origin",
    });
  }

  let response = await send();

  // 419 = CSRF token mismatch. A token can go stale (e.g. the session was reset
  // server-side); re-prime the cookie and retry the write once before failing.
  if (response.status === 419 && isCookieWrite) {
    response = await send(true);
  }

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

/** POST /api/admin/academies/{id}/enter — Super Admin enters an academy's context. */
export function enterAcademy(
  academyId: string,
): Promise<{ enteredAcademyId: string }> {
  return apiFetch(`/api/admin/academies/${academyId}/enter`, {
    method: "POST",
  });
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
  /** The first owner's login credentials, set directly at creation. */
  email: string;
  password: string;
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

// ── Platform↔Academy subscription billing (Super Admin) ──────────────────────

/** The academy's SaaS subscription lifecycle + snapshot total cost. */
export interface AcademySubscription {
  id: string;
  academy_id: string;
  plan_id: string | null;
  status: "ACTIVE" | "PAUSED" | "ENDED";
  is_trial: boolean;
  trial_start: string | null;
  trial_end: string | null;
  activated_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  billing_interval: "MONTHLY" | "YEARLY";
  base_price_minor: number;
  addons_price_minor: number;
  total_cost_minor: number;
  currency: string;
}

export interface SubscriptionAddOnLine {
  code: string;
  name: string;
  price_minor: number;
  currency: string;
}

export interface AcademySubscriptionView {
  subscription: AcademySubscription;
  plan: {
    code: string;
    name: string;
    price_minor: number;
    currency: string;
  } | null;
  addOns: SubscriptionAddOnLine[];
}

export function getAcademySubscription(
  academyId: string,
): Promise<AcademySubscriptionView> {
  return apiFetch(`/api/admin/academies/${academyId}/subscription`);
}

export function updateAcademySubscription(
  academyId: string,
  patch: {
    billing_interval?: "MONTHLY" | "YEARLY";
    activated_at?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
  },
): Promise<{ subscription: AcademySubscription }> {
  return apiFetch(`/api/admin/academies/${academyId}/subscription`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function extendAcademyTrial(
  academyId: string,
  days: number,
): Promise<{ subscription: AcademySubscription }> {
  return apiFetch(
    `/api/admin/academies/${academyId}/subscription/trial/extend`,
    { method: "POST", body: JSON.stringify({ days }) },
  );
}

export function activateAcademySubscription(
  academyId: string,
): Promise<{ subscription: AcademySubscription }> {
  return apiFetch(`/api/admin/academies/${academyId}/subscription/activate`, {
    method: "POST",
  });
}

/** The caller's OWN academy subscription (owner dashboard widget). */
export function getMySubscription(): Promise<{
  subscription: AcademySubscription | null;
}> {
  return apiFetch("/api/my-subscription");
}

/** A platform bill issued to an academy for its SaaS subscription. */
export interface AcademyBill {
  id: string;
  academy_id: string;
  period_start: string;
  period_end: string;
  status: "OPEN" | "PAID" | "OVERDUE" | "VOID";
  currency: string;
  total_minor: number;
  amount_paid_minor: number;
  due_date: string;
  issued_at: string;
  paid_at: string | null;
  payment_method: string | null;
  public_token: string;
  sent_at: string | null;
  reminder_count: number;
}

export function listAcademyBills(
  academyId: string,
): Promise<{ bills: AcademyBill[] }> {
  return apiFetch(`/api/admin/academies/${academyId}/bills`);
}

export function generateAcademyBill(
  academyId: string,
): Promise<{ billId: string }> {
  return apiFetch(`/api/admin/academies/${academyId}/bills/generate`, {
    method: "POST",
  });
}

export function markAcademyBillPaid(
  academyId: string,
  billId: string,
  body: { method: string; reason?: string },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/academies/${academyId}/bills/${billId}/mark-paid`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function setAcademyBillStatus(
  academyId: string,
  billId: string,
  status: "OPEN" | "OVERDUE" | "VOID" | "PAID",
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/academies/${academyId}/bills/${billId}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function sendAcademyBill(
  academyId: string,
  billId: string,
): Promise<{
  phone: string;
  message: string;
  url: string;
  transport: "WASENDER" | "DEEPLINK";
  sent: boolean;
  deeplink: string;
}> {
  return apiFetch(`/api/admin/academies/${academyId}/bills/${billId}/send`, {
    method: "POST",
  });
}

/** An academy's uploaded payment proof (transfer screenshot) awaiting review. */
export interface AcademyPaymentSubmission {
  id: string;
  method: "INSTAPAY" | "VODAFONE_CASH";
  amount_minor: number | null;
  note: string | null;
  review_status: "PENDING" | "APPROVED" | "REJECTED";
  reviewed_at: string | null;
  created_at: string;
}

export function listBillSubmissions(
  academyId: string,
  billId: string,
): Promise<{ submissions: AcademyPaymentSubmission[] }> {
  return apiFetch(
    `/api/admin/academies/${academyId}/bills/${billId}/submissions`,
  );
}

export function reviewPaymentSubmission(
  academyId: string,
  subId: string,
  decision: "approve" | "reject",
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/admin/academies/${academyId}/payment-submissions/${subId}/review`,
    { method: "POST", body: JSON.stringify({ decision }) },
  );
}

// ── Per-academy WhatsApp automation (Super Admin) ────────────────────────────

export interface AcademyAutomation {
  type1_billing_enabled: boolean;
  type2_lessons_enabled: boolean;
  type1_config: Record<string, unknown>;
  type2_config: Record<string, unknown>;
  wasender_session_status: string | null;
  has_token: boolean;
  token_tail: string | null;
}

export interface AutomationLogRow {
  id: string;
  automation_type: string;
  transport: "WASENDER" | "DEEPLINK";
  recipient_kind: string;
  recipient_phone: string | null;
  status: "QUEUED" | "SENT" | "FAILED" | "SKIPPED";
  error: string | null;
  ref_type: string | null;
  created_at: string;
}

export function getAcademyAutomation(
  academyId: string,
): Promise<{ automation: AcademyAutomation }> {
  return apiFetch(`/api/admin/academies/${academyId}/automation`);
}

export function updateAcademyAutomation(
  academyId: string,
  patch: {
    type1_billing_enabled?: boolean;
    type2_lessons_enabled?: boolean;
    type1_config?: Record<string, unknown>;
    type2_config?: Record<string, unknown>;
  },
): Promise<{ automation: AcademyAutomation }> {
  return apiFetch(`/api/admin/academies/${academyId}/automation`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function setWasenderToken(
  academyId: string,
  token: string,
): Promise<{ automation: AcademyAutomation }> {
  return apiFetch(`/api/admin/academies/${academyId}/automation/token`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function clearWasenderToken(
  academyId: string,
): Promise<{ automation: AcademyAutomation }> {
  return apiFetch(`/api/admin/academies/${academyId}/automation/token`, {
    method: "DELETE",
  });
}

export function testWasender(
  academyId: string,
): Promise<{ status: string | null; ok: boolean }> {
  return apiFetch(`/api/admin/academies/${academyId}/automation/test`, {
    method: "POST",
  });
}

export function getAutomationLog(
  academyId: string,
): Promise<{ log: AutomationLogRow[] }> {
  return apiFetch(`/api/admin/academies/${academyId}/automation/log`);
}

// ── Self-hosted WhatsApp gateway: session lifecycle (Super Admin) ─────────────

export interface WhatsAppQrResult {
  state: string;
  qr: string | null;
  session_id?: string;
}

/** Start a gateway session for the academy; returns the first pairing QR (data URL). */
export function whatsappConnect(academyId: string): Promise<WhatsAppQrResult> {
  return apiFetch(`/api/admin/academies/${academyId}/whatsapp/connect`, {
    method: "POST",
  });
}

/** Poll the current pairing QR + state while the user scans. */
export function whatsappQr(academyId: string): Promise<WhatsAppQrResult> {
  return apiFetch(`/api/admin/academies/${academyId}/whatsapp/qr`);
}

export interface WhatsAppStatus {
  state: string;
  phoneJid?: string | null;
  lastConnectedAt?: string | null;
  lastSeenAt?: string | null;
  queueDepth?: number;
  reconnectAttempts?: number;
}

/** Live session status from the gateway. */
export function whatsappStatus(academyId: string): Promise<WhatsAppStatus> {
  return apiFetch(`/api/admin/academies/${academyId}/whatsapp/status`);
}

/** Logout + remove the academy's gateway session and clear the stored token. */
export function whatsappLogout(academyId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/academies/${academyId}/whatsapp/logout`, {
    method: "POST",
  });
}

/** Send an ad-hoc test message through the academy's session (or a wa.me deep link if offline). */
export function whatsappSendTest(
  academyId: string,
  to: string,
  text: string,
): Promise<{ ok: boolean; transport: string; error: string | null; deeplink: string }> {
  return apiFetch(`/api/admin/academies/${academyId}/whatsapp/send-test`, {
    method: "POST",
    body: JSON.stringify({ to, text }),
  });
}

/** Check whether a number is registered on WhatsApp (null = no active session to check with). */
export function whatsappCheckNumber(
  academyId: string,
  to: string,
): Promise<{ exists: boolean | null }> {
  return apiFetch(`/api/admin/academies/${academyId}/whatsapp/check`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

// ── Cross-academy Super Admin overviews (sidebar pages) ──────────────────────

export interface SubscriptionOverviewRow {
  academy_id: string;
  academy_name: string;
  academy_status: string;
  plan_name: string | null;
  status: string | null;
  is_trial: boolean;
  trial_end: string | null;
  activated_at: string | null;
  current_period_end: string | null;
  total_cost_minor: number;
  currency: string;
  outstanding_minor: number;
  outstanding_count: number;
  pending_proofs: number;
}

export interface PendingProof {
  submission_id: string;
  academy_id: string;
  academy_name: string;
  bill_id: string;
  method: "INSTAPAY" | "VODAFONE_CASH";
  amount_minor: number | null;
  note: string | null;
  created_at: string;
  bill_total_minor: number;
  currency: string;
  period_start: string;
  period_end: string;
}

export function getSubscriptionsOverview(): Promise<{
  academies: SubscriptionOverviewRow[];
  pending_proofs: PendingProof[];
}> {
  return apiFetch("/api/admin/subscriptions");
}

export interface AutomationOverviewRow {
  academy_id: string;
  academy_name: string;
  academy_status: string;
  type1_billing_enabled: boolean;
  type2_lessons_enabled: boolean;
  has_token: boolean;
  wasender_session_status: string | null;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
}

export function getAutomationOverview(): Promise<{
  academies: AutomationOverviewRow[];
}> {
  return apiFetch("/api/admin/automation");
}

export interface WhatsAppActivityRow {
  id: string;
  academy_id: string;
  academy_name: string;
  automation_type: string;
  transport: string;
  recipient_kind: string;
  recipient_phone: string | null;
  status: "QUEUED" | "SENT" | "FAILED" | "SKIPPED";
  error: string | null;
  created_at: string;
}

/** Cross-academy recent WhatsApp send feed (Super Admin Activity tab). */
export function getWhatsappActivity(limit = 50): Promise<{ activity: WhatsAppActivityRow[] }> {
  return apiFetch(`/api/admin/automation/activity?limit=${limit}`);
}

export interface GatewaySessionCounts {
  total: number;
  connected: number;
  connecting: number;
  qr: number;
  disconnected: number;
  logged_out: number;
}

export interface GatewayHealth {
  ok: boolean;
  up: boolean;
  uptime?: number;
  sessions?: GatewaySessionCounts;
}

export interface GatewaySettings {
  minIntervalMs: number;
  maxIntervalMs: number;
  dailyCap: number;
  warmupDays: number;
  warmupDailyCap: number;
  warmupMinIntervalMs: number;
  warmupMaxIntervalMs: number;
}

/** Gateway liveness + per-state session counts (System tab). */
export function getGatewayHealth(): Promise<GatewayHealth> {
  return apiFetch("/api/admin/automation/gateway/health");
}

/** Current live send-pacing (rate-limit) settings. */
export function getGatewaySettings(): Promise<{ ok: boolean; settings?: GatewaySettings }> {
  return apiFetch("/api/admin/automation/gateway/settings");
}

/** Update the rate-limit knobs — applies live to every session on the gateway. */
export function updateGatewaySettings(
  patch: Partial<GatewaySettings>,
): Promise<{ ok: boolean; settings?: GatewaySettings }> {
  return apiFetch("/api/admin/automation/gateway/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

// ── Super Admin video oversight — Tier 1 (read-only) ─────────────────────
// Cross-tenant usage, the monitor/recording compliance feed, and live service health for the
// self-hosted video platform. Backed by the audited SECURITY DEFINER readers; platform.manage-gated.

/** Effective per-academy video state (the academies.video_access override resolved against the plan). */
export type VideoAccessStatus =
  | "ENABLED" // force-on (permanent)
  | "TRIAL" // force-on, auto-expires at video_trial_ends_at
  | "PLAN" // entitled via the plan / add-on
  | "EXPIRED" // a trial that has lapsed
  | "DISABLED" // force-off
  | "NONE"; // not entitled, no override

export type VideoAccessOverride = "ENABLED" | "DISABLED" | null;

export interface VideoUsageRow {
  academy_id: string;
  academy_name: string;
  currency: string | null;
  plan_name: string | null;
  plan_code: string | null;
  video_plan_name: string | null;
  video_access: VideoAccessOverride;
  video_trial_ends_at: string | null;
  video_status: VideoAccessStatus;
  video_enabled: boolean;
  active_rooms: number;
  live_rooms: number;
  max_rooms: number | null;
  recordings_count: number;
  storage_bytes: number;
  recording_seconds: number;
  active_recordings: number;
  participant_sessions: number;
}

export interface VideoUsageTotals {
  academies: number;
  enabled: number;
  trial: number;
  active_rooms: number;
  recordings_count: number;
  storage_bytes: number;
  recording_seconds: number;
  active_recordings: number;
}

/** Per-academy video usage (active rooms vs plan cap, recordings, storage) + platform totals. */
export function getVideoUsage(): Promise<{
  academies: VideoUsageRow[];
  totals: VideoUsageTotals;
}> {
  return apiFetch("/api/admin/video/usage");
}

export interface VideoAcademyRoom {
  id: string;
  name: string;
  status: VideoRoomStatus;
  created_at: string;
  deleted_at: string | null;
  recordings_count: number;
  storage_bytes: number;
  active_recordings: number;
  participant_sessions: number;
  last_activity: string | null;
}

export interface VideoAcademyDetail {
  academy: {
    id: string;
    name: string;
    currency: string | null;
    subdomain: string | null;
    created_at: string;
    plan_id: string | null;
    plan_name: string | null;
    plan_code: string | null;
    video_plan_id: string | null;
    video_plan_name: string | null;
    video_access: VideoAccessOverride;
    video_trial_ends_at: string | null;
    base_entitled: boolean;
    video_status: VideoAccessStatus;
    /** Effective video limits/flags (the assigned tier wins per key, else the academy's plan). */
    video_limits: Record<string, number>;
  };
  subscription: {
    status: string;
    is_trial: boolean;
    trial_start: string | null;
    trial_end: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    currency: string | null;
    plan_name: string | null;
  } | null;
  stats: {
    active_rooms: number;
    total_rooms: number;
    recordings_count: number;
    storage_bytes: number;
    recording_seconds: number;
    active_recordings: number;
    participant_sessions: number;
  };
  rooms: VideoAcademyRoom[];
}

/** The per-academy video oversight detail (status, subscription, usage, rooms). */
export function getVideoAcademy(id: string): Promise<VideoAcademyDetail> {
  return apiFetch(`/api/admin/video/academies/${id}`);
}

export interface VideoAdminRoomLog {
  room: {
    id: string;
    academy_id: string;
    name: string;
    status: VideoRoomStatus;
    created_at: string;
  };
  sessions: RoomLogSession[];
  events: RoomLogEvent[];
}

/** A room's cross-tenant access log (who joined / when / how long + audited actions). */
export function getVideoAcademyRoomLog(academyId: string, roomId: string): Promise<VideoAdminRoomLog> {
  return apiFetch(`/api/admin/video/academies/${academyId}/rooms/${roomId}/logs`);
}

export interface VideoTierPlan {
  id: string;
  code: string;
  name: string;
  grants_video: boolean;
  options: Record<string, number>;
  video_capable: boolean;
}

/** Video-capable plans usable as a per-academy video tier (drives the academy's video options). */
export function getVideoPlans(): Promise<{ plans: VideoTierPlan[] }> {
  return apiFetch("/api/admin/video/plans");
}

export type VideoAccessAction =
  | "enable"
  | "trial"
  | "extend_trial"
  | "disable"
  | "follow_plan"
  | "set_tier";

export interface VideoAccessPayload {
  action: VideoAccessAction;
  trial_days?: number | null;
  video_plan_id?: string | null;
}

/** Set an academy's video access override (activate / deactivate / trial / tier). Super Admin, audited. */
export function setVideoAccess(
  id: string,
  payload: VideoAccessPayload,
): Promise<{ ok: boolean; academy: VideoAcademyDetail["academy"] | null }> {
  return apiFetch(`/api/admin/video/academies/${id}/access`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface VideoComplianceRow {
  id: string;
  academy_id: string | null;
  academy_name: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

/** Platform-wide monitor & recording compliance feed (the sensitive video.* audit actions). */
export function getVideoCompliance(
  limit = 100,
): Promise<{ rows: VideoComplianceRow[]; total: number; limit: number }> {
  return apiFetch(`/api/admin/video/compliance?limit=${limit}`);
}

export interface VideoHealth {
  livekit: { ok: boolean; rooms?: number; error: string | null };
  egress: { ok: boolean; active?: number; error: string | null };
  storage: {
    ok: boolean;
    configured: boolean;
    bucket?: string;
    status?: number;
    error: string | null;
  };
  capacity: {
    active_recordings: number | null;
    soft_limit: number;
    level: "idle" | "busy" | "at_capacity" | "unknown";
  };
  checked_at: string;
}

/** LiveKit + Egress + object-storage reachability + concurrent-recording capacity hint. */
export function getVideoHealth(): Promise<VideoHealth> {
  return apiFetch("/api/admin/video/health");
}

/** Fetch a private payment-proof screenshot as an object URL (works in cookie + token modes). */
export async function fetchPaymentScreenshot(
  academyId: string,
  subId: string,
): Promise<string> {
  const headers = new Headers({ Accept: "image/*" });
  if (AUTH_MODE === "token") {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(
    `${BASE_URL}/api/admin/academies/${academyId}/payment-submissions/${subId}/screenshot`,
    {
      headers,
      credentials: AUTH_MODE === "cookie" ? "include" : "same-origin",
    },
  );
  if (!res.ok) throw new ApiError(res.status, "Screenshot fetch failed");
  return URL.createObjectURL(await res.blob());
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
  password?: string | null;
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

/** Permanently delete a teacher. Blocked (422) by the API if they carry any academy history. */
export function deleteTeacher(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/teachers/${id}`, { method: "DELETE" });
}

// ── Staff departments (platform catalog) ─────────────────────────────────────

export interface StaffDepartment {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export function listStaffDepartments(): Promise<{ departments: StaffDepartment[] }> {
  return apiFetch("/api/staff-departments");
}

export function createStaffDepartment(input: {
  name: string;
  sort_order?: number;
}): Promise<{ departmentId: string }> {
  return apiFetch("/api/admin/staff-departments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateStaffDepartment(
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/staff-departments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteStaffDepartment(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/staff-departments/${id}`, { method: "DELETE" });
}

// ── Staff ────────────────────────────────────────────────────────────────────

export interface StaffRow {
  id: string;
  user_id: string | null;
  full_name: string;
  department: string;
  phone: string | null;
  salary_minor: number;
  currency: string;
  notes: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface StaffInput {
  full_name?: string;
  department?: string;
  phone?: string | null;
  salary_minor?: number;
  currency?: string | null;
  notes?: string | null;
  create_login?: boolean;
  email?: string | null;
  password?: string | null;
  /** Login role code: "STAFF" (default) or a custom academy role code. Create-only. */
  role?: string | null;
}

export function listStaff(q: DataTableQuery = {}): Promise<ListResult<StaffRow>> {
  return apiFetch(`/api/staff${toQueryString(q)}`);
}

export function getStaff(id: string): Promise<{ staff: StaffRow }> {
  return apiFetch(`/api/staff/${id}`);
}

export function createStaff(
  input: StaffInput,
): Promise<{ staffId: string; userId: string | null }> {
  return apiFetch("/api/staff", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateStaff(
  id: string,
  patch: StaffInput,
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/staff/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deactivateStaff(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/staff/${id}/deactivate`, { method: "POST" });
}

export function reactivateStaff(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/staff/${id}/reactivate`, { method: "POST" });
}

// ── Academy roles (custom RBAC) ──────────────────────────────────────────────
// The platform owns the permission catalog; an academy composes its OWN named roles from the
// subset of capabilities it holds and assigns them to staff. Listing is free (to assign STAFF);
// creating/editing roles is plan-gated behind the `custom_roles` capability (402 on a miss).

export interface AcademyRoleSummary {
  /** Present only for custom roles (system roles are addressed by `code`). */
  id?: string;
  /** Stable code stored on the user (system code, or a generated CR_… token). */
  code: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  /** True for the built-in, non-editable system roles (OWNER/TEACHER/STAFF). */
  system: boolean;
  permissions: string[];
  assignedCount: number;
}

export interface AcademyRolesResponse {
  system: AcademyRoleSummary[];
  custom: AcademyRoleSummary[];
  /** The capability codes the current user is allowed to grant to a custom role. */
  grantable: string[];
}

export interface AcademyRoleInput {
  name?: string;
  description?: string | null;
  permissions?: string[];
  is_active?: boolean;
}

export function listAcademyRoles(): Promise<AcademyRolesResponse> {
  return apiFetch("/api/roles");
}

export function createAcademyRole(
  input: { name: string; description?: string | null; permissions: string[] },
): Promise<{ roleId: string; code: string }> {
  return apiFetch("/api/roles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAcademyRole(
  id: string,
  patch: AcademyRoleInput,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/roles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteAcademyRole(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/roles/${id}`, { method: "DELETE" });
}

// ── Specializations (Settings) ───────────────────────────────────────────────

export interface Specialization {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export function listSpecializations(): Promise<{
  specializations: Specialization[];
}> {
  return apiFetch("/api/specializations");
}

export function createSpecialization(
  name: string,
): Promise<{ specializationId: string }> {
  return apiFetch("/api/specializations", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateSpecialization(
  id: string,
  patch: { name?: string; is_active?: boolean; sort_order?: number },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/specializations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSpecialization(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/specializations/${id}`, { method: "DELETE" });
}

// ── Certificate templates (Certificates) ─────────────────────────────────────

/** Editable wording/branding of one certificate template (the design is client-side). */
export interface CertificateContent {
  academyNameEn: string;
  academyNameAr: string;
  titleEn: string;
  titleAr: string;
  presentationEn: string;
  presentationAr: string;
  bodyEn: string;
  bodyAr: string;
  signatoryNameEn: string;
  signatoryNameAr: string;
  signatoryTitleEn: string;
  signatoryTitleAr: string;
  accentColor: string;
}

export interface CertificateTemplate {
  templateNumber: 1 | 2;
  content: CertificateContent;
}

export function listCertificateTemplates(): Promise<{
  templates: CertificateTemplate[];
}> {
  return apiFetch("/api/certificate-templates");
}

export function saveCertificateTemplate(
  templateNumber: 1 | 2,
  content: Partial<CertificateContent>,
): Promise<{ ok: boolean; content: CertificateContent }> {
  return apiFetch(`/api/certificate-templates/${templateNumber}`, {
    method: "PUT",
    body: JSON.stringify(content),
  });
}

// ── Payment Settings (Settings → Payment) ────────────────────────────────────

export type PaymentMethodKey = "BANK_TRANSFER" | "PAYPAL" | "XPAY";

export interface BankTransferConfig {
  account_number: string;
  account_holder: string;
  bank_name: string;
  iban: string;
}

export interface PaypalConfig {
  email: string;
  mode: "sandbox" | "live";
}

export interface PaymentSetting {
  method: PaymentMethodKey;
  is_active: boolean;
  config: BankTransferConfig | PaypalConfig | Record<string, never>;
}

// ── Academy profile (Settings → General) ─────────────────────────────────────

export interface AcademyProfile {
  id: string;
  name: string;
  timezone: string;
  default_currency: string;
  invoice_grouping: string;
  billing_day: number;
}

export function getAcademyProfile(): Promise<{ academy: AcademyProfile }> {
  return apiFetch("/api/academy");
}

export function updateAcademyProfile(
  patch: { name: string; timezone?: string },
): Promise<{ ok: boolean }> {
  return apiFetch("/api/academy", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ── Payment Settings (Settings → Payment) ────────────────────────────────────

export function listPaymentSettings(): Promise<{
  payment_settings: PaymentSetting[];
}> {
  return apiFetch("/api/payment-settings");
}

export function savePaymentSetting(
  method: PaymentMethodKey,
  payload: { is_active: boolean; config?: object },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/payment-settings/${method}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ── Teacher reports (internal performance notes ABOUT a teacher) ──────────────

export type TeacherReportKind = "NOTE" | "INCIDENT" | "PRAISE";

export interface TeacherReport {
  id: string;
  kind: TeacherReportKind;
  body: string;
  author_user_id: string | null;
  author_name: string | null;
  created_at: string;
}

export function listTeacherReports(
  teacherId: string,
): Promise<{ reports: TeacherReport[] }> {
  return apiFetch(`/api/teachers/${teacherId}/reports`);
}

export function createTeacherReport(
  teacherId: string,
  input: { kind: TeacherReportKind; body: string },
): Promise<{ reportId: string }> {
  return apiFetch(`/api/teachers/${teacherId}/reports`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteTeacherReport(
  teacherId: string,
  reportId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/teachers/${teacherId}/reports/${reportId}`, {
    method: "DELETE",
  });
}

// ── Students, subscriptions & teacher assignment (Sprint 4 §8) ───────────────

export interface StudentRow {
  id: string;
  full_name: string;
  whatsapp_phone: string | null;
  country: string | null;
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
  price_basis?: "PER_SESSION" | "PER_MONTH" | "PER_HOUR";
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
  /** TRIAL_BOOKED students only: true once the trial session has been recorded (attended/
   *  cancelled/…), so the profile can advance its setup call-to-action to "activate". */
  trialResolved?: boolean;
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

export function deactivateStudent(
  id: string,
  reason?: "GRADUATED" | "WITHDRAWN",
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/students/${id}/deactivate`, {
    method: "POST",
    body: reason ? JSON.stringify({ reason }) : undefined,
  });
}

export function reactivateStudent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/students/${id}/reactivate`, { method: "POST" });
}

/**
 * DELETE /api/students/{id} — "remove from the system". A recoverable soft-delete: the record
 * and its history are retained server-side and can be restored (reactivate). Returns a message
 * confirming the removal is reversible.
 */
export function deleteStudent(
  id: string,
): Promise<{ ok: boolean; recoverable: boolean; message: string }> {
  return apiFetch(`/api/students/${id}`, { method: "DELETE" });
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
    price_basis?: "PER_SESSION" | "PER_MONTH" | "PER_HOUR";
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

/** One student's active weekly timetable as the roster endpoint returns it (period-independent). */
export interface TimetableSummary {
  schedule_id: string;
  student_id: string;
  student_name: string | null;
  teacher_id: string;
  teacher_name: string | null;
  timezone: string;
  slots: ScheduleSlot[];
}

/** Every active timetable in the academy (Owner/Super-Admin: all; Teacher: own students). */
export function listTimetables(): Promise<{ timetables: TimetableSummary[] }> {
  return apiFetch(`/api/timetables`);
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
  input: {
    cancelled_by: "teacher" | "student";
    reason?: string;
    charge_student?: boolean;
    pay_teacher?: boolean;
  },
): Promise<{ ok: boolean; status: string; billed?: boolean }> {
  return apiFetch(`/api/sessions/${sessionId}/cancel`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/sessions/{id}/cancellation-request — a teacher (who no longer cancels directly)
 * asks the owner to cancel a class; the session stays SCHEDULED until the owner decides.
 */
export function requestCancellation(
  sessionId: string,
  input: { cancelled_by: "teacher" | "student"; reason?: string },
): Promise<{ requestId: string; status: "PENDING" }> {
  return apiFetch(`/api/sessions/${sessionId}/cancellation-request`, {
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

/*
| Attendance & custom reports (Sprint 6 §8). The attendance outcome fires the billing hook
| server-side; the report engine renders the academy's report_field_definitions and stores
| values keyed by field key. Transport only — all rules live in the API.
*/

/** The billing/payout verdict the API derives from a status via the single classify() (§4). */
export interface SessionClassification {
  billableToStudent: boolean;
  countsForTeacher: boolean;
}

/** One session with its billing-relevant fields (GET /api/sessions/{id}). */
export interface SessionDetail {
  id: string;
  student_id: string;
  teacher_id: string;
  student_name: string | null;
  teacher_name: string | null;
  academy_name: string | null;
  scheduled_at_utc: string;
  duration_minutes: number;
  status: SessionStatus;
  status_reason: string | null;
  billed: boolean;
  outcome_set_at: string | null;
  classification: SessionClassification;
  /** A teacher-raised cancellation awaiting owner approval. The session stays SCHEDULED while
   *  this is present; null once there is no PENDING request (approved, rejected, or never raised). */
  pending_cancellation: {
    id: string;
    cancel_type: "teacher" | "student";
    reason: string | null;
    requested_at: string;
  } | null;
}

export interface SessionReportData {
  values: Record<string, unknown>;
  filled_by_user_id: string | null;
  filled_at: string | null;
  whatsapp_sent_at: string | null;
  whatsapp_channel: string | null;
}

/** GET /api/sessions/{id} — session + its report + the active/inactive report-field defs. */
export interface SessionDetailResponse {
  session: SessionDetail;
  report: SessionReportData | null;
  reportFields: ReportField[];
  inactiveReportFields: ReportField[];
}

export function getSession(sessionId: string): Promise<SessionDetailResponse> {
  return apiFetch(`/api/sessions/${sessionId}`);
}

/**
 * The outcomes a human records after a lesson. FREE = delivered but on the house. The former
 * ABSENT_* outcomes were retired: "charge despite no-show" is now a cancellation with a billing
 * override (charge_student / pay_teacher), set by the owner in the cancellation popup.
 */
export type AttendanceOutcome =
  | "ATTENDED"
  | "FREE"
  | "CANCELLED_BY_TEACHER"
  | "CANCELLED_BY_STUDENT";

export function markAttendance(
  sessionId: string,
  input: {
    status: AttendanceOutcome;
    reason?: string;
    override_timing?: boolean;
    /** Cancellation-only billing override (owner decision). Ignored for ATTENDED/FREE. */
    charge_student?: boolean;
    pay_teacher?: boolean;
  },
): Promise<{
  status: string;
  billed: boolean;
  classification: SessionClassification;
}> {
  return apiFetch(`/api/sessions/${sessionId}/attendance`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function putSessionReport(
  sessionId: string,
  values: Record<string, unknown>,
): Promise<{ ok: boolean; values: Record<string, unknown> }> {
  return apiFetch(`/api/sessions/${sessionId}/report`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
}

export interface WhatsAppMessage {
  text: string;
  phone: string;
  deeplink: string;
}

export function markWhatsappSent(sessionId: string): Promise<{
  ok: boolean;
  sentAt: string;
  channel: string;
  message: WhatsAppMessage;
}> {
  return apiFetch(`/api/sessions/${sessionId}/report/whatsapp-sent`, {
    method: "POST",
  });
}

/** One pending occurrence awaiting an outcome (GET /api/sessions/pending-attendance). */
export interface PendingSession {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at_utc: string;
  duration_minutes: number;
  status: SessionStatus;
  student_name: string | null;
  teacher_name: string | null;
}

export function getPendingAttendance(): Promise<{
  sessions: PendingSession[];
}> {
  return apiFetch("/api/sessions/pending-attendance");
}

/** A session row for the attendance day view — carries the student's lifecycle status too. */
export interface DaySession extends PendingSession {
  student_status: string | null;
  /** Set when a teacher-raised cancellation is awaiting owner approval — the session is still
   *  SCHEDULED, so the row shows an "awaiting approval" marker. null when there's no pending request. */
  pending_cancel_type: "teacher" | "student" | null;
}

/**
 * GET /api/sessions/day — every session inside a local-day window [from, to), for the
 * attendance page. `from`/`to` are ISO instants (the browser computes the day's local bounds).
 */
export function getSessionsByDay(params: {
  from: string;
  to: string;
  teacher_id?: string;
  status?: string;
  trial_only?: boolean;
}): Promise<{ sessions: DaySession[] }> {
  const qs = new URLSearchParams({ from: params.from, to: params.to });
  if (params.teacher_id) qs.set("teacher_id", params.teacher_id);
  if (params.status) qs.set("status", params.status);
  if (params.trial_only) qs.set("trial_only", "1");
  return apiFetch(`/api/sessions/day?${qs.toString()}`);
}

/**
 * GET /api/sessions/day/count — number of SCHEDULED sessions (still needing an outcome) inside a
 * local-day window [from, to). Powers the sidebar's Attendance badge. `from`/`to` are ISO instants.
 */
export function getDaySessionCount(params: {
  from: string;
  to: string;
}): Promise<{ count: number }> {
  const qs = new URLSearchParams({ from: params.from, to: params.to });
  return apiFetch(`/api/sessions/day/count?${qs.toString()}`);
}

/** One row of the per-student report archive (GET /api/students/{id}/reports). */
export interface ArchiveReportRow {
  id: string;
  scheduled_at_utc: string;
  duration_minutes: number;
  status: SessionStatus;
  teacher_name: string | null;
  report_values: Record<string, unknown> | null;
  filled_at: string | null;
  whatsapp_sent_at: string | null;
}

export interface ArchiveResult {
  reports: ArchiveReportRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function getStudentReports(
  studentId: string,
  q: DataTableQuery = {},
): Promise<ArchiveResult> {
  return apiFetch(`/api/students/${studentId}/reports${toQueryString(q)}`);
}

// ── Invoicing dashboard (Sprint 7 §8) ────────────────────────────────────────

/** Per-currency money roll-up so multi-currency academies are never summed across units. */
export interface InvoiceMoneyBucket {
  currency: string;
  billed_minor: number;
  collected_minor: number;
  /** Unpaid balance of CLOSED/PARTIALLY_PAID invoices only (finalized bills). */
  outstanding_minor: number;
  /** Unpaid balance of every non-VOID invoice, including OPEN ones — total owed. */
  due_minor: number;
}

/** Aggregate counters behind the invoices dashboard cards (GET /api/invoices/summary). */
export interface InvoiceSummary {
  counts: {
    all: number;
    OPEN: number;
    CLOSED: number;
    PAID: number;
    PARTIALLY_PAID: number;
  };
  money: InvoiceMoneyBucket[];
}

export function getInvoiceSummary(
  q: { period_year?: string; period_month?: string; kind?: string } = {},
): Promise<InvoiceSummary> {
  const params = new URLSearchParams();
  if (q.period_year) params.set("period_year", q.period_year);
  if (q.period_month) params.set("period_month", q.period_month);
  if (q.kind) params.set("kind", q.kind);
  const s = params.toString();
  return apiFetch(`/api/invoices/summary${s ? `?${s}` : ""}`);
}

/** Close every OPEN invoice for the caller's academy in the given period. */
export function closeInvoicePeriod(
  year: number,
  month: number,
): Promise<{ closed: number }> {
  return apiFetch("/api/invoices/close", {
    method: "POST",
    body: JSON.stringify({ year, month }),
  });
}

// ── Manual invoices (Sprint 9) ────────────────────────────────────────────────

/** One free-form line on a manual itemized invoice. */
export interface ManualLineInput {
  description: string;
  amount_minor: number;
  student_id?: string | null;
}

/** Payload for POST /api/invoices (manual itemized bill). */
export interface ManualInvoiceInput {
  payer_type: "guardian" | "student";
  payer_id: string;
  period_year: number;
  period_month: number;
  currency?: string;
  line_items: ManualLineInput[];
}

/** Create a MANUAL itemized invoice (OPEN draft). Returns the new invoice id. */
export function createManualInvoice(
  input: ManualInvoiceInput,
): Promise<{ id: string }> {
  return apiFetch("/api/invoices", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** One quoted advance-payment line (a single still-billable session). */
export interface AdvanceQuoteLine {
  session_id: string;
  session_date: string;
  description: string;
  amount_minor: number;
}

/** Server-side preview of an advance-payment bill (GET /api/invoices/advance-quote). */
export interface AdvanceQuote {
  student_name: string;
  currency: string;
  total_minor: number;
  count: number;
  price_basis: string | null;
  has_subscription: boolean;
  lines: AdvanceQuoteLine[];
}

/** Preview the advance bill for a student from a start date through month end. */
export function getAdvanceQuote(
  studentId: string,
  startDate: string,
): Promise<AdvanceQuote> {
  const params = new URLSearchParams({
    student_id: studentId,
    start_date: startDate,
  });
  return apiFetch(`/api/invoices/advance-quote?${params.toString()}`);
}

/** Create the advance-payment invoice (recomputed server-side). Returns the new invoice id. */
export function createAdvanceInvoice(
  studentId: string,
  startDate: string,
): Promise<{ id: string; count: number }> {
  return apiFetch("/api/invoices/advance", {
    method: "POST",
    body: JSON.stringify({ student_id: studentId, start_date: startDate }),
  });
}

// ── Payroll (Sprint 8 §8) ─────────────────────────────────────────────────────

export type PayoutStatus = "OPEN" | "FINALIZED";

/** One payout statement row as the list/detail endpoints return it. */
export interface PayoutRow {
  id: string;
  teacher_id: string;
  teacher_name?: string | null;
  period_month: number;
  period_year: number;
  status: PayoutStatus;
  total_minor: number;
  currency: string;
  finalized_at: string | null;
  created_at: string;
}

/** Report state of a delivered session, derived from its session_reports row. */
export type PayoutReportStatus = "SENT" | "FILLED" | "MISSING";

/** One snapshotted payout line (a delivered session paid at the teacher's rate). */
export interface PayoutLineItem {
  id: string;
  session_id: string | null;
  session_date: string | null;
  student_name: string | null;
  amount_minor: number;
  currency: string;
  report_status: PayoutReportStatus;
}

export type AdjustmentType = "REWARD" | "DEDUCTION";

/** A reward (bonus) or deduction on a payout statement, with reason + optional details. */
export interface PayoutAdjustment {
  id: string;
  type: AdjustmentType;
  amount_minor: number;
  currency: string;
  reason: string;
  details: string | null;
  created_at: string;
}

export interface PayoutDetail extends PayoutRow {
  notes: string | null;
  /** Per-session gross before adjustments. */
  sessions_minor: number;
  rewards_minor: number;
  deductions_minor: number;
}

export interface PayoutDetailResponse {
  payout: PayoutDetail;
  lineItems: PayoutLineItem[];
  adjustments: PayoutAdjustment[];
}

/** Add a reward or deduction to an OPEN payout (owner; payout.adjust). */
export function addPayoutAdjustment(
  payoutId: string,
  input: {
    type: AdjustmentType;
    amount_minor: number;
    reason: string;
    details?: string;
  },
): Promise<{ ok: boolean; id: string }> {
  return apiFetch(`/api/payouts/${payoutId}/adjustments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Remove an adjustment from an OPEN payout. */
export function removePayoutAdjustment(
  payoutId: string,
  adjustmentId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/payouts/${payoutId}/adjustments/${adjustmentId}`, {
    method: "DELETE",
  });
}

/** Owner: all teachers' payouts (DataTable). */
export function listPayouts(
  q: DataTableQuery = {},
): Promise<ListResult<PayoutRow>> {
  return apiFetch(`/api/payouts${toQueryString(q)}`);
}

/** Teacher: own payout statements (row-filtered to the caller's teacher_id). */
export function listMyPayouts(
  q: DataTableQuery = {},
): Promise<ListResult<PayoutRow>> {
  return apiFetch(`/api/me/payouts${toQueryString(q)}`);
}

export function getPayout(id: string): Promise<PayoutDetailResponse> {
  return apiFetch(`/api/payouts/${id}`);
}

/** Finalize every OPEN payout for the caller's academy in the given period (idempotent). */
export function finalizePayoutPeriod(
  year: number,
  month: number,
): Promise<{ finalized: number }> {
  return apiFetch("/api/payouts/finalize", {
    method: "POST",
    body: JSON.stringify({ year, month }),
  });
}

/** Per-currency profit = revenue − payouts for a period (never summed across currencies). */
export interface ProfitSummaryRow {
  currency: string;
  revenue_minor: number;
  payouts_minor: number;
  profit_minor: number;
}

export interface ProfitSummary {
  year: number;
  month: number;
  rows: ProfitSummaryRow[];
}

export function getProfitSummary(
  year: number,
  month: number,
): Promise<ProfitSummary> {
  return apiFetch(`/api/reports/profit-summary?year=${year}&month=${month}`);
}

// ── Live FX rates (financial statistics) ─────────────────────────────────────

/** One foreign currency and how many home-currency units one of its units buys. */
export interface ExchangeRate {
  currency: string;
  /** Home-currency units per 1 unit of `currency` (e.g. EGP per 1 USD). */
  to_home: number;
}

/** GET /api/reports/exchange-rates — live rates into the academy home currency (EGP). */
export interface ExchangeRates {
  home: string;
  /** False when the upstream is unreachable and no cached copy exists. */
  available: boolean;
  /** True when served from a cached copy after an upstream failure. */
  stale: boolean;
  /** Unix seconds of the upstream's last update, or null when unavailable. */
  as_of: number | null;
  source: string | null;
  rates: ExchangeRate[];
}

export function getExchangeRates(): Promise<ExchangeRates> {
  return apiFetch("/api/reports/exchange-rates");
}

// ── Plan gating / entitlements (Sprint 9 §4, §8) ─────────────────────────────

/** Resolved plan features + limits for the current academy (GET /api/entitlements). */
export interface Entitlements {
  plan: string | null;
  capabilities: string[];
  limits: Record<string, number | null>;
  addOns: string[];
  usage: { students?: number; teachers?: number };
}

export function getEntitlements(): Promise<Entitlements> {
  return apiFetch("/api/entitlements");
}

/** The shape of an `upgrade_required` (402) body the `entitled:` middleware returns. */
export interface UpgradePayload {
  error: "upgrade_required";
  message: string;
  feature: string;
  plan: string | null;
}

/** Narrow an ApiError to a 402 plan-gate response (for an upgrade prompt vs a 403). */
export function asUpgradeRequired(err: unknown): UpgradePayload | null {
  if (err instanceof ApiError && err.status === 402) {
    const body = err.body as Partial<UpgradePayload> | undefined;
    if (body?.error === "upgrade_required") {
      return {
        error: "upgrade_required",
        message: body.message ?? "",
        feature: body.feature ?? "",
        plan: body.plan ?? null,
      };
    }
  }
  return null;
}

/** The at-limit payload a create endpoint returns inside a 422 validation error. */
export interface PlanLimitPayload {
  error: "plan_limit_reached";
  resource: string;
  limit: number | null;
  current: number;
  plan: string | null;
  message_en: string;
  message_ar: string;
}

/** Narrow an ApiError to a plan_limit_reached (422) body, if present on any field. */
export function asPlanLimit(err: unknown): PlanLimitPayload | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const errors = (err.body as { errors?: Record<string, string[]> } | undefined)
    ?.errors;
  for (const messages of Object.values(errors ?? {})) {
    for (const raw of messages) {
      try {
        const parsed = JSON.parse(raw) as Partial<PlanLimitPayload>;
        if (parsed?.error === "plan_limit_reached") {
          return parsed as PlanLimitPayload;
        }
      } catch {
        // not a JSON plan-limit payload — a normal validation message
      }
    }
  }
  return null;
}

// ── Audit log read UI (Sprint 9 §5) ──────────────────────────────────────────

export interface AuditEntry {
  id: string;
  academy_id: string | null;
  academy_name: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: AppRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditResult {
  rows: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** When set, the plan limited the read to this many trailing days (BASIC). */
  depthLimitedDays: number | null;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function getAudit(q: AuditQuery = {}): Promise<AuditResult> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return apiFetch(`/api/audit${s ? `?${s}` : ""}`);
}

// ── Plan & add-on management (Super Admin, Sprint 9 §8) ───────────────────────

// ── Admin platform dashboard (Phase 1) ──────────────────────────────────────

export interface AdminDashboardStats {
  academies: {
    total: number;
    active: number;
    trial: number;
    suspended: number;
    recent: number;
  };
  people: { students: number; teachers: number; guardians: number };
  plan_distribution: Array<{
    plan_id: string;
    plan_code: string;
    plan_name: string;
    academy_count: number;
  }>;
}

export interface AdminMrr {
  currency: string;
  amount_minor: number;
}

export interface AdminEndingSoon {
  academy_id: string;
  academy_name: string;
  plan_name: string | null;
  kind: "trial" | "renewal";
  ends_at: string;
  days_left: number;
  total_cost_minor: number;
  currency: string;
}

export interface AdminOutstanding {
  academies: number;
  totals: AdminMrr[];
}

export interface AdminDashboardSubscriptions {
  endingSoon: AdminEndingSoon[];
  endingSoonCount: number;
  outstanding: AdminOutstanding;
  pendingProofs: {
    count: number;
    items: PendingProof[];
  };
}

export interface AdminDashboard {
  stats: AdminDashboardStats;
  recentActivity: AuditEntry[];
  billing: { mrr: AdminMrr[] };
  subscriptions: AdminDashboardSubscriptions;
}

export function getAdminDashboard(): Promise<AdminDashboard> {
  return apiFetch("/api/admin/dashboard");
}

/** plans.features documented shape: capabilities ∪ numeric limits. */
export interface PlanFeatures {
  capabilities?: string[];
  limits?: Record<string, number | null>;
}

export interface PlanCatalogItem extends Plan {
  features: PlanFeatures | null;
}

export interface AddOnCatalogItem {
  id: string;
  code: string;
  name: string;
  price_minor: number;
  currency: string;
  feature_key: string;
}

export function getPlanCatalog(): Promise<{
  plans: PlanCatalogItem[];
  addOns: AddOnCatalogItem[];
}> {
  return apiFetch("/api/admin/plans");
}

// ── Role ⇄ capability editor (Phase 7) ──────────────────────────────────────

export interface RolePermissions {
  role: AppRole;
  permissions: string[];
}

export interface RoleCatalog {
  roles: RolePermissions[];
  catalog: string[];
  lockoutCritical: string[];
}

export function getRoles(): Promise<RoleCatalog> {
  return apiFetch("/api/admin/roles");
}

export function setRolePermissions(
  role: AppRole,
  permissions: string[],
): Promise<{ ok: boolean; permissions: string[] }> {
  return apiFetch(`/api/admin/roles/${role}/permissions`, {
    method: "PATCH",
    body: JSON.stringify({ permissions }),
  });
}

// ── Feature flags & platform settings (Phase 6) ─────────────────────────────

export interface FeatureFlag {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
}

export function getFeatureFlags(): Promise<{ flags: FeatureFlag[] }> {
  return apiFetch("/api/admin/feature-flags");
}

export function updateFeatureFlag(
  key: string,
  patch: { enabled?: boolean; description?: string | null },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/feature-flags/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export type PlatformSettings = Record<string, unknown>;

export function getPlatformSettings(): Promise<{ settings: PlatformSettings }> {
  return apiFetch("/api/admin/settings");
}

export function updatePlatformSettings(
  settings: PlatformSettings,
): Promise<{ ok: boolean }> {
  return apiFetch("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({ settings }),
  });
}

// ── Billing & revenue overview (Phase 5) ────────────────────────────────────

export interface BillingMrr {
  currency: string;
  amount_minor: number;
}

export interface BillingAcademyRow {
  id: string;
  name: string;
  status: AcademyStatus;
  billing_day: number | null;
  plan_code: string | null;
  plan_name: string | null;
  plan_price_minor: number | null;
  currency: string;
  active_addons: number;
  addons_total_minor: number;
  monthly_minor: number;
}

export interface BillingOverview {
  counts: { total: number; active: number; trial: number; suspended: number };
  mrr: BillingMrr[];
  academies: BillingAcademyRow[];
}

export function getBillingOverview(): Promise<BillingOverview> {
  return apiFetch("/api/admin/billing/overview");
}

// ── Cross-tenant user management (Phase 4) ──────────────────────────────────

export interface PlatformUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  academy_id: string | null;
  academy_name: string | null;
  roles: AppRole[];
  invited_at: string | null;
  created_at: string;
}

export interface PlatformUserRole {
  academy_id: string | null;
  academy_name: string | null;
  role: AppRole;
}

export interface PlatformUserDetail extends Omit<PlatformUser, "roles"> {
  roles: PlatformUserRole[];
}

export interface PlatformUserQuery {
  academy?: string;
  role?: AppRole;
  active?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PlatformUserResult {
  rows: PlatformUser[];
  total: number;
  page: number;
  pageSize: number;
}

export function listPlatformUsers(
  q: PlatformUserQuery = {},
): Promise<PlatformUserResult> {
  const s = new URLSearchParams();
  if (q.academy) s.set("academy", q.academy);
  if (q.role) s.set("role", q.role);
  if (q.active !== undefined) s.set("active", String(q.active));
  if (q.search) s.set("search", q.search);
  if (q.page) s.set("page", String(q.page));
  if (q.pageSize) s.set("pageSize", String(q.pageSize));
  const qs = s.toString();
  return apiFetch(`/api/admin/users${qs ? `?${qs}` : ""}`);
}

export function getPlatformUser(
  id: string,
): Promise<{ user: PlatformUserDetail }> {
  return apiFetch(`/api/admin/users/${id}`);
}

export function deactivateUser(
  id: string,
): Promise<{ ok: boolean; isActive: boolean }> {
  return apiFetch(`/api/admin/users/${id}/deactivate`, { method: "POST" });
}

export function reactivateUser(
  id: string,
): Promise<{ ok: boolean; isActive: boolean }> {
  return apiFetch(`/api/admin/users/${id}/reactivate`, { method: "POST" });
}

export function resetUserPassword(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/users/${id}/reset-password`, { method: "POST" });
}

export function setUserRole(
  id: string,
  input: { academy_id: string; role: "ACADEMY_OWNER" | "TEACHER"; grant: boolean },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/users/${id}/roles`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** The gated-feature catalog (FeatureCatalog) that drives the plan/add-on forms. */
export interface CapabilityCatalog {
  capabilities: Record<string, string>;
  limits: Record<string, string>;
  /** Boolean plan flags (e.g. recordingAllowed) — stored in features.limits as 1/0, fail open. */
  flags?: Record<string, string>;
}

export function getCapabilityCatalog(): Promise<CapabilityCatalog> {
  return apiFetch("/api/admin/capabilities");
}

export interface PlanInput {
  name: string;
  price_minor: number;
  currency: string;
  features: PlanFeatures;
  is_active: boolean;
}

export function createPlan(
  input: PlanInput & { code: string },
): Promise<{ planId: string }> {
  return apiFetch("/api/admin/plans", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePlan(
  id: string,
  patch: Partial<PlanInput>,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/plans/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export interface AddOnInput {
  name: string;
  price_minor: number;
  currency: string;
  feature_key: string;
}

export function createAddOn(
  input: AddOnInput & { code: string },
): Promise<{ addOnId: string }> {
  return apiFetch("/api/admin/add-ons", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAddOn(
  id: string,
  patch: Partial<AddOnInput>,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/add-ons/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Grants (active + revoked) for one academy. */
export interface AcademyAddOnGrant {
  add_on_id: string;
  is_active: boolean;
  granted_at: string;
  code: string;
  name: string;
  feature_key: string;
}

export function getAcademyAddOns(
  academyId: string,
): Promise<{ addOns: AcademyAddOnGrant[] }> {
  return apiFetch(`/api/admin/academies/${academyId}/addons`);
}

export function setAcademyPlan(
  academyId: string,
  planId: string,
): Promise<{ ok: boolean; changed?: boolean }> {
  return apiFetch(`/api/admin/academies/${academyId}/plan`, {
    method: "POST",
    body: JSON.stringify({ plan_id: planId }),
  });
}

export function setAcademyAddOn(
  academyId: string,
  addOnId: string,
  isActive: boolean,
): Promise<{ ok: boolean; isActive: boolean }> {
  return apiFetch(`/api/admin/academies/${academyId}/addons`, {
    method: "POST",
    body: JSON.stringify({ add_on_id: addOnId, is_active: isActive }),
  });
}

/**
 * POST /api/admin/academies/{id}/owner — (re)provision the academy's first owner login.
 * Idempotent: re-sends the set-password link if the owner already exists, else creates them.
 */
export function provisionAcademyOwner(
  academyId: string,
  input: { ownerFullName: string; ownerEmail: string },
): Promise<{ ownerId: string }> {
  return apiFetch(`/api/admin/academies/${academyId}/owner`, {
    method: "POST",
    body: JSON.stringify({
      owner_full_name: input.ownerFullName,
      owner_email: input.ownerEmail,
    }),
  });
}

export interface AcademyOwner {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

/** GET /api/admin/academies/{id}/owner — the current owner login, or null if none yet. */
export function getAcademyOwner(
  academyId: string,
): Promise<{ owner: AcademyOwner | null }> {
  return apiFetch(`/api/admin/academies/${academyId}/owner`);
}

/**
 * PATCH /api/admin/academies/{id}/owner — change the current owner's login email and/or reset
 * their password directly. At least one field must be provided.
 */
export function updateAcademyOwner(
  academyId: string,
  input: { email?: string; password?: string },
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/admin/academies/${academyId}/owner`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// ── Notifications & cancellation approvals (Notifications page) ────────────────

export type CancellationStatus = "PENDING" | "APPROVED" | "REJECTED";

/** One row of the cancellation-approval queue (Notifications "Classes" tab). */
export interface CancellationRequestRow {
  id: string;
  session_id: string;
  teacher_id: string;
  cancel_type: "teacher" | "student";
  reason: string | null;
  status: CancellationStatus;
  decided_at: string | null;
  decision_note: string | null;
  seen_by_teacher_at: string | null;
  created_at: string;
  scheduled_at_utc: string;
  duration_minutes: number;
  session_status: SessionStatus;
  student_name: string | null;
  teacher_name: string | null;
  decided_by_name: string | null;
}

export function listCancellationRequests(
  status?: CancellationStatus,
): Promise<{ requests: CancellationRequestRow[] }> {
  const qs = status ? `?status=${status}` : "";
  return apiFetch(`/api/cancellation-requests${qs}`);
}

export function approveCancellation(
  requestId: string,
  input: {
    note?: string;
    /** Owner's per-cancellation billing decision applied on approval. */
    charge_student?: boolean;
    pay_teacher?: boolean;
    /** Reason shown to the parent on the invoice line; defaults to the teacher's request reason. */
    reason?: string;
  } = {},
): Promise<{ ok: boolean; status: CancellationStatus; sessionStatus: string | null }> {
  return apiFetch(`/api/cancellation-requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function rejectCancellation(
  requestId: string,
  note?: string,
): Promise<{ ok: boolean; status: CancellationStatus; sessionStatus: string | null }> {
  return apiFetch(`/api/cancellation-requests/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export type NotificationType = "REPORT_OVERDUE" | "REPORT_REMINDER";

/** One report-overdue alert (Notifications "Reports" tab). */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  category: "REPORTS";
  session_id: string | null;
  data: {
    student_name?: string | null;
    teacher_name?: string | null;
    teacher_id?: string;
    scheduled_at_utc?: string;
    duration_minutes?: number;
    session_status?: string;
  };
  read_at: string | null;
  created_at: string;
}

export function listNotifications(): Promise<{ notifications: NotificationRow[] }> {
  return apiFetch("/api/notifications");
}

/** Unread counts that drive the sidebar badge, split by the tabs. */
export interface NotificationSummary {
  classes: number;
  reports: number;
  /** Pending student progress reports awaiting review (drives the tab badge, not the bell). */
  studentReports: number;
  total: number;
}

export function getNotificationsSummary(): Promise<NotificationSummary> {
  return apiFetch("/api/notifications/summary");
}

export function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(): Promise<{ ok: boolean; marked: number }> {
  return apiFetch("/api/notifications/read-all", { method: "POST" });
}

// ── Student progress reports (teacher writes → owner reviews) ──────────────────

export type StudentReportStatus = "PENDING" | "APPROVED" | "REJECTED";

/** A student in the calling teacher's report-form picker. */
export interface StudentReportStudent {
  id: string;
  full_name: string;
}

/** One monthly student progress report (teacher's own list, or the owner's review queue). */
export interface StudentReportRow {
  id: string;
  student_id: string;
  teacher_id: string;
  period_month: string; // YYYY-MM-DD (the 1st of the covered month)
  title: string;
  body: string;
  status: StudentReportStatus;
  review_note: string | null;
  reviewed_at: string | null;
  seen_by_teacher_at: string | null;
  created_at: string;
  student_name: string | null;
  reviewed_by_name: string | null;
  /** Present only on the owner's review queue. */
  teacher_name?: string | null;
}

export function listStudentReportStudents(): Promise<{ students: StudentReportStudent[] }> {
  return apiFetch("/api/student-reports/students");
}

export function listMyStudentReports(): Promise<{ reports: StudentReportRow[] }> {
  return apiFetch("/api/student-reports");
}

export function submitStudentReport(input: {
  student_id: string;
  period_month: string;
  title: string;
  body: string;
}): Promise<{ reportId: string; status: StudentReportStatus }> {
  return apiFetch("/api/student-reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listStudentReportsForReview(
  status?: StudentReportStatus,
): Promise<{ reports: StudentReportRow[] }> {
  const qs = status ? `?status=${status}` : "";
  return apiFetch(`/api/student-reports/review${qs}`);
}

export function approveStudentReport(
  id: string,
  note?: string,
): Promise<{ ok: boolean; status: StudentReportStatus }> {
  return apiFetch(`/api/student-reports/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function rejectStudentReport(
  id: string,
  note?: string,
): Promise<{ ok: boolean; status: StudentReportStatus }> {
  return apiFetch(`/api/student-reports/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

// ── Free Trials (Free-Trials module) ─────────────────────────────────────────

export type TrialStatus =
  | "SCHEDULED"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED"
  | "CONVERTED";

export interface TrialRow {
  id: string;
  teacher_id: string;
  teacher_name: string | null;
  student_id: string | null;
  student_name: string | null;
  lead_name: string | null;
  lead_whatsapp: string | null;
  lead_email: string | null;
  display_name: string | null;
  is_lead: boolean;
  timezone: string;
  scheduled_at_utc: string;
  duration_minutes: number;
  status: TrialStatus;
  outcome_notes: string | null;
  converted_student_id: string | null;
  created_at: string;
}

export interface TrialSummary {
  total: number;
  scheduled: number;
  upcoming: number;
  completed: number;
  no_show: number;
  cancelled: number;
  converted: number;
  /** Percentage of resolved trials that became students (0–100). */
  conversion_rate: number;
}

/** A teacher returned by the availability matcher for a requested slot. */
export interface TrialAvailabilityTeacher {
  id: string;
  full_name: string;
  specialization: string | null;
  session_rate_minor: number;
  currency: string;
  /** False when the teacher hasn't declared any availability windows. */
  availability_known: boolean;
  /** True when their declared availability covers the requested slot. */
  available: boolean;
  /** True when they already have an overlapping session or trial. */
  has_conflict: boolean;
}

export interface TrialAvailabilityResult {
  slot: {
    scheduled_at_utc: string;
    timezone: string;
    weekday: number;
    duration_minutes: number;
  };
  teachers: TrialAvailabilityTeacher[];
}

/** A whole week of bookable slots for the calendar finder. */
export interface TrialAvailabilityGrid {
  week_start: string;
  timezone: string;
  duration_minutes: number;
  /** Row labels — candidate local start times "HH:mm", sorted. */
  times: string[];
  /** Column headers — the 7 dates of the week. */
  days: { date: string; weekday: number }[];
  /** Keyed "YYYY-MM-DDTHH:mm" → teachers available for that slot (only non-empty cells). */
  cells: Record<string, TrialAvailabilityTeacher[]>;
}

export interface TrialWarning {
  type: string;
  message: string;
  detail?: unknown;
}

export interface TrialInput {
  teacher_id: string;
  student_id?: string | null;
  lead_name?: string | null;
  lead_whatsapp?: string | null;
  lead_email?: string | null;
  /** Local wall-clock "YYYY-MM-DD HH:mm" interpreted in `timezone`. */
  local_datetime?: string;
  scheduled_at_utc?: string;
  timezone?: string | null;
  duration_minutes: number;
  outcome_notes?: string | null;
}

export function listTrials(
  q: DataTableQuery = {},
): Promise<ListResult<TrialRow>> {
  return apiFetch(`/api/trials${toQueryString(q)}`);
}

export function getTrialSummary(): Promise<TrialSummary> {
  return apiFetch("/api/trials/summary");
}

/** GET /api/trials/availability — who can take a trial at a given local date + time. */
export function findAvailableTeachers(params: {
  date: string;
  time: string;
  duration_minutes: number;
  timezone?: string;
  specialization?: string;
}): Promise<TrialAvailabilityResult> {
  const qs = new URLSearchParams({
    date: params.date,
    time: params.time,
    duration_minutes: String(params.duration_minutes),
  });
  if (params.timezone) qs.set("timezone", params.timezone);
  if (params.specialization) qs.set("specialization", params.specialization);
  return apiFetch(`/api/trials/availability?${qs.toString()}`);
}

/** GET /api/trials/availability-grid — a week of bookable slots for the calendar finder. */
export function getAvailabilityGrid(params: {
  week_start: string;
  duration_minutes: number;
  timezone?: string;
  specialization?: string;
}): Promise<TrialAvailabilityGrid> {
  const qs = new URLSearchParams({
    week_start: params.week_start,
    duration_minutes: String(params.duration_minutes),
  });
  if (params.timezone) qs.set("timezone", params.timezone);
  if (params.specialization) qs.set("specialization", params.specialization);
  return apiFetch(`/api/trials/availability-grid?${qs.toString()}`);
}

export function createTrial(
  input: TrialInput,
): Promise<{ trialId: string; warnings: TrialWarning[] }> {
  return apiFetch("/api/trials", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTrial(
  id: string,
  patch: Partial<TrialInput> & { status?: TrialStatus },
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/trials/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Link a completed lead trial to the real student it became (POST /students happens first). */
export function convertTrial(
  id: string,
  studentId: string,
): Promise<{ ok: boolean; studentId: string }> {
  return apiFetch(`/api/trials/${id}/convert`, {
    method: "POST",
    body: JSON.stringify({ student_id: studentId }),
  });
}

export function cancelTrial(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/trials/${id}`, { method: "DELETE" });
}

// ── Video classroom (docs/video-platform) ────────────────────────────────────
// Management surface for the self-hosted LiveKit rooms + recordings. Plan-gated by
// video.conferencing (402) and capability-gated by room.* / recording.view (403); the
// live call itself runs in the Flutter client. Transport only — rules live in the API.

export type VideoRoomStatus = "ACTIVE" | "ARCHIVED";

/**
 * Per-room access settings (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §4), stored in the
 * room's config JSONB and enforced server-side at /join. Every password is OPTIONAL (null = none).
 */
export interface RoomAccessSettings {
  guest_password: string | null;
  host_password: string | null;
  waiting_room: boolean;
  recording_enabled: boolean;
  require_host_present: boolean;
  mute_guests_on_join: boolean;
  allow_guest_screenshare: boolean;
  max_participants: number | null;
  monitor_enabled: boolean;
  /** Disclose monitoring to participants. false = COVERT (no notice, recording indicator hidden). */
  monitor_disclose: boolean;
}

export interface VideoRoom {
  id: string;
  name: string;
  teacher_id: string | null;
  status: VideoRoomStatus;
  /**
   * Auto-generated SHORT guest link → /r/{join_token} (08-ROOM-ACCESS §14), e.g.
   * `halaqa-live-k3p9x` (publish+subscribe). This is the link shown everywhere in the panel.
   */
  join_token: string;
  /** Auto-generated SHORT host link → /r/{host_token} (full control, no login). room.manage only. */
  host_token?: string;
  /** Auto-generated SHORT monitor link → /r/{monitor_token} (hidden supervisor). room.monitor only. */
  monitor_token?: string;
  /** Legacy academy-chosen slug → /r/{academy_subdomain}/{slug}; retired for new rooms (§14). */
  slug?: string | null;
  /** The academy's subdomain — combined with slug to build the legacy readable guest URL. */
  academy_subdomain?: string | null;
  /** Access settings (defaults backfilled by the API), surfaced in the room modal. */
  config?: RoomAccessSettings;
  created_at: string;
}

export type RecordingStatus =
  | "STARTING"
  | "RECORDING"
  | "COMPLETED"
  | "FAILED"
  | "ABORTED";

export interface RoomRecording {
  id: string;
  room_id: string;
  session_id: string | null;
  student_id: string | null;
  status: RecordingStatus;
  duration_s: number | null;
  bytes: number | null;
  started_at: string | null;
  ended_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface VideoRoomInput {
  name?: string;
  teacher_id?: string | null;
  status?: VideoRoomStatus;
  /** Partial access-settings patch — only the provided keys are merged into the room's config. */
  settings?: Partial<RoomAccessSettings>;
}

export function listVideoRooms(): Promise<{ rooms: VideoRoom[] }> {
  return apiFetch("/api/video/rooms");
}

export function createVideoRoom(
  input: VideoRoomInput,
): Promise<{ roomId: string }> {
  return apiFetch("/api/video/rooms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateVideoRoom(
  id: string,
  patch: VideoRoomInput,
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/video/rooms/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteVideoRoom(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/video/rooms/${id}`, { method: "DELETE" });
}

/** Which room link to regenerate (08-ROOM-ACCESS §2). `monitor` requires room.monitor. */
export type RoomLinkKind = "guest" | "host" | "monitor";

/**
 * Regenerate one of a room's shareable links, invalidating its previously-shared URL. Returns the
 * fresh token (and, for back-compat, the column-named key for the guest default).
 */
export function rotateRoomLink(
  id: string,
  which: RoomLinkKind = "guest",
): Promise<{ which: string; token: string; join_token?: string; host_token?: string }> {
  return apiFetch(`/api/video/rooms/${id}/rotate-link`, {
    method: "POST",
    body: JSON.stringify({ which }),
  });
}

/**
 * The public shareable URL for a room token (/r/{token}). The token is now an auto-generated SHORT
 * link (`{kebab-name}-{code}`, 08-ROOM-ACCESS §14) — guest join_token, host_token or monitor_token.
 */
export function roomShareUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/r/${token}`;
}

/** The readable guest URL for a slugged room (/r/{academy}/{slug}), or null if not slugged. */
export function roomSlugUrl(
  academySubdomain: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  if (!academySubdomain || !slug) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/r/${academySubdomain}/${slug}`;
}

// ── Per-room access log (08-ROOM-ACCESS §15) ─────────────────────────────────

/** One access session — a participant's join/leave history for the room. */
export interface RoomLogSession {
  id: string;
  identity: string;
  display_name: string | null;
  user_id: string | null;
  /** Full name of the authenticated joiner (null for anonymous guests). */
  user_name: string | null;
  role: "HOST" | "CO_HOST" | "PARTICIPANT" | string;
  joined_at: string | null;
  left_at: string | null;
  /** Seconds in the room (null while still connected / ongoing). */
  duration_s: number | null;
  ongoing: boolean;
}

/** One audited action on the room (create / update / rotate-link / knock / monitor-join …). */
export interface RoomLogEvent {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface RoomLogStats {
  total_sessions: number;
  unique_participants: number;
  total_seconds: number;
  last_access: string | null;
}

export interface RoomLogs {
  room: { id: string; name: string; status: VideoRoomStatus; created_at: string };
  sessions: RoomLogSession[];
  events: RoomLogEvent[];
  stats: RoomLogStats;
  /** True when the session/event lists were capped (most-recent N only). */
  truncated: boolean;
}

/** Fetch a room's access log: who joined, when, for how long, plus every audited action. */
export function getRoomLogs(id: string): Promise<RoomLogs> {
  return apiFetch(`/api/video/rooms/${id}/logs`);
}

/** Mint a scoped LiveKit access token for the current user to join this room. */
export function getVideoRoomToken(
  id: string,
): Promise<{ url: string; token: string; room: string; identity: string }> {
  return apiFetch(`/api/video/rooms/${id}/token`, { method: "POST" });
}

/** The credential + identity a join-by-link request returns (mirrors VideoJoinController). */
export interface JoinRoomResponse {
  /** Present (=`"admitted"`) on the waiting-room admit poll; absent on a direct join. */
  state?: "admitted";
  /** wss/ws SFU connect URL. */
  url: string;
  /** Short-lived scoped LiveKit access token. */
  token: string;
  /** LiveKit room name to connect to. */
  roomName: string;
  /** Human-friendly room name for the lobby/header. */
  roomTitle: string;
  /** The room's UUID — lets a host drive recording (start/stop) from the call. */
  roomId: string;
  /** The participant identity encoded in the token. */
  identity: string;
  /** Resolved display name (server uses the host's real name; null if none). */
  displayName: string | null;
  /** How the caller was admitted. `monitor` = a hidden supervisor (08-ROOM-ACCESS §5). */
  role: "host" | "guest" | "monitor";
  /** Host admin (holds room.manage): may record AND moderate (mute/remove/end). */
  canManage: boolean;
  /**
   * Waiting-room manage credential (= the room's host_token, 08-ROOM-ACCESS §13.5). Present only for
   * host-role joiners; lets the client poll + admit/deny the knock queue. null for guests/monitors.
   */
  manageToken?: string | null;
  /** Recording allowed for this room (gates the record button alongside canManage). */
  recordingEnabled?: boolean;
  /** Guests start with the mic off when true. */
  muteOnJoin?: boolean;
  /** Show a "may be monitored & recorded" notice (monitor-enabled + disclosure on). */
  monitorDisclosure?: boolean;
  /** Covert monitoring — hide the live recording indicator from participants. */
  suppressRecordingIndicator?: boolean;
}

/**
 * A guest hitting a waiting-room room is not minted a token — instead they get a "knocking" state
 * with a knock_token to poll until a host admits them (08-ROOM-ACCESS §13).
 */
export interface KnockingResponse {
  state: "knocking";
  /** The bearer secret the waiting guest polls with (pollKnock). */
  knockToken: string;
  roomId: string;
  roomTitle: string;
}

/** A join-by-link returns either a real credential (direct join) or a "knocking" state (waiting room). */
export type JoinResult = JoinRoomResponse | KnockingResponse;

/** True when a join result is the waiting-room "knocking" state rather than a real credential. */
export function isKnocking(r: JoinResult): r is KnockingResponse {
  return (r as KnockingResponse).state === "knocking";
}

/**
 * Join a room via its shareable link token (public POST /api/video/join/{token}). A logged-in
 * host is detected server-side from the session cookie; everyone else joins as a guest and must
 * supply a display name. A `waiting_room` room returns a `KnockingResponse` for guests instead of a
 * token. Throws ApiError 404 (unknown/archived room) or 422 (guest needs a name).
 */
export function joinRoom(
  token: string,
  displayName?: string,
  password?: string,
): Promise<JoinResult> {
  return apiFetch(`/api/video/join/${token}`, {
    method: "POST",
    body: JSON.stringify(joinBody(displayName, password)),
  });
}

/**
 * Join via the readable per-academy slug link (/r/{academy}/{slug} → POST /video/join-slug/…). Always
 * a guest link; a slugged room requires a guest password OR the waiting room (08-ROOM-ACCESS §3/§13).
 */
export function joinRoomBySlug(
  academy: string,
  room: string,
  displayName?: string,
  password?: string,
): Promise<JoinResult> {
  return apiFetch(`/api/video/join-slug/${academy}/${room}`, {
    method: "POST",
    body: JSON.stringify(joinBody(displayName, password)),
  });
}

function joinBody(displayName?: string, password?: string): Record<string, string> {
  const body: Record<string, string> = {};
  const name = displayName?.trim();
  if (name) body.display_name = name;
  if (password) body.password = password;
  return body;
}

// ── Waiting room (08-ROOM-ACCESS §13) ────────────────────────────────────────────────

/** The result of a waiting guest's poll: still waiting, refused, timed out, or admitted (full creds). */
export type KnockPoll =
  | { state: "knocking" }
  | { state: "denied" }
  | { state: "expired" }
  | JoinRoomResponse; // state: "admitted"

/** True when a knock poll resolved to an admitted credential (token minted). */
export function isAdmitted(p: KnockPoll): p is JoinRoomResponse {
  return (p as JoinRoomResponse).state === "admitted";
}

/**
 * The waiting guest's short-poll (public POST /api/video/knock/{knockToken}). While PENDING it returns
 * `knocking`; once a host admits, it returns the full join credential (the token is minted here).
 */
export function pollKnock(knockToken: string): Promise<KnockPoll> {
  return apiFetch(`/api/video/knock/${knockToken}`, { method: "POST" });
}

/** A pending entry request shown in the host's waiting-room queue. */
export interface PendingKnock {
  id: string;
  displayName: string;
  createdAt: string;
}

/** The host's pending-knock queue, authenticated by the manage credential (= the room's host_token). */
export function listKnocks(manageToken: string): Promise<{ knocks: PendingKnock[] }> {
  return apiFetch(`/api/video/manage/${manageToken}/knocks`);
}

export type KnockDecision = "admit" | "deny";

/** Admit or deny a knocker (host action, authenticated by the manage credential). Idempotent. */
export function decideKnock(
  manageToken: string,
  knockId: string,
  decision: KnockDecision,
): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/api/video/manage/${manageToken}/knocks/${knockId}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export function listVideoRecordings(
  roomId?: string,
): Promise<{ recordings: RoomRecording[] }> {
  const q = roomId ? `?room_id=${encodeURIComponent(roomId)}` : "";
  return apiFetch(`/api/video/recordings${q}`);
}

/** A short-lived presigned URL to play/download a COMPLETED recording (recording.view). */
export function getRecordingUrl(id: string): Promise<{ url: string }> {
  return apiFetch(`/api/video/recordings/${id}/url`);
}

/** Permanently delete a recording (management action, room.manage). Removes the stored file + row. */
export function deleteRecording(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/video/recordings/${id}`, { method: "DELETE" });
}

/**
 * Start an on-demand recording. A host running the call holds the manage credential (= the room's
 * host_token), so the no-login host link drives recording from the link alone; a logged-in manager
 * without one falls back to the session-authenticated room endpoint.
 */
export function startRoomRecording(roomId: string, manageToken?: string | null): Promise<{ recordingId: string }> {
  const path = manageToken
    ? `/api/video/manage/${manageToken}/recording`
    : `/api/video/rooms/${roomId}/recording`;
  return apiFetch(path, { method: "POST" });
}

/** Stop the room's active recording (host link via manageToken, else session-authenticated). */
export function stopRoomRecording(roomId: string, manageToken?: string | null): Promise<{ ok: boolean }> {
  const path = manageToken
    ? `/api/video/manage/${manageToken}/recording`
    : `/api/video/rooms/${roomId}/recording`;
  return apiFetch(path, { method: "DELETE" });
}

// ── In-call host moderation (server-mediated SFU admin) ───────────────────────
// Each action works from the no-login HOST LINK (manageToken = host_token) or, for a logged-in
// manager without one, the session-authenticated room endpoint. Possession of the link is authority.

/** Force-mute a participant's microphone. */
export function muteParticipant(roomId: string, identity: string, manageToken?: string | null): Promise<{ ok: boolean }> {
  const id = encodeURIComponent(identity);
  const path = manageToken
    ? `/api/video/manage/${manageToken}/participants/${id}/mute`
    : `/api/video/rooms/${roomId}/participants/${id}/mute`;
  return apiFetch(path, { method: "POST" });
}

/** Force a participant's camera off (host "stop video"). They can re-enable it themselves. */
export function muteParticipantVideo(roomId: string, identity: string, manageToken?: string | null): Promise<{ ok: boolean }> {
  const id = encodeURIComponent(identity);
  const path = manageToken
    ? `/api/video/manage/${manageToken}/participants/${id}/mute-video`
    : `/api/video/rooms/${roomId}/participants/${id}/mute-video`;
  return apiFetch(path, { method: "POST" });
}

/** Remove (kick) a participant from the call. */
export function removeParticipant(roomId: string, identity: string, manageToken?: string | null): Promise<{ ok: boolean }> {
  const id = encodeURIComponent(identity);
  const path = manageToken
    ? `/api/video/manage/${manageToken}/participants/${id}/remove`
    : `/api/video/rooms/${roomId}/participants/${id}/remove`;
  return apiFetch(path, { method: "POST" });
}

/** End the live call for everyone (the room stays available to rejoin later). */
export function endRoomForAll(roomId: string, manageToken?: string | null): Promise<{ ok: boolean }> {
  const path = manageToken ? `/api/video/manage/${manageToken}/end` : `/api/video/rooms/${roomId}/end`;
  return apiFetch(path, { method: "POST" });
}
