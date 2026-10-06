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

beforeEach(() => {
  listNotifications.mockReset();
  markAllNotificationsRead.mockReset().mockResolvedValue({ ok: true, marked: 1 });
  listNotifications.mockImplementation((category?: string) =>
    Promise.resolve({ notifications: category === "ATTENDED" ? [attended] : [overdue] }),
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
