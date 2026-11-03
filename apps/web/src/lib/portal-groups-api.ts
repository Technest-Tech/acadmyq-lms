/**
 * The centre's absence alert (Settings → WhatsApp → "تنبيه الغياب لولي الأمر") — the API client for
 * /api/group-absence-alert. A centre's routes (`entitled:centre` + `entitled:groups`), so a Quran
 * academy answers 402 and the card never renders for it (settings-manager gates on `centre`).
 *
 * Kept out of `api.ts` like `groups-api.ts`.
 */
import { apiFetch } from "@/lib/api";

export interface AbsenceAlertSettings {
  enabled: boolean;
  /** The centre's own wording, or null when it follows the platform default. */
  message: string | null;
  /** The platform's text in the academy's WhatsApp language. */
  default_message: string;
  /** The facts a message may name: `{{student}}` … */
  placeholders: string[];
  /** The message as a parent would read it, with stand-in values. */
  sample: string;
}

export function getAbsenceAlert(): Promise<AbsenceAlertSettings> {
  return apiFetch("/api/group-absence-alert");
}

export function updateAbsenceAlert(body: { enabled: boolean; message: string | null }): Promise<AbsenceAlertSettings> {
  return apiFetch("/api/group-absence-alert", { method: "PUT", body: JSON.stringify(body) });
}

export function previewAbsenceAlert(message: string | null): Promise<{ sample: string }> {
  return apiFetch("/api/group-absence-alert/preview", { method: "POST", body: JSON.stringify({ message }) });
}
