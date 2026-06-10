/**
 * API response/request shapes shared by both apps.
 *
 * Money is always integer minor units + ISO currency (Master Spec §6.3) — never
 * a float on the wire. The web side only formats it for display.
 */
export interface Money {
  amount: number;
  currency: string;
}

/** GET /api/health */
export interface HealthResponse {
  app: "ok";
  db: "ok" | "error";
  version: string;
  time: string;
}
