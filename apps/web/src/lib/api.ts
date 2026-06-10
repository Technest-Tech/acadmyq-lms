import type { HealthResponse } from "@academiq/contracts";

/**
 * Typed HTTP client for the Laravel JSON API.
 *
 * Auth strategy is decided in Sprint 0 and pinned via NEXT_PUBLIC_AUTH_MODE so
 * the contract does not change in Sprint 2:
 *  - "cookie" (default): Sanctum SPA cookie auth — requires a shared registrable
 *    parent domain (app.academiq.com + api.academiq.com). Sends credentials.
 *  - "token": Sanctum bearer-token fallback when a shared parent domain is not
 *    available — attaches an Authorization header (token wired in Sprint 2).
 *
 * No business logic lives here; this is a transport wrapper only.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const AUTH_MODE: "cookie" | "token" =
  process.env.NEXT_PUBLIC_AUTH_MODE === "token" ? "token" : "cookie";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (AUTH_MODE === "token") {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    // Cookie mode needs credentials for the Sanctum session cookie + CSRF.
    credentials: AUTH_MODE === "cookie" ? "include" : "same-origin",
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Request to ${path} failed`);
  }

  return (await response.json()) as T;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}
