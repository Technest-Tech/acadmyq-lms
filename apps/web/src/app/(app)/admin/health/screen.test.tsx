import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../messages/en.json";
import { SystemHealthScreen } from "./screen";

// Super Admin → System health: a one-line verdict on the machine, the clients that need stepping
// in for (each reason a link to where it is fixed), and the system tab's tasks and dead jobs.

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/admin/health",
  useSearchParams: () => nav.params,
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getSystemHealth: vi.fn(),
  getClientAttention: vi.fn(),
  retryFailedJob: vi.fn(),
  dismissFailedJob: vi.fn(),
}));

import * as api from "@/lib/api";

const H = enMessages.adminHealth;
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const health = (over: Partial<api.SystemHealth> = {}): api.SystemHealth => ({
  status: "OK",
  problems: [],
  app: { environment: "production", commit: "b14389b", deployed_at: iso(600) },
  database: { ok: true },
  scheduler: { heartbeat_at: iso(0), heartbeat_age_seconds: 20, last_roll_at: iso(120), last_roll_age_hours: 2 },
  queue: { pending: 0, oldest_pending_age_seconds: null, failed_total: 0, failed_24h: 0 },
  tasks: [
    {
      name: "roll-session-window",
      job: "RollSessionWindowJob",
      cron: "30 0 * * *",
      last_due_at: iso(130),
      next_due_at: new Date(Date.now() + 3_600_000).toISOString(),
      last_ok_at: iso(120),
      last_failed_at: null,
      last_error: null,
      state: "OK",
    },
  ],
  failed_jobs: [],
  gateway: {
    configured: true,
    up: true,
    sessions: { total: 12, connected: 11, connecting: 0, qr: 0, disconnected: 1, logged_out: 0 },
  },
  checked_at: iso(0),
  ...over,
});

const attention = (clients: api.AttentionClient[] = []): api.ClientAttention => ({
  clients,
  counts: {
    clients: clients.length,
    crit: clients.filter((c) => c.severity === "CRIT").length,
    warn: clients.filter((c) => c.severity === "WARN").length,
  },
  checked_at: iso(0),
});

