import type {
  AcademyStatus,
  HealthResponse,
  InvoiceGrouping,
  ReportFieldType,
  SessionStatus,
} from "@academiq/contracts";
// The LMS public site's content shape is defined once, next to the client that reads it on the site
// itself (docs/lms/09); the staff editor here writes exactly the same document.
import { apiBase } from "@/lib/api-base";
import type { LearnSiteContent } from "@/lib/learn-api";

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
// Resolved per call, not once: with a port-only NEXT_PUBLIC_API_URL the origin follows the page
// host, which is what lets a client subdomain talk to a same-site API (see lib/api-base).
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
  await fetch(`${apiBase()}/sanctum/csrf-cookie`, { credentials: "include" });
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
    // FormData sets its own multipart Content-Type (with the boundary) — overriding it here would
    // make the body unparseable server-side, so JSON is the default for everything else only.
    if (init.body !== undefined && !(init.body instanceof FormData)) {
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

    return fetch(`${apiBase()}${path}`, {
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
  /**
   * The academy's resolved plan capabilities, delivered with the session so the shell can gate the
   * nav without a second round-trip. `null` = no academy scope (a platform Super Admin has no plan)
   * — distinct from `[]`, an academy whose plan grants nothing. For limits/usage/add-ons, the
   * fuller `getEntitlements()` payload is still the source.
   */
  capabilities: string[] | null;
  /**
   * WHO the panel belongs to — the academy's name and logo, for the shell's own chrome. Ships with
   * the session for the same reason `capabilities` does: the sidebar paints before anything else.
   * `null` for a platform Super Admin, who has no academy — the chrome then keeps the platform's
   * own identity.
   */
  academy: SessionAcademy | null;
}

export interface SessionAcademy {
  name: string;
  /** The brand name when the client set one, else the academy name. Never empty. */
  displayName: string;
  logoUrl: string | null;
}

export interface LoginResult {
  role: AppRole;
  academyId: string | null;
}

/**
 * POST /api/auth/login — email/password → established Sanctum session.
 *
 * `subdomain` is the client handle the sign-in came through (`<handle>.<root>`). Sent only from a
 * client's own door, where the API binds the attempt to that client's people; the platform login
 * omits it.
 */
export function login(
  email: string,
  password: string,
  subdomain?: string | null,
): Promise<LoginResult> {
  return apiFetch<LoginResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(
      subdomain ? { email, password, subdomain } : { email, password },
    ),
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
  /** The sellable module this plan belongs to (R1, plans.module). */
  module?: ModuleCode;
  is_active: boolean;
}

/** The wizard payload for creating a client + seeding fields + first owner. */
export interface CreateAcademyInput {
  name: string;
  academy_type_id: string;
  /** Which of the four client types this is (05 §2); defaults to MANAGEMENT server-side. */
  client_type?: ClientType;
  /** Extra modules to provision beyond the type's own, each at its own price. */
  modules?: {
    module: ModuleCode;
    price_minor?: number;
    billing_interval?: "MONTHLY" | "YEARLY";
  }[];
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

/**
 * POST /api/admin/academies/{id}/logo — upload the client's logo (≤ 2 MB png/jpg/webp). The API
 * stores the file and writes `brand_logo_url`, the one column their sign-in page, their subdomain
 * and their learner site all read, so the new logo shows up everywhere without a second save.
 */
export function uploadAcademyLogo(
  id: string,
  file: File,
): Promise<{ ok: boolean; brand_logo_url: string }> {
  const body = new FormData();
  body.append("logo", file);
  return apiFetch(`/api/admin/academies/${id}/logo`, { method: "POST", body });
}

/** DELETE /api/admin/academies/{id}/logo — clear it; the surfaces fall back to the client's name. */
export function deleteAcademyLogo(
  id: string,
): Promise<{ ok: boolean; brand_logo_url: null }> {
  return apiFetch(`/api/admin/academies/${id}/logo`, { method: "DELETE" });
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

// ── Client-first Super Admin surface (docs/superadmin-modules/05-MODULES-NOT-PACKAGES) ──────
// A client is one of four TYPES and holds the MODULES that type allows, each with its own price,
// trial clock and lifecycle. A module grants every feature it owns; the client profile is where a
// single feature gets switched off. These endpoints are THE one writer for all of it.

export type ClientType = "MANAGEMENT" | "VIDEO" | "WHATSAPP" | "LMS";

export const CLIENT_TYPES: readonly ClientType[] = [
  "MANAGEMENT",
  "VIDEO",
  "WHATSAPP",
  "LMS",
];

export type ModuleCode = "MANAGEMENT" | "VIDEO" | "WHATSAPP" | "LMS";

export const MODULE_CODES: readonly ModuleCode[] = [
  "MANAGEMENT",
  "VIDEO",
  "WHATSAPP",
  "LMS",
];

/** Which modules each client type may hold — mirrors FeatureCatalog::CLIENT_TYPE_MODULES. */
export const CLIENT_TYPE_MODULES: Record<ClientType, ModuleCode[]> = {
  MANAGEMENT: ["MANAGEMENT", "VIDEO", "WHATSAPP"],
  VIDEO: ["VIDEO"],
  WHATSAPP: ["WHATSAPP"],
  LMS: ["LMS"],
};

/** One module's live subscription as returned by the client endpoints. */
export interface ModuleSubscription {
  id: string;
  module: ModuleCode;
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
  overrides: Record<string, unknown> | string | null;
  plan_id: string | null;
  plan_code?: string | null;
  plan_name?: string | null;
}

/** The per-module chip summary each directory row carries. */
export interface ClientModuleChip {
  module: ModuleCode;
  status: "ACTIVE" | "PAUSED";
  is_trial: boolean;
  trial_end: string | null;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  billing_interval: "MONTHLY" | "YEARLY";
  current_period_end: string | null;
  total_cost_minor: number;
  currency: string;
}

export interface ClientDirectoryEntry {
  id: string;
  name: string;
  client_type: ClientType;
  status: "ACTIVE" | "TRIAL" | "SUSPENDED";
  suspended_reason: string | null;
  default_currency: string;
  timezone: string;
  subdomain: string | null;
  created_at: string;
  owner_email: string | null;
  student_count: number;
  teacher_count: number;
  modules: ClientModuleChip[];
}

/**
 * What a client's modules can switch: every capability the module owns (key → label) and the caps
 * a Super Admin may set. The profile renders its toggles straight off this, so it can never offer a
 * key the server would reject.
 */
export interface ClientFeatureCatalog {
  clientType: ClientType;
  allowedModules: ModuleCode[];
  modules: Partial<
    Record<
      ModuleCode,
      { capabilities: Record<string, string>; limits: Record<string, string> }
    >
  >;
}

export interface ClientDetail {
  client: {
    id: string;
    name: string;
    client_type: ClientType;
    status: "ACTIVE" | "TRIAL" | "SUSPENDED";
    suspended_at: string | null;
    suspended_reason: string | null;
    plan_id: string | null;
    default_currency: string;
    timezone: string;
    invoice_grouping: string;
    billing_day: number;
    brand_display_name: string | null;
    brand_logo_url: string | null;
    subdomain: string | null;
    created_at: string;
  };
  catalog: ClientFeatureCatalog;
  modules: ModuleSubscription[];
  addOns: {
    code: string;
    name: string;
    feature_key: string;
    price_minor: number;
    currency: string;
  }[];
}

export function listClients(): Promise<{ clients: ClientDirectoryEntry[] }> {
  return apiFetch("/api/admin/clients");
}

export function getClient(id: string): Promise<ClientDetail> {
  return apiFetch(`/api/admin/clients/${id}`);
}

/**
 * Provision a WHATSAPP-ONLY external client (R4, M-CLI-2): a lightweight client with NO owner
 * login — connected by QR from its client page and served over the external API.
 */
export function createWhatsappOnlyClient(input: {
  name: string;
  mode: "trial" | "active";
  trial_days?: number;
  price_minor?: number;
  billing_interval?: "MONTHLY" | "YEARLY";
}): Promise<{ clientId: string }> {
  return apiFetch("/api/admin/clients", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Enable a module at this client's own price, on a trial or an immediately-active paid period. */
export function enableClientModule(
  clientId: string,
  module: ModuleCode,
  input: {
    mode: "trial" | "active";
    trial_days?: number;
    price_minor?: number;
    currency?: string;
    billing_interval?: "MONTHLY" | "YEARLY";
  },
): Promise<{ subscription: ModuleSubscription }> {
  return apiFetch(
    `/api/admin/clients/${clientId}/modules/${module.toLowerCase()}/subscription`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateClientModule(
  clientId: string,
  module: ModuleCode,
  patch: {
    price_minor?: number;
    currency?: string;
    billing_interval?: "MONTHLY" | "YEARLY";
    activated_at?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
  },
): Promise<{ subscription: ModuleSubscription }> {
  return apiFetch(
    `/api/admin/clients/${clientId}/modules/${module.toLowerCase()}/subscription`,
    { method: "PUT", body: JSON.stringify(patch) },
  );
}

/**
 * The per-client feature switches (05 §4): `disabled` lists the module features this ONE client
 * does not get; `limits` is its optional cap map (omit a key ⇒ unlimited). Sending `disabled: []`
 * restores the module's full feature set.
 */
export function updateClientModuleFeatures(
  clientId: string,
  module: ModuleCode,
  input: { disabled?: string[]; limits?: Record<string, number> | null },
): Promise<{ subscription: ModuleSubscription }> {
  return apiFetch(
    `/api/admin/clients/${clientId}/modules/${module.toLowerCase()}/features`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function extendClientModuleTrial(
  clientId: string,
  module: ModuleCode,
  days: number,
): Promise<{ subscription: ModuleSubscription }> {
  return apiFetch(
    `/api/admin/clients/${clientId}/modules/${module.toLowerCase()}/subscription/trial`,
    { method: "POST", body: JSON.stringify({ days }) },
  );
}

export function activateClientModule(
  clientId: string,
  module: ModuleCode,
): Promise<{ subscription: ModuleSubscription }> {
  return apiFetch(
    `/api/admin/clients/${clientId}/modules/${module.toLowerCase()}/subscription/activate`,
    { method: "POST" },
  );
}

export function pauseClientModule(
  clientId: string,
  module: ModuleCode,
): Promise<{ subscription: ModuleSubscription }> {
  return apiFetch(
    `/api/admin/clients/${clientId}/modules/${module.toLowerCase()}/subscription/pause`,
    { method: "POST" },
  );
}

export function endClientModule(
  clientId: string,
  module: ModuleCode,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/admin/clients/${clientId}/modules/${module.toLowerCase()}/subscription/end`,
    { method: "POST" },
  );
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
  /** Per-module composition snapshot at generation (R3, M-BILL-1); jsonb may arrive stringified. */
  module_breakdown?:
    | { module: ModuleCode; total_minor: number; currency: string }[]
    | string
    | null;
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
  return apiFetch(
    `/api/admin/academies/${academyId}/bills/${billId}/mark-paid`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
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
): Promise<{
  ok: boolean;
  transport: string;
  error: string | null;
  deeplink: string;
}> {
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

// ── External WhatsApp API: per-academy API keys + public connect link (Super Admin) ──

export interface WhatsAppApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** The academy's API keys (never the secret — only prefix + metadata). */
export function getApiKeys(
  academyId: string,
): Promise<{ keys: WhatsAppApiKey[] }> {
  return apiFetch(`/api/admin/academies/${academyId}/api-keys`);
}

/** Mint a new API key. The `key` (plaintext) is returned ONCE here and never again. */
export function createApiKey(
  academyId: string,
  name: string,
): Promise<{ id: string; name: string; key_prefix: string; key: string }> {
  return apiFetch(`/api/admin/academies/${academyId}/api-keys`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Revoke a key (irreversible). */
export function revokeApiKey(
  academyId: string,
  keyId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/academies/${academyId}/api-keys/${keyId}`, {
    method: "DELETE",
  });
}

/** Mint a fresh, expiring public QR-connect link. Returns a relative path (prepend the app origin). */
export function createConnectLink(
  academyId: string,
): Promise<{ path: string; expires_at: string }> {
  return apiFetch(`/api/admin/academies/${academyId}/connect-link`, {
    method: "POST",
  });
}

// ── Public QR-connect flow (no login; token-in-path). Uses apiFetch so the XSRF token is primed
// like every other public POST in the app (a raw fetch 419s under Sanctum's stateful CSRF guard).

export interface WhatsAppConnectState {
  state: string;
  qr?: string | null;
}

/** Start a gateway session for a shared connect token and return the first QR. */
export function waConnectStart(token: string): Promise<WhatsAppConnectState> {
  return apiFetch(`/api/wa/connect/${token}/start`, { method: "POST" });
}

/** Poll the current pairing QR + state. */
export function waConnectQr(token: string): Promise<WhatsAppConnectState> {
  return apiFetch(`/api/wa/connect/${token}/qr`);
}

/** Poll the connection status. */
export function waConnectStatus(token: string): Promise<{ state: string }> {
  return apiFetch(`/api/wa/connect/${token}/status`);
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
  api_key_count: number;
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
export function getWhatsappActivity(
  limit = 50,
): Promise<{ activity: WhatsAppActivityRow[] }> {
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
export function getGatewaySettings(): Promise<{
  ok: boolean;
  settings?: GatewaySettings;
}> {
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

/** Effective per-client video state, derived from its VIDEO module subscription (05 §7). */
export type VideoAccessStatus =
  | "ENABLED" // holds the module, paid
  | "TRIAL" // holds the module, inside its trial window
  | "PAUSED" // module paused — the classroom is off until it resumes
  | "EXPIRED" // a trial that has lapsed
  | "DISABLED" // the ops force-off switch
  | "NONE"; // does not hold the module

export type VideoAccessOverride = "ENABLED" | "DISABLED" | null;

export interface VideoUsageRow {
  academy_id: string;
  academy_name: string;
  currency: string | null;
  client_type?: ClientType;
  /** Legacy package columns — always null since 05-MODULES-NOT-PACKAGES; dropped with the tables. */
  plan_name?: string | null;
  plan_code?: string | null;
  video_plan_name?: string | null;
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
    /** Effective video limits/flags (per-academy override wins, then the tier, then the plan). */
    video_limits: Record<string, number>;
    /** Raw per-academy meet-option override (null ⇒ inherit from plan/tier). */
    video_overrides: VideoMeetOptions | null;
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
export function getVideoAcademyRoomLog(
  academyId: string,
  roomId: string,
): Promise<VideoAdminRoomLog> {
  return apiFetch(
    `/api/admin/video/academies/${academyId}/rooms/${roomId}/logs`,
  );
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

/** Per-academy "meet options" — the video limits/flags a Super Admin can vary per academy. */
export interface VideoMeetOptions {
  maxRooms?: number | null;
  maxRoomParticipants?: number | null;
  recordingRetentionDays?: number | null;
  recordingAllowed?: 0 | 1 | boolean | null;
  monitorAllowed?: 0 | 1 | boolean | null;
}

export interface VideoAccessPayload {
  action: VideoAccessAction;
  trial_days?: number | null;
  video_plan_id?: string | null;
  /** Free-form per-academy override; present ⇒ replace (empty clears), absent ⇒ leave untouched. */
  overrides?: VideoMeetOptions | null;
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

// ── Super Admin LMS oversight (docs/lms) ─────────────────────────────────────

/** Effective LMS module status, derived from the client's LMS module subscription. */
export type LmsStatus = "ACTIVE" | "TRIAL" | "EXPIRED" | "PAUSED" | "NONE";

export type LmsCourseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface LmsUsageRow {
  academy_id: string;
  academy_name: string;
  subdomain: string | null;
  created_at: string;
  plan_name: string | null;
  lms_plan_name: string | null;
  lms_status: LmsStatus;
  lms_enabled: boolean;
  trial_end: string | null;
  max_courses: number | null;
  max_learners: number | null;
  max_storage_gb: number | null;
  courses_total: number;
  courses_published: number;
  courses_draft: number;
  lessons: number;
  learners: number;
  active_learners: number;
  enrollments: number;
  active_enrollments: number;
  codes: number;
  active_codes: number;
  redeemed_codes: number;
  storage_bytes: number;
  media_processing: number;
  media_failed: number;
  certificates: number;
  last_activity: string | null;
}

export interface LmsUsageTotals {
  academies: number;
  active: number;
  trial: number;
  courses: number;
  published_courses: number;
  lessons: number;
  learners: number;
  enrollments: number;
  redeemed_codes: number;
  storage_bytes: number;
  certificates: number;
}

/** The LMS client roster (catalogue, learners, enrolment, storage) + platform totals. */
export function getLmsUsage(): Promise<{
  academies: LmsUsageRow[];
  totals: LmsUsageTotals;
}> {
  return apiFetch("/api/admin/lms/usage");
}

/** The per-academy LMS capacity caps a Super Admin can override (null ⇒ inherit the plan). */
export interface LmsLimits {
  maxCourses?: number | null;
  maxLearners?: number | null;
  maxStorageGb?: number | null;
}

export interface LmsAcademyCourse {
  id: string;
  title: string;
  slug: string;
  status: LmsCourseStatus;
  created_at: string;
  published_at: string | null;
  lessons: number;
  learners: number;
}

export interface LmsAcademyLearner {
  id: string;
  full_name: string;
  email: string;
  status: "ACTIVE" | "BLOCKED";
  created_at: string;
  last_login_at: string | null;
  enrollments: number;
}

export interface LmsAcademyDetail {
  academy: {
    id: string;
    name: string;
    subdomain: string | null;
    created_at: string;
    currency: string | null;
    plan_name: string | null;
    lms_plan_name: string | null;
    lms_status: LmsStatus;
    lms_enabled: boolean;
    trial_start: string | null;
    trial_end: string | null;
    /** Effective caps (the per-academy override wins over the LMS plan's limits). */
    lms_limits: LmsLimits;
    /** Raw per-academy override (null ⇒ inheriting the plan's caps). */
    lms_overrides: LmsLimits | null;
  };
  subscription: {
    status: string;
    is_trial: boolean;
    trial_start: string | null;
    trial_end: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    total_cost_minor: number;
    currency: string | null;
    plan_name: string | null;
  } | null;
  stats: {
    courses_total: number;
    courses_published: number;
    courses_draft: number;
    lessons: number;
    learners: number;
    active_learners: number;
    enrollments: number;
    active_enrollments: number;
    codes: number;
    active_codes: number;
    redeemed_codes: number;
    storage_bytes: number;
    media_processing: number;
    media_failed: number;
    certificates: number;
    quiz_attempts: number;
    completed_lessons: number;
  };
  courses: LmsAcademyCourse[];
  learners: LmsAcademyLearner[];
  recent_enrollments: {
    id: string;
    learner_name: string;
    course_title: string;
    enrolled_at: string;
  }[];
  site: {
    subdomain: string | null;
    url: string | null;
    root_domain: string | null;
    /** False ⇒ subdomain routing is not configured and `url` is an in-app path, not an origin. */
    configured: boolean;
  };
}

/** One client's LMS detail: subscription state, effective caps, courses, learners, activity. */
export function getLmsAcademy(id: string): Promise<LmsAcademyDetail> {
  return apiFetch(`/api/admin/lms/academies/${id}`);
}

export interface LmsActivityRow {
  id: string;
  academy_id: string | null;
  academy_name: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
}

/** The LMS activity feed (course/lesson/learner/code/enrolment/quiz/media actions). */
export function getLmsActivity(
  limit = 100,
  academy?: string,
): Promise<{ rows: LmsActivityRow[]; total: number; limit: number }> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (academy) q.set("academy", academy);
  return apiFetch(`/api/admin/lms/activity?${q.toString()}`);
}

/** Replace this client's LMS capacity caps; an empty map clears the override. Audited. */
export function setLmsLimits(
  id: string,
  limits: LmsLimits,
): Promise<{ ok: boolean } & LmsAcademyDetail> {
  return apiFetch(`/api/admin/lms/academies/${id}/limits`, {
    method: "POST",
    body: JSON.stringify({ limits }),
  });
}

/** Set (or detach, with null) the client's public course-site subdomain. Audited. */
export function setLmsSubdomain(
  id: string,
  subdomain: string | null,
): Promise<{ ok: boolean } & LmsAcademyDetail> {
  return apiFetch(`/api/admin/lms/academies/${id}/subdomain`, {
    method: "PUT",
    body: JSON.stringify({ subdomain }),
  });
}

/** Platform moderation of a client's course (publish / unpublish / archive). Audited. */
export function setLmsCourseStatus(
  academyId: string,
  courseId: string,
  status: LmsCourseStatus,
  reason?: string,
): Promise<{ ok: boolean; status: LmsCourseStatus }> {
  return apiFetch(
    `/api/admin/lms/academies/${academyId}/courses/${courseId}/status`,
    {
      method: "POST",
      body: JSON.stringify({ status, reason: reason ?? null }),
    },
  );
}

/** Block or unblock one of the client's learners. Audited. */
export function setLmsLearnerStatus(
  academyId: string,
  learnerId: string,
  status: "ACTIVE" | "BLOCKED",
  reason?: string,
): Promise<{ ok: boolean; status: "ACTIVE" | "BLOCKED" }> {
  return apiFetch(
    `/api/admin/lms/academies/${academyId}/learners/${learnerId}/status`,
    {
      method: "POST",
      body: JSON.stringify({ status, reason: reason ?? null }),
    },
  );
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
    `${apiBase()}/api/admin/academies/${academyId}/payment-submissions/${subId}/screenshot`,
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

/** @deprecated Packages are gone (05-MODULES-NOT-PACKAGES). Legacy catalog read; not used by the panel. */
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

/** The teacher's optional sign-in login (GET /api/teachers/{id}). */
export interface TeacherLogin {
  has_login: boolean;
  email: string | null;
  is_active: boolean | null;
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

export function getTeacher(id: string): Promise<{
  teacher: TeacherRow;
  students: TeacherStudent[];
  login: TeacherLogin;
}> {
  return apiFetch(`/api/teachers/${id}`);
}

/**
 * PATCH /api/teachers/{id}/login — set or change a teacher's sign-in login (email + password).
 * Creates the login when the teacher has none yet (both fields required), otherwise updates the
 * given field(s). Owner-only server-side.
 */
export function updateTeacherLogin(
  id: string,
  input: { email?: string; password?: string },
): Promise<{ ok: boolean; created: boolean; changed: string[] }> {
  return apiFetch(`/api/teachers/${id}/login`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
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

export function listStaffDepartments(): Promise<{
  departments: StaffDepartment[];
}> {
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

export function listStaff(
  q: DataTableQuery = {},
): Promise<ListResult<StaffRow>> {
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
  /** True for the built-in, non-editable system roles (OWNER/SUPERVISOR/TEACHER/STAFF). */
  system: boolean;
  permissions: string[];
  assignedCount: number;
}

/** A starting point for a new custom role — a named set of boxes already ticked. */
export interface AcademyRolePreset {
  /** Stable handle (`supervisor`); the UI keys its label and copy off this. */
  key: string;
  /** The system role this preset mirrors, when it mirrors one. */
  role?: string;
  permissions: string[];
}

export interface AcademyRolesResponse {
  system: AcademyRoleSummary[];
  custom: AcademyRoleSummary[];
  /** The capability codes the current user is allowed to grant to a custom role. */
  grantable: string[];
  /** Those grantable codes that move or reveal money — marked in the builder. */
  financial?: string[];
  presets?: AcademyRolePreset[];
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

export function createAcademyRole(input: {
  name: string;
  description?: string | null;
  permissions: string[];
}): Promise<{ roleId: string; code: string }> {
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

// ── Report card template (the shareable session/trial report image) ──────────

/**
 * The academy's own voice on the report card — the wording that repeats on EVERY card, saved once
 * and poured into all of them. The per-session facts come from the session report; the design
 * lives in `report-card-design.tsx`.
 *
 * Every text field may contain `{academy}`, `{student}` and `{teacher}`, substituted at render
 * time by `fillPlaceholders`.
 */
export interface ReportCardContent {
  headlineAr: string;
  headlineEn: string;
  introAr: string;
  introEn: string;
  championMessageAr: string;
  championMessageEn: string;
  duaAr: string;
  duaEn: string;
  taglineAr: string;
  taglineEn: string;
  accentColor: string;
  /** Which visual register the card speaks in. "joyful" (default) adds the illustration layer —
   *  lanterns, a mushaf, a medal, a balloon, a skyline. "classic" drops it for adult students. */
  cardStyle: "joyful" | "classic";
}

export function getReportCardTemplate(): Promise<{
  content: ReportCardContent;
}> {
  return apiFetch("/api/report-card-template");
}

export function saveReportCardTemplate(
  content: Partial<ReportCardContent>,
): Promise<{ ok: boolean; content: ReportCardContent }> {
  return apiFetch("/api/report-card-template", {
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

/**
 * What an academy is allowed to know about its own XPay channel. The merchant keys are
 * Super-Admin-provisioned and live in a separate, encrypted table, so nothing secret is
 * reachable from an academy-facing endpoint — only the publishable key and which mode it runs in.
 */
export interface XpayPublicConfig {
  publishable_key: string;
  mode: "test" | "live";
}

export interface PaymentSetting {
  method: PaymentMethodKey;
  is_active: boolean;
  config:
    | BankTransferConfig
    | PaypalConfig
    | XpayPublicConfig
    | Record<string, never>;
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

export function updateAcademyProfile(patch: {
  name: string;
  timezone?: string;
}): Promise<{ ok: boolean }> {
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

// ── XPay provisioning (Super Admin → client → Payments) ──────────────────────

export type XpayMode = "test" | "live";

/**
 * One environment's stored credentials as the panel sees them. Note what is NOT here: the secret key
 * and the webhook signing secret. They are write-only by design — the API stores them encrypted and
 * only ever returns the last four characters so an admin can tell which key is loaded.
 */
export interface XpayModeState {
  configured: boolean;
  publishable_key: string | null;
  secret_last4: string | null;
  webhook_last4: string | null;
  has_webhook_secret: boolean;
  updated_at: string | null;
}

/**
 * A client holds both key sets at once; `mode` says which one every payment path resolves. Going
 * live is a one-field flip, and dropping back to test to reproduce a problem loses nothing.
 */
export interface XpaySettings {
  is_active: boolean;
  configured: boolean;
  mode: XpayMode;
  modes: Record<XpayMode, XpayModeState>;
  /** Paste this into the client's XPay dashboard → Developers → Webhooks. */
  webhook_url: string;
}

export interface XpayKeyInput {
  publishable_key?: string;
  secret_key?: string;
  webhook_secret?: string;
}

export function getClientXpay(
  clientId: string,
): Promise<{ xpay: XpaySettings }> {
  return apiFetch(`/api/admin/clients/${clientId}/payments/xpay`);
}

/** Blank `secret_key` / `webhook_secret` keep whatever is already stored for that environment. */
export function saveClientXpay(
  clientId: string,
  payload: {
    is_active: boolean;
    mode: XpayMode;
    test?: XpayKeyInput;
    live?: XpayKeyInput;
  },
): Promise<{ xpay: XpaySettings }> {
  return apiFetch(`/api/admin/clients/${clientId}/payments/xpay`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** Omit `mode` to check whichever environment is currently in force. */
export function testClientXpay(
  clientId: string,
  mode?: XpayMode,
): Promise<{
  ok: boolean;
  status: number | null;
  message: string;
  mode: XpayMode;
}> {
  return apiFetch(`/api/admin/clients/${clientId}/payments/xpay/test`, {
    method: "POST",
    body: JSON.stringify(mode ? { mode } : {}),
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
  /**
   * PER_PACKAGE switches the student onto the hour-block billing mode (docs/lesson-packages):
   * the monthly invoice stops running for them and `price_minor` becomes the DEFAULT hourly
   * rate used to pre-fill their next package. The two clocks are mutually exclusive.
   */
  price_basis?: "PER_SESSION" | "PER_MONTH" | "PER_HOUR" | "PER_PACKAGE";
  start_date: string;
  /**
   * Also re-price the sessions already billed onto this student's OPEN invoices at the new
   * rate — the correction path for a price that was entered wrong. Off by default so a genuine
   * mid-term rate change never retroactively re-bills lessons taught at the old rate. Closed and
   * paid invoices are never touched.
   */
  reprice_open?: boolean;
}

/** What a reprice would recalculate (GET /api/students/{id}/subscription/reprice-preview). */
export interface RepricePreview {
  sessions: number;
  invoices: number;
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
): Promise<{ subscriptionId: string; repriced: RepricePreview }> {
  return apiFetch(`/api/students/${studentId}/subscription`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** How many billed sessions on how many OPEN invoices a reprice would recalculate. */
export function getRepricePreview(studentId: string): Promise<RepricePreview> {
  return apiFetch(`/api/students/${studentId}/subscription/reprice-preview`);
}

export function changeSubscriptionPrice(
  studentId: string,
  input: {
    price_minor: number;
    currency?: string;
    price_basis?: "PER_SESSION" | "PER_MONTH" | "PER_HOUR" | "PER_PACKAGE";
    reprice_open?: boolean;
  },
): Promise<{ ok: boolean; repriced: RepricePreview }> {
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
  /** Local `Y-m-d` the timetable starts producing lessons. */
  start_date: string | null;
  is_active: boolean;
  version: number;
}

export interface ScheduleInput {
  timezone?: string;
  teacher_id?: string | null;
  /**
   * Local `Y-m-d` the timetable starts producing lessons. May be in the past — that is how a
   * student enrolled on the 1st and entered on the 20th gets the three weeks already taught.
   * Omitted, the server falls back to the student's subscription start date, then to today.
   */
  start_date?: string;
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
  /**
   * Set ONLY on a trial folded into the feed so the calendar views can paint it at its hour
   * (see `CalendarTrial`). Its presence is what marks the event as not-a-session: no attendance,
   * no reschedule-by-drag, no cancel — those belong to lessons and, for a trial, to the Trials
   * page. A real session never carries it.
   */
  trial?: CalendarTrial;
}

/**
 * A booked trial as the calendar feed returns it. It is deliberately NOT a session: the person
 * may not be a student yet, so none of the session actions (attendance, reschedule, cancel)
 * apply — the calendar paints it so the hour is visibly taken, and the Trials page is where it
 * is managed. Only SCHEDULED trials travel in this feed.
 */
export interface CalendarTrial {
  id: string;
  teacher_id: string;
  student_id: string | null;
  lead_id: string | null;
  scheduled_at_utc: string;
  duration_minutes: number;
  status: "SCHEDULED";
  teacher_name: string | null;
  student_name: string | null;
  crm_lead_name: string | null;
  lead_name: string | null;
  /** Who the hour is for — student, CRM lead, or the inline prospect, in that order. */
  display_name: string | null;
}

/** One student's active weekly timetable as the roster endpoint returns it (period-independent). */
export interface TimetableSummary {
  schedule_id: string;
  student_id: string;
  student_name: string | null;
  teacher_id: string;
  teacher_name: string | null;
  timezone: string;
  /** Local `Y-m-d` the timetable starts producing lessons. */
  start_date: string | null;
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

export function getCalendar(q: CalendarQuery): Promise<{
  sessions: CalendarSession[];
  trials: CalendarTrial[];
  from: string;
  to: string;
}> {
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

/**
 * POST /api/sessions/{id}/free-request — a teacher asks to mark a lesson FREE. Like a cancellation
 * the session stays SCHEDULED; the owner approves it (deciding the billing) from the Notifications
 * "Classes" queue.
 */
export function requestFree(
  sessionId: string,
  input: { reason?: string } = {},
): Promise<{ requestId: string; status: "PENDING" }> {
  return apiFetch(`/api/sessions/${sessionId}/free-request`, {
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
  /** The lesson's number for the report card's "Lesson #", counted inside the block the family
   *  is billed for — their lesson package, or failing that the calendar month in the academy's
   *  timezone. Null while the session is still scheduled or was cancelled: nothing was delivered,
   *  so it has no number yet. */
  session_number: number | null;
  /** Which block `session_number` counts within, so the card can say "3" of WHAT. Null exactly
   *  when `session_number` is. */
  session_number_scope: "PACKAGE" | "MONTH" | null;
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
  /** A teacher-raised request to mark this lesson FREE, awaiting owner approval. Same shape/lifecycle
   *  as pending_cancellation; the session stays SCHEDULED until the owner decides. */
  pending_free: {
    id: string;
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
 * GET /api/sessions/day — every session inside a window [from, to), for the attendance page.
 * `from`/`to` are ISO instants (the browser computes the local bounds), and the window is not
 * limited to one day: the page also asks for a whole week or month. `truncated` comes back true
 * when the window held more lessons than the server's cap.
 */
export function getSessionsByDay(params: {
  from: string;
  to: string;
  teacher_id?: string;
  status?: string;
  trial_only?: boolean;
}): Promise<{ sessions: DaySession[]; truncated?: boolean }> {
  const qs = new URLSearchParams({ from: params.from, to: params.to });
  if (params.teacher_id) qs.set("teacher_id", params.teacher_id);
  if (params.status) qs.set("status", params.status);
  if (params.trial_only) qs.set("trial_only", "1");
  return apiFetch(`/api/sessions/day?${qs.toString()}`);
}

/** A lesson that ended long enough ago to count as overdue (GET /api/sessions/overdue). */
export interface OverdueSession extends DaySession {
  /** True when a teacher-raised cancellation OR free request is awaiting the owner's approval —
   *  the lesson is stuck on the owner, not on the teacher's marking. */
  pending_approval: boolean;
}

/**
 * GET /api/sessions/overdue — lessons that ENDED at least `grace_hours` ago and are still
 * SCHEDULED, i.e. nobody recorded an outcome. Not scoped to any calendar window: a lesson
 * forgotten three weeks ago is exactly the one this must surface. `count` is the true size of the
 * backlog even when the row list was capped (`truncated`).
 */
export function getOverdueSessions(): Promise<{
  sessions: OverdueSession[];
  count: number;
  truncated: boolean;
  grace_hours: number;
}> {
  return apiFetch("/api/sessions/overdue");
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

/**
 * Who moved this money:
 *  • MANUAL          — a human typed it on the payroll or Discounts & Awards page.
 *  • QUALITY         — derived from a quality report; recomputed until the payout is finalized.
 *  • AUTO_UNREPORTED — the hourly sweep docked an unmarked lesson.
 *
 * The teacher reads this statement, so a derived row must never be presented as a manager's
 * decision — and only MANUAL rows can be deleted (see `sourceOf` handling in the ledger UI).
 */
export type AdjustmentSource = "MANUAL" | "QUALITY" | "AUTO_UNREPORTED";
export const ADJUSTMENT_SOURCES: readonly AdjustmentSource[] = [
  "MANUAL",
  "QUALITY",
  "AUTO_UNREPORTED",
];

/** A reward (bonus) or deduction on a payout statement, with reason + optional details. */
export interface PayoutAdjustment {
  id: string;
  type: AdjustmentType;
  source: AdjustmentSource;
  amount_minor: number;
  currency: string;
  reason: string;
  details: string | null;
  session_id: string | null;
  quality_report_id: string | null;
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

/**
 * Salaries for an arbitrary window (`GET /api/payouts/range`), rather than for a calendar month.
 *
 * A payout statement IS a month, so this cannot be read off `payouts.total_minor` — the server
 * re-adds the parts: lessons sliced exactly on their academy-local date, and adjustments anchored
 * on the date they refer to. Every figure is per currency; nothing is ever summed across them.
 */
export interface PayrollRangeTeacher {
  teacher_id: string;
  teacher_name: string | null;
  currency: string;
  sessions: number;
  /** Minutes taught in the window — the figure a salary gets checked against. */
  minutes: number;
  lessons_minor: number;
  rewards_minor: number;
  deductions_minor: number;
  net_minor: number;
  /** At least one statement behind these figures is still OPEN, so the total can still move. */
  has_open: boolean;
}

export interface PayrollRangeCurrency {
  currency: string;
  teachers: number;
  sessions: number;
  minutes: number;
  lessons_minor: number;
  rewards_minor: number;
  deductions_minor: number;
  net_minor: number;
}

export interface PayrollRange {
  from: string;
  to: string;
  currencies: PayrollRangeCurrency[];
  teachers: PayrollRangeTeacher[];
}

export function getPayrollRange(
  from: string,
  to: string,
): Promise<PayrollRange> {
  return apiFetch(`/api/payouts/range?from=${from}&to=${to}`);
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
  /** How many clients hold each module, and how many of those are still on trial (05 §2). */
  module_distribution: Array<{
    module: ModuleCode;
    client_count: number;
    trial_count: number;
  }>;
  /** How many clients of each type there are. */
  type_distribution: Array<{ client_type: ClientType; client_count: number }>;
}

export interface AdminMrr {
  currency: string;
  amount_minor: number;
}

export interface AdminEndingSoon {
  academy_id: string;
  academy_name: string;
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
  input: {
    academy_id: string;
    role: "ACADEMY_OWNER" | "TEACHER";
    grant: boolean;
  },
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
  /** The sellable module this plan belongs to (R3; defaults to MANAGEMENT server-side). */
  module?: ModuleCode;
  features: PlanFeatures;
  is_active: boolean;
}

/** @deprecated Packages are gone. The plans table survives only for the legacy resolver fallback. */
export function createPlan(
  input: PlanInput & { code: string },
): Promise<{ planId: string }> {
  return apiFetch("/api/admin/plans", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** @deprecated Packages are gone. The plans table survives only for the legacy resolver fallback. */
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

/** @deprecated Packages are gone — a client's modules and price are written from its profile. */
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

/** One row of the approval queue (Notifications "Classes" tab): a cancellation OR a free-lesson
 *  request. `cancel_type` is null for free requests. */
export interface CancellationRequestRow {
  id: string;
  session_id: string;
  teacher_id: string;
  request_type: "CANCEL" | "FREE";
  cancel_type: "teacher" | "student" | null;
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
): Promise<{
  ok: boolean;
  status: CancellationStatus;
  sessionStatus: string | null;
}> {
  return apiFetch(`/api/cancellation-requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function rejectCancellation(
  requestId: string,
  note?: string,
): Promise<{
  ok: boolean;
  status: CancellationStatus;
  sessionStatus: string | null;
}> {
  return apiFetch(`/api/cancellation-requests/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export type NotificationType =
  | "REPORT_OVERDUE"
  | "REPORT_REMINDER"
  // Lesson-package alerts (docs/lesson-packages). PACKAGE_UNPAID is the one that answers
  // "he started a new package without paying the old one" — visibility, never a block.
  | "PACKAGE_LOW"
  | "PACKAGE_COMPLETED"
  | "PACKAGE_UNPAID"
  | "NO_ACTIVE_PACKAGE";

/** One report-overdue alert (Notifications "Reports" tab). */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  category: "REPORTS" | "PACKAGES";
  session_id: string | null;
  /** Anchor for non-session alerts — a lesson_packages.id for the PACKAGE_* types. */
  subject_id: string | null;
  data: {
    student_name?: string | null;
    teacher_name?: string | null;
    teacher_id?: string;
    scheduled_at_utc?: string;
    duration_minutes?: number;
    session_status?: string;
    // Package alerts
    package_id?: string;
    student_id?: string;
    label?: string;
    minutes_left?: number;
    minutes_consumed?: number;
    minutes_overdrawn?: number;
    outstanding_minor?: number;
    currency?: string;
    invoice_id?: string | null;
    reason?: string;
  };
  read_at: string | null;
  created_at: string;
}

export function listNotifications(): Promise<{
  notifications: NotificationRow[];
}> {
  return apiFetch("/api/notifications");
}

/** Unread counts that drive the sidebar badge, split by the tabs. */
export interface NotificationSummary {
  classes: number;
  reports: number;
  /** Unread lesson-package alerts — its own tab, so it never inflates the reports count. */
  packages: number;
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

export function markAllNotificationsRead(): Promise<{
  ok: boolean;
  marked: number;
}> {
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

export function listStudentReportStudents(): Promise<{
  students: StudentReportStudent[];
}> {
  return apiFetch("/api/student-reports/students");
}

export function listMyStudentReports(): Promise<{
  reports: StudentReportRow[];
}> {
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
  /** The CRM lead this trial was booked for, when it came from the pipeline. */
  lead_id: string | null;
  crm_lead_name: string | null;
  crm_source: LeadSource | null;
  from_crm: boolean;
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
  /** Trials sitting on the academy's own calendar day (scheduled, or already resolved). */
  today: number;
  /** Scheduled trials whose slot has passed with no outcome recorded — the work queue. */
  awaiting_outcome: number;
  completed: number;
  no_show: number;
  cancelled: number;
  converted: number;
  /** Trials that came from a CRM lead rather than being booked directly. */
  from_crm: number;
  /** Percentage of resolved trials that became students (0–100). */
  conversion_rate: number;
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

// ── CRM / Leads (CRM module) ─────────────────────────────────────────────────
// A prospective student captured as a lead and walked through one pipeline
// (NEW → CONTACTED → INTERESTED → TRIAL → SUBSCRIBED, + LOST) on a board or list,
// with a per-lead activity timeline. The last two stages are backed by real
// records — a booked trial (which appears on the calendar) and a real student
// (which appears on the Students page) — so the server refuses a bare status
// write to either. Plan-gated by the CRM module (entitled:crm → 402) and
// capability-gated by crm.read / crm.manage (403). Transport only.

export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "INTERESTED"
  | "TRIAL"
  | "SUBSCRIBED"
  | "LOST";

export const LEAD_STATUSES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "TRIAL",
  "SUBSCRIBED",
  "LOST",
];

export type LeadSource =
  | "FACEBOOK"
  | "INSTAGRAM"
  | "WHATSAPP"
  | "REFERRAL"
  | "WALK_IN"
  | "PHONE"
  | "WEBSITE"
  | "OTHER";

export const LEAD_SOURCES: readonly LeadSource[] = [
  "FACEBOOK",
  "INSTAGRAM",
  "WHATSAPP",
  "REFERRAL",
  "WALK_IN",
  "PHONE",
  "WEBSITE",
  "OTHER",
];

export interface LeadRow {
  id: string;
  full_name: string;
  whatsapp_phone: string | null;
  source: LeadSource;
  interested_in: string | null;
  status: LeadStatus;
  lost_reason: string | null;
  /** Follow-up date "YYYY-MM-DD" (no time — staff promise a day, not a minute). */
  follow_up_at: string | null;
  converted_student_id: string | null;
  student_name?: string | null;
  created_at: string;
  /**
   * The lead's current trial, flattened onto the row so a board card renders without a request
   * per card. "Current" = the newest trial that still counts; null when none was ever booked.
   */
  trial_id: string | null;
  trial_status: TrialStatus | null;
  trial_teacher_id: string | null;
  trial_teacher_name: string | null;
  trial_scheduled_at_utc: string | null;
  trial_duration_minutes: number | null;
  trial_notes: string | null;
}

export interface LeadActivity {
  id: string;
  type:
    | "CREATED"
    | "NOTE"
    | "STATUS_CHANGE"
    | "FOLLOW_UP_SET"
    | "TRIAL_BOOKED"
    | "TRIAL_OUTCOME"
    | "CONVERTED";
  body: string | null;
  meta: Record<string, unknown> | null;
  author_name: string | null;
  created_at: string;
}

/** The whole pipeline in one payload; `today` is the academy-local date for due colouring. */
export interface LeadBoard {
  columns: Record<LeadStatus, LeadRow[]>;
  counts: Record<LeadStatus, number>;
  today: string;
}

export interface LeadSummary {
  new: number;
  contacted: number;
  interested: number;
  trial: number;
  subscribed: number;
  lost: number;
  total: number;
  /** Every lead still being worked — a booked trial included. */
  open: number;
  due_today: number;
  overdue: number;
  conversion_rate: number;
  today: string;
}

export interface LeadInput {
  full_name: string;
  whatsapp_phone?: string | null;
  source: LeadSource;
  interested_in?: string | null;
  follow_up_at?: string | null;
  /** Optional first note, stored as the lead's first timeline entry. */
  note?: string | null;
}

export function listLeads(
  q: DataTableQuery = {},
): Promise<ListResult<LeadRow> & { today: string }> {
  return apiFetch(`/api/crm/leads${toQueryString(q)}`);
}

export function getLeadBoard(): Promise<LeadBoard> {
  return apiFetch("/api/crm/leads/board");
}

export function getLeadSummary(): Promise<LeadSummary> {
  return apiFetch("/api/crm/leads/summary");
}

export function createLead(input: LeadInput): Promise<{ leadId: string }> {
  return apiFetch("/api/crm/leads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getLead(
  id: string,
): Promise<{ lead: LeadRow; activities: LeadActivity[]; today: string }> {
  return apiFetch(`/api/crm/leads/${id}`);
}

export function updateLead(
  id: string,
  patch: Partial<Omit<LeadInput, "note">> & {
    status?: LeadStatus;
    lost_reason?: string | null;
  },
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/crm/leads/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function addLeadNote(
  id: string,
  body: string,
): Promise<{ activity: LeadActivity }> {
  return apiFetch(`/api/crm/leads/${id}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/** What the trial form sends: a teacher, a local wall-clock slot, and how long it runs. */
export interface LeadTrialInput {
  teacher_id: string;
  /** Local wall-clock "YYYY-MM-DD HH:mm", read in `timezone` (the academy's by default). */
  local_datetime: string;
  timezone?: string | null;
  duration_minutes: number;
  notes?: string | null;
}

/**
 * POST /api/crm/leads/{id}/trial — book the trial that moves a lead into the TRIAL stage.
 * The booking is what puts it on the calendar and into the trials statistics; conflicts come
 * back as `warnings`, never as a refusal.
 */
export function bookLeadTrial(
  id: string,
  input: LeadTrialInput,
): Promise<{ trialId: string; warnings: TrialWarning[] }> {
  return apiFetch(`/api/crm/leads/${id}/trial`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * The teacher roster the trial form picks from. The CRM serves its own so a delegated sales
 * role never needs `teacher.read` — which would hand it rates, payouts and profiles.
 */
export function listCrmTeachers(): Promise<{
  teachers: { id: string; full_name: string; specialization: string | null }[];
  durations: number[];
  timezone: string;
}> {
  return apiFetch("/api/crm/teachers");
}

/**
 * POST /api/crm/leads/{id}/convert — the SUBSCRIBED stage. The student is created first
 * through the normal student form (POST /students), so every required detail is collected by
 * the one form that owns them; this records the linkage that puts them on the Students page.
 */
export function convertLead(
  id: string,
  studentId: string,
): Promise<{ ok: boolean; studentId: string }> {
  return apiFetch(`/api/crm/leads/${id}/convert`, {
    method: "POST",
    body: JSON.stringify({ student_id: studentId }),
  });
}

export function deleteLead(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/crm/leads/${id}`, { method: "DELETE" });
}

// ── LMS / Courses (LMS module, docs/lms) ─────────────────────────────────────
// The authoring side: staff build on-demand courses — sections of lessons (YouTube / text / PDF /
// audio now; uploaded video + quizzes in later phases) — learners watch on the academy's public
// subdomain. Plan-gated by the LMS module (entitled:lms → 402) and capability-gated by
// course.read / course.manage (403). Transport only.

export type CourseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export const COURSE_STATUSES: readonly CourseStatus[] = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
];

/** Lesson kinds. */
export type LessonType =
  | "YOUTUBE"
  | "TEXT"
  | "PDF"
  | "AUDIO"
  | "VIDEO_UPLOAD"
  | "QUIZ";

/**
 * The kinds the editor can create. QUIZ carries no payload field of its own — the API mints an
 * empty quiz for the course on save, which the QuizBuilder then fills in (docs/lms/04 §quizzes).
 */
export const AUTHORABLE_LESSON_TYPES: readonly LessonType[] = [
  "VIDEO_UPLOAD",
  "YOUTUBE",
  "TEXT",
  "PDF",
  "AUDIO",
  "QUIZ",
];

export interface CourseRow {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  status: CourseStatus;
  cover_image_path: string | null;
  published_at: string | null;
  created_at: string;
  lesson_count: number;
  /** One-off unlock price in integer minor units, in the academy's currency. 0 = free. */
  price_minor: number;
  /** ISO 4217 code the price is denominated in (the academy's default currency). */
  currency: string;
  /** Derived: true when `price_minor` is 0. */
  is_free: boolean;
}

export interface CourseSummary {
  draft: number;
  published: number;
  archived: number;
  total: number;
  /** The academy's currency (ISO 4217) — labels the price field before any course exists. */
  currency: string;
}

export interface Lesson {
  id: string;
  title: string;
  type: LessonType;
  position: number;
  is_preview: boolean;
  duration_seconds: number | null;
  media_asset_id: string | null;
  youtube_video_id: string | null;
  attachment_path: string | null;
  body: string | null;
  quiz_id: string | null;
}

export interface CourseSection {
  id: string;
  title: string;
  position: number;
  lessons: Lesson[];
}

/** The full editor payload: the course row (with description) + its section→lesson outline. */
export interface CourseDetail {
  course: CourseRow & { description: string | null };
  sections: CourseSection[];
}

export interface CourseInput {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  /** One-off unlock price in integer minor units (academy currency). 0 / omitted = free. */
  price_minor?: number;
  /** A READY IMAGE upload to use as the cover; the API stores its key and serves a loadable url. */
  cover_media_asset_id?: string | null;
}

export interface LessonInput {
  section_id: string;
  type: LessonType;
  title: string;
  is_preview?: boolean;
  duration_seconds?: number | null;
  /** YOUTUBE: the pasted link (server parses the 11-char id). */
  youtube_url?: string | null;
  /** TEXT: markdown body. */
  body?: string | null;
  /** PDF / AUDIO: a link to an external file. */
  url?: string | null;
  /** VIDEO_UPLOAD / uploaded AUDIO: the id of a READY media_asset (see requestMediaUpload). */
  media_asset_id?: string | null;
}

export function listCourses(
  q: DataTableQuery = {},
): Promise<ListResult<CourseRow>> {
  return apiFetch(`/api/courses${toQueryString(q)}`);
}

export function getCourseSummary(): Promise<CourseSummary> {
  return apiFetch("/api/courses/summary");
}

/** The LMS client's own dashboard — the course platform's home screen (docs/lms). */
export interface LmsDashboard {
  stats: {
    courses: number;
    published_courses: number;
    draft_courses: number;
    lessons: number;
    learners: number;
    active_learners: number;
    enrollments: number;
    active_enrollments: number;
    codes: number;
    active_codes: number;
    redeemed_codes: number;
    certificates: number;
  };
  storage: { used_bytes: number; limit_bytes: number | null };
  site: {
    subdomain: string | null;
    /** Absolute URL once DNS is configured, else the in-app `/learn/<subdomain>` path. */
    url: string | null;
    root_domain: string | null;
    /** False ⇒ subdomain routing is not configured and `url` is an in-app path, not an origin. */
    configured: boolean;
    published_courses: number;
  };
  recent_enrollments: {
    id: string;
    learner_name: string;
    course_title: string;
    enrolled_at: string | null;
  }[];
  top_courses: {
    id: string;
    title: string;
    slug: string;
    status: CourseStatus;
    learners: number;
  }[];
}

export function getLmsDashboard(): Promise<LmsDashboard> {
  return apiFetch("/api/courses/dashboard");
}

/**
 * The client's public-site content (docs/lms/09) — the per-client half of the shared learner-site
 * template. `LearnSiteContent` is the same shape the public site consumes, so the editor and the
 * site can never disagree about a field.
 */
export interface LmsSiteProfile {
  /** What the site renders: the client's content laid over the structural defaults. */
  content: LearnSiteContent;
  /** The bare defaults, so the editor can show what an empty field falls back to. */
  defaults: LearnSiteContent;
  /** False until the client saves for the first time. */
  configured: boolean;
  site: {
    subdomain: string | null;
    url: string | null;
    root_domain: string | null;
    configured: boolean;
  };
}

export function getLmsSiteProfile(): Promise<LmsSiteProfile> {
  return apiFetch("/api/courses/site");
}

export function saveLmsSiteProfile(
  content: LearnSiteContent,
): Promise<LmsSiteProfile> {
  return apiFetch("/api/courses/site", {
    method: "PUT",
    body: JSON.stringify(content),
  });
}

export function createCourse(
  input: CourseInput,
): Promise<{ courseId: string }> {
  return apiFetch("/api/courses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCourse(id: string): Promise<CourseDetail> {
  return apiFetch(`/api/courses/${id}`);
}

export function updateCourse(
  id: string,
  patch: Partial<CourseInput> & {
    slug?: string;
    cover_image_path?: string | null;
  },
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/courses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function setCourseStatus(
  id: string,
  status: CourseStatus,
): Promise<{ ok: boolean; status: CourseStatus }> {
  return apiFetch(`/api/courses/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function deleteCourse(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${id}`, { method: "DELETE" });
}

export function addSection(
  courseId: string,
  title: string,
): Promise<{ sectionId: string }> {
  return apiFetch(`/api/courses/${courseId}/sections`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function updateSection(
  courseId: string,
  id: string,
  title: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${courseId}/sections/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteSection(
  courseId: string,
  id: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${courseId}/sections/${id}`, {
    method: "DELETE",
  });
}

export function reorderSections(
  courseId: string,
  ids: string[],
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${courseId}/sections/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function addLesson(
  courseId: string,
  input: LessonInput,
): Promise<{ lessonId: string }> {
  return apiFetch(`/api/courses/${courseId}/lessons`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateLesson(
  courseId: string,
  id: string,
  patch: Partial<LessonInput>,
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/courses/${courseId}/lessons/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteLesson(
  courseId: string,
  id: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${courseId}/lessons/${id}`, {
    method: "DELETE",
  });
}

export function reorderLessons(
  courseId: string,
  sectionId: string,
  ids: string[],
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${courseId}/lessons/reorder`, {
    method: "POST",
    body: JSON.stringify({ section_id: sectionId, ids }),
  });
}

// ── LMS media uploads (VOD, docs/lms/04) ─────────────────────────────────────
// Reserve a media_asset (server enforces the plan storage cap), PUT the file straight to the
// returned target (presigned S3, or a signed proxy route on a local disk), then confirm it READY.
// The READY asset's id goes on a VIDEO_UPLOAD / AUDIO lesson.

export type MediaKind = "VIDEO" | "AUDIO" | "IMAGE";
export type MediaStatus =
  | "PENDING"
  | "UPLOADING"
  | "PROCESSING"
  | "READY"
  | "FAILED";

export interface MediaUploadTarget {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  size_bytes: number | null;
  duration_seconds: number | null;
  original_filename: string | null;
  error: string | null;
}

export function requestMediaUpload(input: {
  filename: string;
  content_type: string;
  kind: MediaKind;
  size_bytes: number;
}): Promise<{ mediaAssetId: string; upload: MediaUploadTarget }> {
  return apiFetch("/api/courses/media/upload-url", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getMediaAsset(id: string): Promise<MediaAsset> {
  return apiFetch(`/api/courses/media/${id}`);
}

export function confirmMediaUploaded(
  id: string,
): Promise<{ status: MediaStatus; size_bytes: number }> {
  return apiFetch(`/api/courses/media/${id}/uploaded`, { method: "POST" });
}

/** PUT the file straight to the upload target (S3 or the signed proxy), reporting 0–100% progress. */
export function uploadFileToTarget(
  target: MediaUploadTarget,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url, true);
    for (const [key, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(key, value);
    }
    if (!("Content-Type" in target.headers) && file.type) {
      xhr.setRequestHeader("Content-Type", file.type);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

// ── LMS quizzes (builder, docs/lms/04) ───────────────────────────────────────
// A quiz belongs to a course and is attached to a QUIZ lesson (lessons.quiz_id). The builder edits
// the whole quiz at once (replace-all save). Correct-answer flags are visible to staff here — the
// learner endpoints never return them; grading is server-side.

export type QuestionType = "SINGLE" | "MULTIPLE" | "TRUE_FALSE";

export const QUESTION_TYPES: readonly QuestionType[] = [
  "SINGLE",
  "MULTIPLE",
  "TRUE_FALSE",
];

export interface QuizOptionInput {
  id?: string;
  text: string;
  is_correct: boolean;
}

export interface QuizQuestionInput {
  id?: string;
  prompt: string;
  type: QuestionType;
  points: number;
  options: QuizOptionInput[];
}

export interface QuizDetail {
  quiz: {
    id: string;
    course_id: string;
    title: string | null;
    pass_mark: number;
    max_attempts: number | null;
  };
  questions: Array<{
    id: string;
    prompt: string;
    type: QuestionType;
    points: number;
    options: Array<{ id: string; text: string; is_correct: boolean }>;
  }>;
}

export interface QuizSaveInput {
  title?: string | null;
  pass_mark?: number;
  max_attempts?: number | null;
  questions: QuizQuestionInput[];
}

export function createQuiz(
  courseId: string,
  input: {
    title?: string | null;
    pass_mark?: number;
    max_attempts?: number | null;
  } = {},
): Promise<{ quizId: string }> {
  return apiFetch(`/api/courses/${courseId}/quizzes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getQuiz(courseId: string, quizId: string): Promise<QuizDetail> {
  return apiFetch(`/api/courses/${courseId}/quizzes/${quizId}`);
}

export function saveQuiz(
  courseId: string,
  quizId: string,
  input: QuizSaveInput,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${courseId}/quizzes/${quizId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteQuiz(
  courseId: string,
  quizId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/${courseId}/quizzes/${quizId}`, {
    method: "DELETE",
  });
}

// ── LMS quizzes: cross-course listing + results ──────────────────────────────
// A quiz is otherwise only reachable through the lesson it hangs off; these two power the /lms/quizzes
// workspace page and its per-quiz results view.

export interface QuizRow {
  id: string;
  title: string | null;
  pass_mark: number;
  max_attempts: number | null;
  created_at: string | null;
  course_id: string;
  course_title: string;
  course_status: string;
  /** null when no lesson references this quiz — it exists but no learner can reach it. */
  lesson_id: string | null;
  lesson_title: string | null;
  question_count: number;
  total_points: number;
  attempt_count: number;
  learner_count: number;
  passed_count: number;
  /** null until at least one attempt has been submitted. */
  avg_score: number | null;
}

export interface QuizAttemptRow {
  id: string;
  learner_id: string;
  learner_name: string;
  learner_email: string;
  score: number | null;
  passed: boolean;
  started_at: string | null;
  submitted_at: string | null;
}

export interface QuizQuestionStat {
  id: string;
  prompt: string;
  type: QuestionType;
  points: number;
  correct_count: number;
  attempts: number;
  /** Percent of submitted attempts that got this question right; null before any attempt. */
  correct_rate: number | null;
}

export interface QuizResults {
  quiz: {
    id: string;
    title: string | null;
    pass_mark: number;
    max_attempts: number | null;
    course_id: string;
    course_title: string;
  };
  summary: {
    attempts: number;
    learners: number;
    passed: number;
    passed_learners: number;
    avg_score: number | null;
    best_score: number | null;
    worst_score: number | null;
  };
  attempts: QuizAttemptRow[];
  /** True when `attempts` is only the most recent slice — the summary still covers every attempt. */
  attempts_truncated: boolean;
  questions: QuizQuestionStat[];
}

export function listQuizzes(): Promise<{ quizzes: QuizRow[] }> {
  return apiFetch("/api/courses/quizzes");
}

export function getQuizResults(quizId: string): Promise<QuizResults> {
  return apiFetch(`/api/courses/quizzes/${quizId}/results`);
}

// ── LMS dashboard: access codes + learners (staff side) ──────────────────────

export interface AccessCode {
  id: string;
  code: string;
  label: string | null;
  /** null = unlimited redemptions; 1 = single-use. */
  max_redemptions: number | null;
  redemptions_count: number;
  expires_at: string | null;
  is_active: boolean;
  course_titles: string[];
}

export interface CourseLearnerRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "BLOCKED";
  enrollment_count: number;
  last_login_at: string | null;
}

export interface LearnerEnrollment {
  course_id: string;
  title: string;
  status: "ACTIVE" | "REVOKED";
  enrolled_at: string;
}

export function listCodes(): Promise<{ codes: AccessCode[] }> {
  return apiFetch("/api/courses/codes");
}

export function generateCodes(input: {
  course_ids: string[];
  count: number;
  max_redemptions?: number | null;
  expires_at?: string | null;
  label?: string | null;
}): Promise<{ codes: { id: string; code: string }[] }> {
  return apiFetch("/api/courses/codes/batch", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCode(
  id: string,
  patch: {
    is_active?: boolean;
    label?: string | null;
    expires_at?: string | null;
  },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/codes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteCode(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/codes/${id}`, { method: "DELETE" });
}

export function listCourseLearners(): Promise<{
  learners: CourseLearnerRow[];
}> {
  return apiFetch("/api/courses/learners");
}

export function getCourseLearner(id: string): Promise<{
  learner: Omit<CourseLearnerRow, "enrollment_count" | "last_login_at">;
  enrollments: LearnerEnrollment[];
}> {
  return apiFetch(`/api/courses/learners/${id}`);
}

export function setLearnerStatus(
  id: string,
  status: "ACTIVE" | "BLOCKED",
): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/api/courses/learners/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function setEnrollmentStatus(
  learnerId: string,
  courseId: string,
  status: "ACTIVE" | "REVOKED",
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/courses/learners/${learnerId}/enrollment`, {
    method: "POST",
    body: JSON.stringify({ course_id: courseId, status }),
  });
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
  /**
   * Ghost waiting room (08-ROOM-ACCESS §13): a monitor/ghost-link entrant must knock and be admitted
   * by the host before observing (the teacher-consent gate). Off = the ghost enters silently.
   */
  ghost_waiting_room: boolean;
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

/** One live occupant of a room (hidden monitors are never included here). */
export interface RoomOccupant {
  identity: string;
  name: string;
  role: "host" | "guest";
  /** Camera published AND unmuted. */
  camera: boolean;
  /** Microphone published AND unmuted. */
  mic: boolean;
  /** Currently sharing a screen. */
  screen: boolean;
  /** Unix seconds when they joined, or null. */
  joinedAt: number | null;
}

/** Live occupancy summary for one room (present only while someone is in it). */
export interface RoomPresence {
  /** Joinable occupants (hosts + guests; excludes hidden monitors). */
  count: number;
  /** Hidden supervisors watching — only populated for viewers with room.monitor. */
  monitors: number;
  camerasOn: number;
  micsOn: number;
  screenSharing: number;
  participants: RoomOccupant[];
}

/**
 * Live occupancy across the academy's rooms, keyed by room id. Rooms with nobody in them are
 * omitted (an absent id = empty room). Polled by the classroom panel; fails soft to `{}`.
 */
export function getRoomPresence(): Promise<{
  presence: Record<string, RoomPresence>;
}> {
  return apiFetch("/api/video/rooms/presence");
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
): Promise<{
  which: string;
  token: string;
  join_token?: string;
  host_token?: string;
}> {
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
  room: {
    id: string;
    name: string;
    status: VideoRoomStatus;
    created_at: string;
  };
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

function joinBody(
  displayName?: string,
  password?: string,
): Record<string, string> {
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
  /** 'guest' = a student waiting to join; 'monitor' = a hidden observer awaiting the host's consent. */
  role?: "guest" | "monitor";
  createdAt: string;
}

/** The host's pending-knock queue, authenticated by the manage credential (= the room's host_token). */
export function listKnocks(
  manageToken: string,
): Promise<{ knocks: PendingKnock[] }> {
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
export function startRoomRecording(
  roomId: string,
  manageToken?: string | null,
): Promise<{ recordingId: string }> {
  const path = manageToken
    ? `/api/video/manage/${manageToken}/recording`
    : `/api/video/rooms/${roomId}/recording`;
  return apiFetch(path, { method: "POST" });
}

/** Stop the room's active recording (host link via manageToken, else session-authenticated). */
export function stopRoomRecording(
  roomId: string,
  manageToken?: string | null,
): Promise<{ ok: boolean }> {
  const path = manageToken
    ? `/api/video/manage/${manageToken}/recording`
    : `/api/video/rooms/${roomId}/recording`;
  return apiFetch(path, { method: "DELETE" });
}

// ── In-call host moderation (server-mediated SFU admin) ───────────────────────
// Each action works from the no-login HOST LINK (manageToken = host_token) or, for a logged-in
// manager without one, the session-authenticated room endpoint. Possession of the link is authority.

/** Force-mute a participant's microphone. */
export function muteParticipant(
  roomId: string,
  identity: string,
  manageToken?: string | null,
): Promise<{ ok: boolean }> {
  const id = encodeURIComponent(identity);
  const path = manageToken
    ? `/api/video/manage/${manageToken}/participants/${id}/mute`
    : `/api/video/rooms/${roomId}/participants/${id}/mute`;
  return apiFetch(path, { method: "POST" });
}

/** Force a participant's camera off (host "stop video"). They can re-enable it themselves. */
export function muteParticipantVideo(
  roomId: string,
  identity: string,
  manageToken?: string | null,
): Promise<{ ok: boolean }> {
  const id = encodeURIComponent(identity);
  const path = manageToken
    ? `/api/video/manage/${manageToken}/participants/${id}/mute-video`
    : `/api/video/rooms/${roomId}/participants/${id}/mute-video`;
  return apiFetch(path, { method: "POST" });
}

/** Remove (kick) a participant from the call. */
export function removeParticipant(
  roomId: string,
  identity: string,
  manageToken?: string | null,
): Promise<{ ok: boolean }> {
  const id = encodeURIComponent(identity);
  const path = manageToken
    ? `/api/video/manage/${manageToken}/participants/${id}/remove`
    : `/api/video/rooms/${roomId}/participants/${id}/remove`;
  return apiFetch(path, { method: "POST" });
}

/** End the live call for everyone (the room stays available to rejoin later). */
export function endRoomForAll(
  roomId: string,
  manageToken?: string | null,
): Promise<{ ok: boolean }> {
  const path = manageToken
    ? `/api/video/manage/${manageToken}/end`
    : `/api/video/rooms/${roomId}/end`;
  return apiFetch(path, { method: "POST" });
}

// ── Teacher quality + Discounts & Awards (payroll module) ────────────────────
// Two management surfaces over teacher pay:
//   • the RUBRIC — the academy's own definition of good delivery (categories → criteria, each
//     carrying the percent docked when a teacher doesn't meet it) — and the REPORTS written
//     against it, scoped either to one lesson (SESSION) or a whole month (MONTHLY);
//   • ADJUSTMENTS — awards and discounts on a teacher's statement, whether typed by a human or
//     written by the unmarked-lesson sweep.
//
// A report stores a PERCENT, never an amount: the money is a derived payout deduction the API
// recomputes while the statement is OPEN (a MONTHLY report docks a % of a total that grows all
// month). So `amount_minor` on a report row is the CURRENT cost, and it is null while the percent
// bites into nothing — a real state, not a missing value. Plan-gated with payroll (entitled:payroll
// → 402); capability-gated by teacher_quality.* / payout.* (403). Transport only.

export type QualityScope = "SESSION" | "MONTHLY";
export const QUALITY_SCOPES: readonly QualityScope[] = ["SESSION", "MONTHLY"];

/** One checkable rubric item; `discount_percent` is what NOT meeting it costs. */
export interface QualityCriterion {
  id: string;
  category_id: string;
  name: string;
  discount_percent: number;
  sort_order: number;
  is_active: boolean;
}

export interface QualityCategory {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  criteria: QualityCriterion[];
}

export interface QualityReportRow {
  id: string;
  teacher_id: string;
  teacher_name: string | null;
  scope: QualityScope;
  session_id: string | null;
  student_name: string | null;
  scheduled_at_utc: string | null;
  period_year: number;
  period_month: number;
  total_percent: number;
  note: string | null;
  author_name: string | null;
  /** The deduction it currently costs; null while it bites into nothing yet. */
  amount_minor: number | null;
  currency: string | null;
  created_at: string;
}

/** One frozen answer: the criterion as it read WHEN JUDGED, and whether the teacher met it. */
export interface QualityReportItem {
  id: string;
  category_name: string;
  criterion_name: string;
  discount_percent: number;
  met: boolean;
}

export interface QualityReportDetail {
  report: QualityReportRow;
  items: QualityReportItem[];
}

export interface QualitySummary {
  year: number;
  month: number;
  report_count: number;
  teachers_flagged: number;
  /** 100 = every report this period found nothing wrong. Averaged over reports, not teachers. */
  avg_score: number;
  docked: { currency: string; amount_minor: number }[];
}

/** A past lesson offered to the SESSION-scope picker. */
export interface QualitySessionOption {
  id: string;
  scheduled_at_utc: string;
  local_date: string;
  duration_minutes: number;
  status: string;
  student_name: string | null;
  has_report: boolean;
}

export function getQualityRubric(
  includeInactive = false,
): Promise<{ categories: QualityCategory[] }> {
  return apiFetch(
    `/api/quality/rubric${includeInactive ? "?include_inactive=1" : ""}`,
  );
}

export function createQualityCategory(input: {
  name: string;
  description?: string | null;
  sort_order?: number;
}): Promise<{ categoryId: string }> {
  return apiFetch("/api/quality/rubric/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateQualityCategory(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    sort_order?: number;
    is_active?: boolean;
  },
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/quality/rubric/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteQualityCategory(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quality/rubric/categories/${id}`, { method: "DELETE" });
}

export function createQualityCriterion(input: {
  category_id: string;
  name: string;
  discount_percent: number;
  sort_order?: number;
}): Promise<{ criterionId: string }> {
  return apiFetch("/api/quality/rubric/criteria", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateQualityCriterion(
  id: string,
  patch: {
    name?: string;
    discount_percent?: number;
    sort_order?: number;
    is_active?: boolean;
  },
): Promise<{ ok: boolean; changed: string[] }> {
  return apiFetch(`/api/quality/rubric/criteria/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteQualityCriterion(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quality/rubric/criteria/${id}`, { method: "DELETE" });
}

export function listQualityReports(
  q: DataTableQuery = {},
): Promise<ListResult<QualityReportRow>> {
  return apiFetch(`/api/quality/reports${toQueryString(q)}`);
}

export function getQualityReport(id: string): Promise<QualityReportDetail> {
  return apiFetch(`/api/quality/reports/${id}`);
}

export function getQualitySummary(
  year: number,
  month: number,
): Promise<QualitySummary> {
  return apiFetch(`/api/quality/reports/summary?year=${year}&month=${month}`);
}

/** Judge a teacher against the rubric. `items` is the whole sheet; only unmet items cost. */
export function createQualityReport(input: {
  teacher_id: string;
  scope: QualityScope;
  session_id?: string | null;
  period_year?: number;
  period_month?: number;
  note?: string | null;
  items: { criterion_id: string; met: boolean }[];
}): Promise<{ reportId: string }> {
  return apiFetch("/api/quality/reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Withdraw a report; the deduction it caused cascades away with it. */
export function deleteQualityReport(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quality/reports/${id}`, { method: "DELETE" });
}

export function listQualityTeacherSessions(
  teacherId: string,
): Promise<{ sessions: QualitySessionOption[] }> {
  return apiFetch(`/api/quality/teachers/${teacherId}/sessions`);
}

/** Teacher: the reports written about themselves (self-scoped server-side). */
export function listMyQualityReports(
  q: DataTableQuery = {},
): Promise<ListResult<QualityReportRow>> {
  return apiFetch(`/api/me/quality-reports${toQueryString(q)}`);
}

export function getMyQualityReport(id: string): Promise<QualityReportDetail> {
  return apiFetch(`/api/me/quality-reports/${id}`);
}

// ── Discounts & Awards ──────────────────────────────────────────────────────

/** An award/discount as the teacher-first ledger returns it (joined to teacher + period). */
export interface TeacherAdjustmentRow {
  id: string;
  payout_id: string;
  teacher_id: string;
  teacher_name: string | null;
  type: AdjustmentType;
  source: AdjustmentSource;
  amount_minor: number;
  currency: string;
  reason: string;
  details: string | null;
  session_id: string | null;
  quality_report_id: string | null;
  /** The lesson a system row is about, in the academy's clock ("YYYY-MM-DD HH:mm"). */
  session_local: string | null;
  author_name: string | null;
  period_year: number;
  period_month: number;
  /** Finalized statements are frozen — no add, no remove, no waive. */
  finalized: boolean;
  created_at: string;
}

export interface AdjustmentSummary {
  year: number;
  month: number;
  totals: {
    currency: string;
    rewards_minor: number;
    deductions_minor: number;
  }[];
  reward_count: number;
  deduction_count: number;
  auto_count: number;
}

/** The academy's standing policy for docking teachers who never mark a lesson. */
export interface QualitySettings {
  auto_deduct_enabled: boolean;
  auto_deduct_grace_hours: number;
  /** FIXED docks a flat amount; PERCENT_SESSION docks a % of what the lesson would have paid. */
  auto_deduct_basis: "FIXED" | "PERCENT_SESSION";
  auto_deduct_amount_minor: number;
  auto_deduct_percent: number;
}

export function listTeacherAdjustments(
  q: DataTableQuery = {},
): Promise<ListResult<TeacherAdjustmentRow>> {
  return apiFetch(`/api/quality/adjustments${toQueryString(q)}`);
}

export function getAdjustmentSummary(
  year: number,
  month: number,
): Promise<AdjustmentSummary> {
  return apiFetch(
    `/api/quality/adjustments/summary?year=${year}&month=${month}`,
  );
}

/** Award or dock a teacher for a period; opens their statement if it doesn't exist yet. */
export function addTeacherAdjustment(
  teacherId: string,
  input: {
    type: AdjustmentType;
    amount_minor: number;
    reason: string;
    details?: string | null;
    period_year?: number;
    period_month?: number;
  },
): Promise<{ adjustmentId: string; payoutId: string }> {
  return apiFetch(`/api/quality/teachers/${teacherId}/adjustments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Remove a hand-typed award/discount. Rejected (422) for derived rows. */
export function deleteTeacherAdjustment(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quality/adjustments/${id}`, { method: "DELETE" });
}

/**
 * Cancel an automatic deduction by posting a matching award beside it. Deleting it wouldn't work —
 * the hourly sweep would write it back — so both the machine's call and the override stay on record.
 */
export function waiveAutoDeduction(
  id: string,
  reason: string,
): Promise<{ rewardId: string }> {
  return apiFetch(`/api/quality/adjustments/${id}/waive`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function getQualitySettings(): Promise<{ settings: QualitySettings }> {
  return apiFetch("/api/quality/settings");
}

export function updateQualitySettings(
  settings: QualitySettings,
): Promise<{ settings: QualitySettings }> {
  return apiFetch("/api/quality/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** Teacher: their own awards and discounts (self-scoped server-side). */
export function listMyAdjustments(
  q: DataTableQuery = {},
): Promise<ListResult<TeacherAdjustmentRow>> {
  return apiFetch(`/api/me/adjustments${toQueryString(q)}`);
}

// ── Lesson packages (hour-based billing mode, docs/lesson-packages) ────────────

export type PackageStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";
export type PackageBillTiming = "ON_START" | "ON_COMPLETION";

/**
 * One package, with its live balance.
 *
 * Everything is MINUTES — the server never sends fractional hours, because a package balance
 * that renders as 3.3333h is a support ticket waiting to happen. `formatHours` is the single
 * render boundary that turns them into "3h 20m".
 *
 * `minutes_remaining` is clamped at zero and `minutes_overdrawn` is reported separately: "how
 * much is left" and "how far past the end the last lesson went" are two different facts, and a
 * single signed number reads wrong on a progress bar.
 */
export interface LessonPackageRow {
  id: string;
  student_id: string;
  student_name: string;
  label: string;
  sequence_no: number;
  status: PackageStatus;
  bill_timing: PackageBillTiming;
  minutes_total: number;
  carried_over_minutes: number;
  /** minutes_total + carried_over_minutes — the balance the student actually has. */
  minutes_sold: number;
  minutes_consumed: number;
  minutes_remaining: number;
  minutes_overdrawn: number;
  /** Billable lessons already attached to this package's credit ledger. */
  lesson_count: number;
  /** Generated future lessons which have not reached an attendance outcome yet. */
  upcoming_lesson_count: number;
  next_lesson_at: string | null;
  percent_used: number;
  price_minor: number;
  hourly_rate_minor: number;
  currency: string;
  starts_on: string;
  expires_on: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  invoice_id: string | null;
  invoice_status: string | null;
  invoice_token: string | null;
  outstanding_minor: number;
  overdraft_billed: boolean;
  created_at: string;
}

/**
 * The attention counters behind the sidebar badge. These are things to DO, not things unread:
 * a closed package with no bill, an overdraft still travelling, a finished package nobody paid
 * for, and a balance about to run out.
 */
export interface LessonPackageSummary {
  active: number;
  lowBalance: number;
  needsBilling: number;
  pendingOverdraft: number;
  unpaid: number;
  total: number;
}

/** A student on package billing, with their open package (if any) and default hourly rate. */
export interface PackageStudent {
  id: string;
  full_name: string;
  currency: string;
  default_hourly_rate_minor: number;
  active_package_id: string | null;
  active_package_label: string | null;
}

/** One lesson that consumed minutes from a package. */
export interface LessonPackageCredit {
  id: string;
  session_id: string | null;
  minutes: number;
  minutes_overdrawn: number;
  amount_minor: number;
  currency: string;
  description: string;
  consumed_at: string;
  scheduled_at_utc: string | null;
  session_status: string | null;
  teacher_name: string | null;
}

export function listLessonPackages(
  filters: { status?: PackageStatus; student_id?: string; q?: string } = {},
): Promise<{ packages: LessonPackageRow[] }> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.student_id) params.set("student_id", filters.student_id);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  return apiFetch(`/api/packages${qs ? `?${qs}` : ""}`);
}

export function getLessonPackageSummary(): Promise<LessonPackageSummary> {
  return apiFetch("/api/packages/summary");
}

export function listPackageStudents(): Promise<{ students: PackageStudent[] }> {
  return apiFetch("/api/packages/students");
}

export function getLessonPackage(
  id: string,
): Promise<{ package: LessonPackageRow; credits: LessonPackageCredit[] }> {
  return apiFetch(`/api/packages/${id}`);
}

/**
 * Open a package. `hours` is what the academy sells and what the form asks for; the server
 * converts to minutes on arrival and nothing downstream ever sees a fraction again.
 */
export function openLessonPackage(input: {
  student_id: string;
  label: string;
  hours: number;
  price_minor: number;
  currency?: string;
  bill_timing?: PackageBillTiming;
  starts_on?: string;
  expires_on?: string | null;
  carry_over?: boolean;
}): Promise<{
  id: string;
  invoice_id: string | null;
  carried_over_minutes: number;
  imported_lessons: number;
  skipped_locked_lessons: number;
}> {
  return apiFetch("/api/packages", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Import already-billed lessons between a package's start date and now. */
export function syncLessonPackage(id: string): Promise<{
  imported: number;
  skipped_locked: number;
}> {
  return apiFetch(`/api/packages/${id}/sync-lessons`, { method: "POST" });
}

export interface InvoiceSendLinkResult {
  phone: string;
  message: string;
  url: string;
  transport: string;
  sent: boolean;
}

/** Send an invoice link through the configured WhatsApp transport, or return its deep link. */
export function sendInvoicePaymentLink(
  id: string,
): Promise<InvoiceSendLinkResult> {
  return apiFetch(`/api/invoices/${id}/send-link`, { method: "POST" });
}

/** Close a package early. One that runs out closes itself. */
export function closeLessonPackage(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; invoice_id: string | null }> {
  return apiFetch(`/api/packages/${id}/close`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** Void a package opened by mistake — unused ones only. */
export function cancelLessonPackage(
  id: string,
  note?: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/packages/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

/** Put a stranded overdraft on its own invoice (when no next package was ever opened). */
export function billPackageOverdraft(
  id: string,
): Promise<{ ok: boolean; invoice_id: string }> {
  return apiFetch(`/api/packages/${id}/bill-overdraft`, { method: "POST" });
}
