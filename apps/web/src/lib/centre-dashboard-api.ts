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
  };
  subscriptions: {
    open: number;
    ending_soon: number;
    ending_soon_days: number;
  };
}

export function getCentreDashboard(): Promise<CentreDashboard> {
  return apiFetch("/api/dashboard/centre");
}