const wrap = (permissions: string[] = ["platform.manage"]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
      <ToastProvider>
        <SystemHealthScreen />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

describe("SystemHealthScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.params = new URLSearchParams();
    vi.mocked(api.getSystemHealth).mockResolvedValue(health());
    vi.mocked(api.getClientAttention).mockResolvedValue(attention());
  });

  it("is closed without platform.manage", () => {
    render(wrap([]));
    expect(screen.getByText(H.noPermission)).toBeInTheDocument();
    expect(api.getSystemHealth).not.toHaveBeenCalled();
  });

  it("says in one line that everything runs, and that no client needs you", async () => {
    render(wrap());

    const headline = await screen.findByTestId("health-headline");
    expect(headline).toHaveAttribute("data-status", "OK");
    expect(headline).toHaveTextContent(H.headline.ok);
    expect(await screen.findByTestId("attention-empty")).toHaveTextContent(H.attention.empty);
  });

  it("lists the clients that need stepping in for, worst first, each reason linked to its fix", async () => {
    vi.mocked(api.getClientAttention).mockResolvedValue(
      attention([
        {
          id: "c1",
          name: "Dropped Number",
          client_type: "MANAGEMENT",
          severity: "CRIT",
          items: [
            { code: "whatsapp_disconnected", severity: "CRIT", params: { state: "LOGGED_OUT", reminders_live: true } },
            { code: "bills_overdue", severity: "CRIT", params: { overdue: { EGP: 99900 } } },
          ],
        },
        {
          id: "c2",
          name: "Late Markers",
          client_type: "MANAGEMENT",
          severity: "WARN",
          items: [{ code: "overdue_lessons", severity: "WARN", params: { count: 6, oldest_days: 5 } }],
        },
      ]),
    );
    render(wrap());

    const first = await screen.findByTestId("attention-c1");
    expect(within(first).getByText("Dropped Number")).toHaveAttribute("href", "/admin/clients/c1");
    expect(within(first).getByText(H.item.whatsapp_disconnected_live)).toHaveAttribute(
      "href",
      "/admin/clients/c1?tab=connections",
    );
    expect(within(first).getByText(/Owes us .*999.*overdue/)).toHaveAttribute(
      "href",
      "/admin/clients/c1?tab=subscription",
    );

    const second = screen.getByTestId("attention-c2");
    expect(within(second).getByText("6 lessons left unmarked — the oldest 5 days ago.")).toHaveAttribute(
      "href",
      "/admin/clients/c2",
    );
    // The tab carries how many clients are waiting.
    expect(screen.getByTestId("tab-attention")).toHaveTextContent("2");
  });

  it("names what is down in the headline, whichever tab is open", async () => {
    vi.mocked(api.getSystemHealth).mockResolvedValue(
      health({
        status: "CRIT",
        problems: [
          { code: "scheduler_stopped", severity: "CRIT", params: { minutes: 12 } },
          { code: "task_failed", severity: "WARN", params: { task: "roll-session-window" } },
        ],
      }),
    );
    render(wrap());

    const headline = await screen.findByTestId("health-headline");
    expect(headline).toHaveAttribute("data-status", "CRIT");
    expect(headline).toHaveTextContent("The scheduler stopped 12 minutes ago");
    // A task is named in words, not by its code name.
    expect(headline).toHaveTextContent(`“${H.task["roll-session-window"]}” failed on its last run.`);

    await userEvent.setup().click(within(headline).getByText(H.headline.details));
    expect(nav.replace).toHaveBeenCalledWith("/admin/health?tab=system", { scroll: false });
  });

  it("shows each scheduled task with its state, and a failed one with what killed it", async () => {
    nav.params = new URLSearchParams("tab=system");
    vi.mocked(api.getSystemHealth).mockResolvedValue(
      health({
        status: "WARN",
        problems: [{ code: "task_failed", severity: "WARN", params: { task: "accounts-daily" } }],
        tasks: [
          ...health().tasks,
          {
            name: "accounts-daily",
            job: "AccountsDailyJob",
            cron: "0 9 * * *",
            last_due_at: iso(60),
            next_due_at: new Date(Date.now() + 80_000_000).toISOString(),
            last_ok_at: iso(1500),
            last_failed_at: iso(59),
            last_error: "Timeout: ran too long",
            state: "FAILED",
          },
        ],
      }),
    );
    render(wrap());

    const ok = await screen.findByTestId("task-roll-session-window");
    expect(within(ok).getByText(H.task["roll-session-window"])).toBeInTheDocument();
    expect(within(ok).getByText(H.tasks.state.OK)).toBeInTheDocument();

    const failed = screen.getByTestId("task-accounts-daily");
    expect(within(failed).getByText(H.tasks.state.FAILED)).toBeInTheDocument();
    expect(within(failed).getByText("Timeout: ran too long")).toBeInTheDocument();
    expect(screen.getByText(H.failed.empty)).toBeInTheDocument();
  });

  it("runs a dead job again, or dismisses it, then re-reads", async () => {
    nav.params = new URLSearchParams("tab=system");
    const dead: api.FailedJob = {
      id: "j1",
      job: "RollSessionWindowJob",
      queue: "default",
      failed_at: iso(30),
      error: "Timeout: the job ran too long",
    };
    vi.mocked(api.getSystemHealth).mockResolvedValue(
      health({
        status: "WARN",
        problems: [{ code: "jobs_failed", severity: "WARN", params: { count: 1 } }],
        queue: { pending: 0, oldest_pending_age_seconds: null, failed_total: 1, failed_24h: 1 },
        failed_jobs: [dead],
      }),
    );
    vi.mocked(api.retryFailedJob).mockResolvedValue({ ok: true });
    vi.mocked(api.dismissFailedJob).mockResolvedValue({ ok: true });
    render(wrap());
    const user = userEvent.setup();

    const row = await screen.findByTestId("failed-job-j1");
    expect(within(row).getByText("Timeout: the job ran too long")).toBeInTheDocument();

    await user.click(screen.getByTestId("retry-j1"));
    await waitFor(() => expect(api.retryFailedJob).toHaveBeenCalledWith("j1"));
    await waitFor(() => expect(api.getSystemHealth).toHaveBeenCalledTimes(2));

    await user.click(screen.getByTestId("dismiss-j1"));
    await waitFor(() => expect(api.dismissFailedJob).toHaveBeenCalledWith("j1"));
  });

  it("keeps what loaded when one of the two reads fails", async () => {
    vi.mocked(api.getClientAttention).mockRejectedValue(new Error("offline"));
    render(wrap());

    expect(await screen.findByText(H.loadError)).toBeInTheDocument();
    expect(await screen.findByTestId("health-headline")).toHaveAttribute("data-status", "OK");
  });
});
