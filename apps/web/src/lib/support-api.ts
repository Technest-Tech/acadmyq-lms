/**
 * Support requests — the API client for /api/support (an academy's own page) and /api/admin/support
 * (the platform team's inbox). Kept out of `api.ts` like the other feature modules.
 *
 * One request = one problem or change request an academy raised (or we logged for it), numbered per
 * academy, with a conversation under it. What each status means lives in the API's
 * App\Support\SupportRequests; the screens only name them.
 */
import { apiFetch } from "@/lib/api";

export type SupportKind = "PROBLEM" | "CHANGE";
export type SupportPriority = "NORMAL" | "URGENT";
export type SupportStatus = "NEW" | "IN_PROGRESS" | "WAITING" | "DONE" | "REJECTED" | "CANCELLED";
export type SupportSide = "ACADEMY" | "ADMIN";

export const SUPPORT_OPEN: readonly SupportStatus[] = ["NEW", "IN_PROGRESS", "WAITING"];
export const SUPPORT_CLOSED: readonly SupportStatus[] = ["DONE", "REJECTED", "CANCELLED"];

/** Screenshots or a PDF; mirrors SupportRequests::MAX_FILES / MAX_FILE_KB / FILE_MIMES. */
export const SUPPORT_MAX_FILES = 3;
export const SUPPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const SUPPORT_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";

export interface SupportFile {
  name: string;
  size: number;
  type: string;
  url: string;
}

export interface SupportRequestRow {
  id: string;
  number: number;
  kind: SupportKind;
  title: string;
  priority: SupportPriority;
  status: SupportStatus;
  source: SupportSide;
  page: string | null;
  /** Who raised it. Null for the academy when the team logged it. */
  createdBy: string | null;
  /** Something on it the viewing side has not opened yet. */
  unread: boolean;
  replies: number;
  createdAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  /** Admin inbox only. */
  academy?: { id: string; name: string };
}

export interface SupportMessage {
  id: string;
  side: SupportSide;
  /** Null for the academy on the team's messages: it reads "the support team". */
  author: string | null;
  body: string;
  internal: boolean;
  statusFrom: SupportStatus | null;
  statusTo: SupportStatus | null;
  attachments: SupportFile[];
  createdAt: string;
}

export interface SupportRequestDetail {
  request: SupportRequestRow & { body: string; attachments: SupportFile[] };
  messages: SupportMessage[];
}

export interface SupportListResult {
  rows: SupportRequestRow[];
  counts: { open: number; waiting: number; closed: number; unread: number };
}

export interface NewSupportRequest {
  kind: SupportKind;
  title: string;
  body: string;
  priority: SupportPriority;
  page?: string | null;
  files: File[];
}

function form(fields: Record<string, string | null | undefined>, files: File[]): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) body.append(key, value);
  }
  for (const file of files) body.append("attachments[]", file);
  return body;
}

// ── The academy's own page ────────────────────────────────────────────────────

export function getSupportRequests(): Promise<SupportListResult> {
  return apiFetch<SupportListResult>("/api/support/requests");
}

export function getSupportSummary(): Promise<{ unread: number }> {
  return apiFetch<{ unread: number }>("/api/support/summary");
}

export function getSupportRequest(id: string): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>(`/api/support/requests/${id}`);
}

export function createSupportRequest(input: NewSupportRequest): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>("/api/support/requests", {
    method: "POST",
    body: form(
      { kind: input.kind, title: input.title, body: input.body, priority: input.priority, page: input.page ?? null },
      input.files,
    ),
  });
}

export function replySupportRequest(id: string, body: string, files: File[]): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>(`/api/support/requests/${id}/messages`, {
    method: "POST",
    body: form({ body }, files),
  });
}

export function withdrawSupportRequest(id: string): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>(`/api/support/requests/${id}/withdraw`, { method: "POST" });
}

// ── The platform team's inbox ─────────────────────────────────────────────────

/** A status, or one of the groups the inbox tiles count. */
export type SupportInboxFilter = SupportStatus | "OPEN" | "CLOSED" | "UNREAD" | "ALL";

export type SupportInboxCounts = Record<SupportStatus | "OPEN" | "CLOSED" | "ALL" | "UNREAD" | "URGENT", number>;

export interface SupportInboxResult {
  rows: SupportRequestRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: SupportInboxCounts;
}

export function getSupportInbox(params: {
  status?: SupportInboxFilter;
  academyId?: string;
  kind?: SupportKind | "";
  search?: string;
  page?: number;
}): Promise<SupportInboxResult> {
  const q = new URLSearchParams();
  if (params.status && params.status !== "ALL") q.set("filter[status]", params.status);
  if (params.academyId) q.set("filter[academy]", params.academyId);
  if (params.kind) q.set("filter[kind]", params.kind);
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.page && params.page > 1) q.set("page", String(params.page));
  const qs = q.toString();
  return apiFetch<SupportInboxResult>(`/api/admin/support${qs ? `?${qs}` : ""}`);
}

export function getSupportInboxSummary(): Promise<{ unread: number; new: number }> {
  return apiFetch<{ unread: number; new: number }>("/api/admin/support/summary");
}

export function getSupportInboxRequest(id: string): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>(`/api/admin/support/${id}`);
}

export function respondSupportRequest(
  id: string,
  input: { body: string; status?: SupportStatus | null; internal?: boolean; files: File[] },
): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>(`/api/admin/support/${id}/messages`, {
    method: "POST",
    body: form(
      {
        body: input.body,
        status: input.status ?? null,
        internal: input.internal ? "1" : null,
      },
      input.files,
    ),
  });
}

export function updateSupportRequest(
  id: string,
  patch: Partial<{ kind: SupportKind; priority: SupportPriority; title: string }>,
): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>(`/api/admin/support/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function logSupportRequest(input: {
  academyId: string;
  kind: SupportKind;
  title: string;
  body: string;
  status: SupportStatus;
  priority: SupportPriority;
  files: File[];
}): Promise<SupportRequestDetail> {
  return apiFetch<SupportRequestDetail>("/api/admin/support", {
    method: "POST",
    body: form(
      {
        academy_id: input.academyId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        status: input.status,
        priority: input.priority,
      },
      input.files,
    ),
  });
}
