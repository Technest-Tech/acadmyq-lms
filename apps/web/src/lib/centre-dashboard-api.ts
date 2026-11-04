/**
 * The learning centre's home screen (GET /api/dashboard/centre) — the numbers no other screen owns:
 * today's classes, the week's attendance, the groups running and the subscriptions about to run
 * out. Money comes from the accounting overview and payroll from the profit summary, both of which
 * the dashboard reads through their own clients.
 */
import { apiFetch } from "@/lib/api";

export interface CentreDashboard {
  today: {
    /** The academy's local calendar day, YYYY-MM-DD. */
    date: string;
    group_lessons: number;
    /** Group classes whose time has passed with no attendance sheet. */
    group_unmarked: number;
    private_lessons: number;
    private_unmarked: number;
  };
  week: {
    from: string;
    to: string;
    /** Group classes marked held this week. */
    held: number;
    present: number;
    absent: number;
    /** present / (present + absent); null until a sheet is marked. */
    attendance_rate: number | null;
  };
  groups: {
    running: number;
    members: number;
    /** Sum of the capped groups' seats (uncapped groups count none). */
    capacity: number;
    free_seats: number;
    /** Course terms (docs/centre-profile, Phase 2 §2): running groups about to end, and names waiting for a seat. */
    ending_soon?: number;
    waiting?: number;
    /** Change against 30 days ago, in percent; null when there was nothing to compare with. */
    delta_pct?: number | null;
  };
  subscriptions: {
    open: number;
    ending_soon: number;
    ending_soon_days: number;
    delta_pct?: number | null;
  };
  /** Null for someone who cannot read students. The four slices add up to `total`. */
  students?: {
    total: number;
    active: number;
    /** Joined in the last 30 days; not also counted in `active`. */
    new_recent: number;
    trial: number;
    inactive: number;
    delta_pct: number | null;
  } | null;
  latest_groups?: { id: string; name: string; level: string | null; members: number; capacity: number | null }[];
  activity?: CentreActivity[];
}

export interface CentreActivity {
  type: "student" | "group" | "subscription" | "receipt";
  name: string | null;
  amount_minor: number | null;
  currency: string | null;
  at: string;
}

export type TrendMonths = 3 | 6 | 12;

export interface CentreTrend {
  /** Every month in the range, oldest first, YYYY-MM. */
  months: string[];
  /** Null for someone who cannot read invoices. */
  collected: { currency: string; by_month: { month: string; amount_minor: number }[] }[] | null;
  lessons: { month: string; count: number }[];
}

export function getCentreDashboard(): Promise<CentreDashboard> {
  return apiFetch("/api/dashboard/centre");
}

export function getCentreTrend(months: TrendMonths): Promise<CentreTrend> {
  return apiFetch(`/api/dashboard/centre/trend?months=${months}`);
}
