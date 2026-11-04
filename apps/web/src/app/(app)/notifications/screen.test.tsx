import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { NotificationRow } from "@/lib/api";
import { makeSession, withAuth } from "@/test/auth";
import { NotificationsScreen } from "./screen";

const listNotifications = vi.fn();
const markAllNotificationsRead = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listCancellationRequests: () => Promise.resolve({ requests: [] }),
  listNotifications: (category?: string) => listNotifications(category),
  markAllNotificationsRead: (category?: string) => markAllNotificationsRead(category),
  getNotificationsSummary: () =>
    Promise.resolve({ classes: 0, reports: 1, packages: 0, studentReports: 0, attended: 1, total: 1 }),
}));

const overdue: NotificationRow = {
  id: "n1",
  type: "REPORT_OVERDUE",
  category: "REPORTS",
  session_id: "s0",
  subject_id: null,
  data: { teacher_name: "Old Teacher", student_name: "Old Pupil", scheduled_at_utc: "2026-10-05T10:00:00Z" },
  read_at: null,
  created_at: "2026-10-05T13:00:00Z",
};

const attended: NotificationRow = {
  id: "n2",
  type: "LESSON_ATTENDED",
  category: "ATTENDED",
  session_id: "s1",
  subject_id: null,
  data: {
    teacher_name: "Sara",
    student_name: "Omar",
    scheduled_at_utc: "2026-10-06T10:00:00Z",
    duration_minutes: 60,
    marked_by_role: "TEACHER",
  },
  read_at: null,
  created_at: "2026-10-06T11:00:00Z",
};

const groupSheet: NotificationRow = {
  id: "n3",
  type: "GROUP_LESSON_ATTENDED",
  category: "ATTENDED",
  session_id: null,
  subject_id: "gl1",
  data: {
    group_id: "g1",
    group_name: "English A1",
    teacher_name: "Mona",
    scheduled_at_utc: "2026-10-06T12:00:00Z",
    duration_minutes: 60,
    present: 7,
    expected: 9,
    marked_by_role: "TEACHER",
  },
  read_at: null,
  created_at: "2026-10-06T13:00:00Z",
};

const groupCancelled: NotificationRow = {
  id: "n4",
  type: "GROUP_LESSON_CANCELLED",
  category: "CLASSES",
  session_id: null,
  subject_id: "gl2",
  data: {
    group_id: "g1",
    group_name: "English A1",
    teacher_name: "Mona",
    scheduled_at_utc: "2026-10-08T12:00:00Z",
    duration_minutes: 60,
    reason: "Public holiday",
    marked_by_name: "Omar Owner",
    marked_by_role: "ACADEMY_OWNER",
  },
  read_at: null,
  created_at: "2026-10-07T13:00:00Z",
};

beforeEach(() => {
  listNotifications.mockReset();
  markAllNotificationsRead.mockReset().mockResolvedValue({ ok: true, marked: 1 });
  listNotifications.mockImplementation((category?: string) =>
    Promise.resolve({
      notifications: category === "ATTENDED" ? [attended] : category === "CLASSES" ? [] : [overdue],
    }),
  );
});

function renderScreen(overrides: Record<string, unknown> = {}) {
  return render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["notification.read"], ...overrides }), <NotificationsScreen />));
}

it("shows attended lessons in their own tab, apart from the report alerts", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-attended"));

  const row = await screen.findByTestId("attended-row");
  expect(within(row).getByText(/Sara/)).toBeInTheDocument();
  expect(within(row).getByText(/Omar/)).toBeInTheDocument();
  expect(screen.queryByText(/Old Teacher/)).not.toBeInTheDocument();
  expect(within(row).getByRole("link")).toHaveAttribute("href", "/sessions/s1");
});

it("clears only the attended log from its own tab", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-attended"));
  await user.click(await screen.findByTestId("mark-all-attended-read"));

  expect(markAllNotificationsRead).toHaveBeenCalledWith("ATTENDED");
});

it("keeps attended lessons out of the reports tab", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-reports"));

  const list = await screen.findByTestId("reports-list");
  expect(within(list).getAllByTestId("report-card")).toHaveLength(1);
  expect(within(list).queryByText(/Sara/)).not.toBeInTheDocument();
});

// ── Who gets a Reports tab at all ────────────────────────────────────────────
// The feed behind it is the overdue-lesson-report sweep, which runs only for an academy that asks
// for a report: the classic progress reports (`student_reports`, on by default — a Quran academy)
// or the structured lesson report (`lesson_report`, opt-in). A learning centre holds neither.

it("hides the Reports tab from an academy that asks for no lesson report (a centre)", async () => {
  renderScreen({ capabilities: ["invoicing", "groups", "accounting", "centre"] });

  await screen.findByTestId("tab-attended");
  expect(screen.queryByTestId("tab-reports")).not.toBeInTheDocument();
  expect(screen.getByTestId("tab-classes")).toBeInTheDocument();
  expect(screen.getByTestId("tab-packages")).toBeInTheDocument();
});

it("keeps the Reports tab for a centre that opted into the structured lesson report", async () => {
  renderScreen({ capabilities: ["invoicing", "groups", "accounting", "centre", "lesson_report"] });

  expect(await screen.findByTestId("tab-reports")).toBeInTheDocument();
});

it("keeps the Reports tab for a Quran academy, which holds progress reports by default", async () => {
  renderScreen();

  expect(await screen.findByTestId("tab-reports")).toBeInTheDocument();
});

// ── Group lessons in the two logs (docs/groups, coherence audit §3) ──────────

it("lists a saved group sheet in the attended log, with the count, opening the group", async () => {
  listNotifications.mockImplementation((category?: string) =>
    Promise.resolve({ notifications: category === "ATTENDED" ? [groupSheet, attended] : category === "CLASSES" ? [] : [overdue] }),
  );
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-attended"));

  const rows = await screen.findAllByTestId("attended-row");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("English A1");
  expect(rows[0]).toHaveTextContent("7/9");
  expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "/groups/g1");
  // The private row reads as before.
  expect(within(rows[1]!).getByRole("link")).toHaveAttribute("href", "/sessions/s1");
});

it("lists a group lesson cancelled from the board under the classes tab, with nothing to approve", async () => {
  listNotifications.mockImplementation((category?: string) =>
    Promise.resolve({ notifications: category === "ATTENDED" ? [attended] : category === "CLASSES" ? [groupCancelled] : [overdue] }),
  );
  renderScreen();

  const row = await screen.findByTestId("group-cancelled-row");
  expect(row).toHaveTextContent("English A1");
  expect(row).toHaveTextContent("Public holiday");
  expect(within(row).getByRole("link")).toHaveAttribute("href", "/groups/g1");
  expect(screen.queryByTestId("classes-list")).not.toBeInTheDocument();
  expect(within(row).queryByRole("button")).not.toBeInTheDocument();
});
