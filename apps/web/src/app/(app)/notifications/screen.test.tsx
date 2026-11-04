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
    Promise.resolve({ classes: 0, reports: 1, packages: 0, studentReports: 0, attended: 1, total: 1, subscriptions: 2 }),
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

const finished: NotificationRow = {
  id: "n3",
  type: "SUBSCRIPTION_FINISHED",
  category: "SUBSCRIPTIONS",
  session_id: null,
  subject_id: "sub1",
  data: { student_name: "Adam", label: "8 × English", lessons_sold: 8 },
  read_at: null,
  created_at: "2026-11-01T11:00:00Z",
};
const outside: NotificationRow = {
  id: "n4",
  type: "LESSON_OUTSIDE_SUBSCRIPTION",
  category: "SUBSCRIPTIONS",
  session_id: null,
  subject_id: "s1",
  data: { student_name: "Adam", outside_count: 2 },
  read_at: "2026-11-02T11:00:00Z",
  created_at: "2026-11-02T10:00:00Z",
};

beforeEach(() => {
  listNotifications.mockReset();
  markAllNotificationsRead.mockReset().mockResolvedValue({ ok: true, marked: 1 });
  listNotifications.mockImplementation((category?: string) =>
    Promise.resolve({ notifications: category === "ATTENDED" ? [attended] : category === "SUBSCRIPTIONS" ? [finished, outside] : [overdue] }),
  );
});

function renderScreen() {
  return render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["notification.read"] }), <NotificationsScreen />));
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

it("gives a centre a subscriptions tab in place of packages, read from its own category, each alert pointing at its view (docs/centre-profile/01)", async () => {
  render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["notification.read"], capabilities: ["centre", "groups"] }), <NotificationsScreen />));
  const tab = await screen.findByTestId("tab-subscriptions");
  expect(screen.queryByTestId("tab-packages")).toBeNull();
  expect(tab).toHaveTextContent("2");
  expect(listNotifications).toHaveBeenCalledWith("SUBSCRIPTIONS");
  await userEvent.click(tab);
  const alerts = await screen.findAllByTestId("subscription-alert");
  expect(alerts).toHaveLength(2);
  expect(alerts[0]).toHaveTextContent("Adam");
  expect(alerts[0]).toHaveTextContent("8 × English");
  expect(within(alerts[0]!).getByRole("link")).toHaveAttribute("href", "/subscriptions?view=finished");
  expect(within(alerts[1]!).getByRole("link")).toHaveAttribute("href", "/subscriptions?view=outside");
  expect(alerts[1]).toHaveAttribute("data-unread", "false");
});

it("keeps the packages tab for an academy without centre mode, and never reads the subscriptions category", async () => {
  renderScreen();
  expect(await screen.findByTestId("tab-packages")).toBeTruthy();
  expect(screen.queryByTestId("tab-subscriptions")).toBeNull();
  expect(listNotifications).not.toHaveBeenCalledWith("SUBSCRIPTIONS");
});
