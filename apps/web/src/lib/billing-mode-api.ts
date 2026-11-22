import { apiFetch } from "@/lib/api";

/**
 * Settings → طريقة التحصيل (API: BillingModeController / App\Services\PrepaidMonthly). "After the
 * lessons" is the engine as it always was; "monthly, in advance" bills next month in full from the
 * issue day and takes this month's not-charged lessons off that bill.
 */
export type BillingMode = "AFTER_LESSONS" | "PREPAID_MONTHLY";

export interface BillingModeSettings {
  mode: BillingMode;
  issue_day: number;
  due_day: number;
  /** First month of the in-advance regime ("YYYY-MM-01"), null while never switched on. */
  from: string | null;
  first_fee: string | null;
  whatsapp: boolean;
}

export interface BillingModeState {
  settings: BillingModeSettings;
  /** False for a centre: it bills by its own subscriptions. */
  available: boolean;
  /** The month the next run bills ("YYYY-MM-01"), null while billing after the lessons. */
  next_period: string | null;
  /** True from the issue day on: "issue now" may run. */
  issue_open: boolean;
}

export interface BillingPreviewLine {
  description: string;
  amount_minor: number;
}

export interface BillingPreviewStudent {
  student_id: string;
  full_name: string;
  currency: string;
  skip: "NO_PRICE" | "NO_TIMETABLE" | null;
  fee_minor: number | null;
  deducted_minor: number;
  charged_minor: number;
  deferred: number;
  total_minor: number;
  lines: BillingPreviewLine[];
}

export interface BillingPreview {
  period: string | null;
  summary: {
    billed: number;
    already: number;
    no_price: number;
    no_timetable: number;
    deducted_lessons: number;
    totals: { currency: string; total_minor: number }[];
  } | null;
  students: BillingPreviewStudent[];
}

export function getBillingMode(): Promise<BillingModeState> {
  return apiFetch("/api/academy/billing-mode");
}

export function saveBillingMode(body: {
  mode: BillingMode;
  issue_day?: number;
  due_day?: number;
  whatsapp?: boolean;
}): Promise<BillingModeState> {
  return apiFetch("/api/academy/billing-mode", { method: "PUT", body: JSON.stringify(body) });
}

export function previewBilling(): Promise<BillingPreview> {
  return apiFetch("/api/academy/billing-mode/preview");
}

export function issueBillingNow(): Promise<{ period: string; students: number; invoices: string[]; errors: number }> {
  return apiFetch("/api/academy/billing-mode/issue", { method: "POST" });
}
