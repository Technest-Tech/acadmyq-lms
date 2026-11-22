import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import type { CancellationRequestRow, NotificationRow } from "@/lib/api";
import { makeSession, withAuth } from "@/test/auth";
import { NotificationsScreen } from "./screen";

const listNotifications = vi.fn();
const listCancellationRequests = vi.fn();
const markAllNotificationsRead = vi.fn();
const markNotificationsRead = vi.fn();
const markNotificationTypesRead = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listCancellationRequests: () => listCancellationRequests(),
  listNotifications: (category?: string) => listNotifications(category),
  markAllNotificationsRead: (category?: string) => markAllNotificationsRead(category),
  markNotificationsRead: (ids: string[]) => markNotificationsRead(ids),
  markNotificationTypesRead: (types: string[]) => markNotificationTypesRead(types),
  getNotificationsSummary: () =>
    Promise.resolve({ classes: 0, reports: 1, packages: 0, studentReports: 0, attended: 1, total: 1, subscriptions: 2 }),
}));

const t = arMessages.notifications;

const alert = (id: string, type: NotificationRow["type"], category: NotificationRow["category"], data: NotificationRow["data"] = {}, read = false): NotificationRow => ({
  id,
  type,
  category,
  session_id: category === "REPORTS" ? `s-${id}` : null,
  subject_id: null,
  data,
  read_at: read ? "2026-11-02T11:00:00Z" : null,
  created_at: "2026-11-01T10:00:00Z",
});

const overdueAli1 = alert("r1", "REPORT_OVERDUE", "REPORTS", { teacher_id: "t-ali", teacher_name: "Ali", student_name: "Omar", scheduled_at_utc: "2026-11-01T08:00:00Z" });
const overdueAli2 = alert("r2", "REPORT_OVERDUE", "REPORTS", { teacher_id: "t-ali", teacher_name: "Ali", student_name: "Huda", scheduled_at_utc: "2026-10-30T08:00:00Z" });
const overdueMona = alert("r3", "REPORT_OVERDUE", "REPORTS", { teacher_id: "t-mona", teacher_name: "Mona", student_name: "Zaid", scheduled_at_utc: "2026-11-01T09:00:00Z" });
const unpaid = alert("p1", "PACKAGE_UNPAID", "PACKAGES", { student_name: "Yusuf", label: "8h", outstanding_minor: 50_000, currency: "EGP" });
const low = alert("p2", "PACKAGE_LOW", "PACKAGES", { student_name: "Maryam", label: "10h", minutes_left: 60 });
const lowSeen = alert("p3", "PACKAGE_LOW", "PACKAGES", { student_name: "Sara", label: "10h", minutes_left: 30 }, true);

const attended: NotificationRow = {
  ...alert("a1", "LESSON_ATTENDED", "ATTENDED", { teacher_name: "Sara", student_name: "Omar", scheduled_at_utc: "2026-10-06T10:00:00Z", duration_minutes: 60, marked_by_role: "TEACHER" }),
  session_id: "s1",
};
const groupCancelled = alert("c1", "GROUP_LESSON_CANCELLED", "CLASSES", {
  group_id: "g1",
  group_name: "English A1",
  teacher_name: "Mona",
  scheduled_at_utc: "2026-10-08T12:00:00Z",
  reason: "Public holiday",
  marked_by_name: "Omar Owner",
});
const finished = alert("sub1", "SUBSCRIPTION_FINISHED", "SUBSCRIPTIONS", { student_name: "Adam", label: "8 × English", lessons_sold: 8 });
const outside = alert("sub2", "LESSON_OUTSIDE_SUBSCRIPTION", "SUBSCRIPTIONS", { student_name: "Adam", outside_count: 2 });

const request = (id: string, status: CancellationRequestRow["status"]): CancellationRequestRow =>
  ({
    id,
    session_id: `s-${id}`,
    teacher_id: "t-ali",
    request_type: "CANCEL",
    cancel_type: "teacher",
    reason: "Sick",
    status,
    decided_at: status === "PENDING" ? null : "2026-11-01T12:00:00Z",
    decision_note: null,
    seen_by_teacher_at: null,
    created_at: "2026-11-01T09:00:00Z",
    scheduled_at_utc: "2026-11-02T10:00:00Z",
    duration_minutes: 60,
    session_status: "SCHEDULED",
    student_name: "Bilal",
    teacher_name: "Ali",
    decided_by_name: status === "PENDING" ? null : "Owner",
  }) as CancellationRequestRow;

function feed(rows: { alerts?: NotificationRow[]; attended?: NotificationRow[]; classes?: NotificationRow[]; subs?: NotificationRow[] }) {
  listNotifications.mockImplementation((category?: string) =>
    Promise.resolve({
      notifications:
        category === "ATTENDED" ? (rows.attended ?? []) : category === "CLASSES" ? (rows.classes ?? []) : category === "SUBSCRIPTIONS" ? (rows.subs ?? []) : (rows.alerts ?? []),
    }),
  );
}

beforeEach(() => {
  listNotifications.mockReset();
  listCancellationRequests.mockReset().mockResolvedValue({ requests: [] });
  markAllNotificationsRead.mockReset().mockResolvedValue({ ok: true, marked: 1 });
  markNotificationsRead.mockReset().mockResolvedValue({ ok: true, marked: 1 });
  markNotificationTypesRead.mockReset().mockResolvedValue({ ok: true, marked: 1 });
  feed({ alerts: [overdueAli1, overdueAli2, overdueMona, unpaid, low, lowSeen], attended: [attended] });
});

function renderScreen(overrides: Record<string, unknown> = {}) {
  return render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["notification.read", "session.cancel_approve"], ...overrides }), <NotificationsScreen />));
}

// ── Split by what each item asks of the owner ───────────────────────────────

it("opens on what needs a decision: the requests waiting and the money not collected, apart from the rest", async () => {
  listCancellationRequests.mockResolvedValue({ requests: [request("q1", "PENDING"), request("q2", "APPROVED")] });
  renderScreen();

  const action = await screen.findByTestId("section-action");
  expect(screen.getByTestId("tab-action")).toHaveAttribute("aria-selected", "true");
  // One pending request + one unpaid package.
  expect(screen.getByTestId("count-action")).toHaveTextContent("٢");
  expect(within(action).getAllByTestId("request-card")).toHaveLength(1);
  const money = within(action).getByTestId("money-list");
  expect(within(money).getByText(/Yusuf/)).toBeInTheDocument();
  expect(within(money).getByRole("link")).toHaveAttribute("href", "/packages/due");
  // Reports and packages running low are follow-ups, not decisions; a decided request is the log's.
  expect(within(action).queryByText(/Maryam/)).toBeNull();
  expect(within(action).queryByTestId("report-group")).toBeNull();
  expect(within(action).queryByText(t.status.APPROVED)).toBeNull();
});

it("groups overdue reports by teacher: one row for Ali's two lessons, the lessons on demand", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-follow"));
  const groups = await screen.findAllByTestId("report-group");
  expect(groups).toHaveLength(2);
  // The teacher with the most comes first.
  expect(groups[0]).toHaveTextContent("Ali");
  expect(groups[0]).toHaveTextContent("تقريران متأخران");
  expect(within(groups[0]!).queryAllByTestId("report-card")).toHaveLength(0);

  await user.click(within(groups[0]!).getByTestId("report-group-toggle"));
  const lessons = within(groups[0]!).getAllByTestId("report-card");
  expect(lessons).toHaveLength(2);
  expect(within(lessons[0]!).getByRole("link")).toHaveAttribute("href", "/sessions/s-r1");
});

it("marks one teacher's reports read together, and nothing else", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-follow"));
  const [ali] = await screen.findAllByTestId("report-group");
  await user.click(within(ali!).getByRole("button", { name: t.actions.markRead }));

  expect(markNotificationsRead).toHaveBeenCalledWith(["r1", "r2"]);
});

it("marks only the section's own alerts when asked to mark all read", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-follow"));
  await user.click(await screen.findByTestId("mark-all-read"));

  // The follow-ups only, by TYPE — so alerts past the loaded 200 clear too — and never the unpaid
  // package waiting under "needs your decision".
  expect(markNotificationTypesRead).toHaveBeenCalledTimes(1);
  const types = markNotificationTypesRead.mock.calls[0]![0] as string[];
  expect(types).toEqual(expect.arrayContaining(["REPORT_OVERDUE", "PACKAGE_LOW", "PACKAGE_COMPLETED"]));
  expect(types).not.toContain("PACKAGE_UNPAID");
  expect(markAllNotificationsRead).not.toHaveBeenCalled();
});

it("folds alerts already read away, so the list shows what is new", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-follow"));
  const section = await screen.findByTestId("section-follow");
  expect(within(section).queryByText(/Sara/)).toBeNull();

  const fold = within(section).getByTestId("seen-fold");
  await user.click(within(fold).getByRole("button", { name: /اطّلعت عليها/ }));
  expect(within(fold).getByText(/Sara/)).toBeInTheDocument();
});

it("says so calmly when nothing waits", async () => {
  feed({ alerts: [], attended: [attended] });
  renderScreen();

  expect(await screen.findByText(t.calm.action)).toBeInTheDocument();
  expect(screen.queryByTestId("count-action")).toBeNull();
});

it("leaves out an alert of a type the page does not know, rather than showing it under other words", async () => {
  feed({ alerts: [alert("x1", "SESSION_NOT_MARKED" as NotificationRow["type"], "SUPERVISION" as NotificationRow["category"], { teacher_name: "Ghost" })] });
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-follow"));
  expect(await screen.findByText(t.calm.follow)).toBeInTheDocument();
  expect(screen.queryByText(/Ghost/)).toBeNull();
});

// ── The log ─────────────────────────────────────────────────────────────────

it("keeps attended lessons in the log, and clears only the log from there", async () => {
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-log"));
  const row = await screen.findByTestId("attended-row");
  expect(row).toHaveTextContent("Sara");
  expect(row).toHaveTextContent("Omar");
  expect(within(row).getByRole("link")).toHaveAttribute("href", "/sessions/s1");

  await user.click(screen.getByTestId("mark-all-attended-read"));
  expect(markAllNotificationsRead).toHaveBeenCalledWith("ATTENDED");
});

it("lists group lessons cancelled from the board and requests already decided in the log, with nothing to approve", async () => {
  feed({ alerts: [], attended: [attended], classes: [groupCancelled] });
  listCancellationRequests.mockResolvedValue({ requests: [request("q2", "APPROVED")] });
  const user = userEvent.setup();
  renderScreen();

  await user.click(await screen.findByTestId("tab-log"));
  await user.click(await screen.findByTestId("log-cancelled"));
  const row = await screen.findByTestId("group-cancelled-row");
  expect(row).toHaveTextContent("English A1");
  expect(row).toHaveTextContent("Public holiday");
  expect(within(row).getByRole("link")).toHaveAttribute("href", "/groups/g1");
  expect(within(row).queryByRole("button")).toBeNull();

  await user.click(screen.getByTestId("log-decided"));
  const decided = await screen.findByTestId("decided-row");
  expect(decided).toHaveTextContent(t.status.APPROVED);
  expect(decided).toHaveTextContent("Bilal");
  expect(screen.queryByTestId("approve")).toBeNull();
});

// ── Who reads what ──────────────────────────────────────────────────────────

it("gives a centre its subscription alerts, each in its section and pointing at its view (docs/centre-profile/01)", async () => {
  feed({ alerts: [unpaid], subs: [finished, outside] });
  const user = userEvent.setup();
  renderScreen({ capabilities: ["centre", "groups"] });

  // Lessons outside any subscription wait for a decision; the package alert is not a centre's.
  const action = await screen.findByTestId("section-action");
  expect(listNotifications).toHaveBeenCalledWith("SUBSCRIPTIONS");
  const outsideRow = within(action).getByTestId("subscription-alert");
  expect(within(outsideRow).getByRole("link")).toHaveAttribute("href", "/subscriptions?view=outside");
  expect(within(action).queryByText(/Yusuf/)).toBeNull();

  // A finished subscription is a follow-up.
  await user.click(screen.getByTestId("tab-follow"));
  const finishedRow = await screen.findByTestId("subscription-alert");
  expect(finishedRow).toHaveTextContent("8 × English");
  expect(within(finishedRow).getByRole("link")).toHaveAttribute("href", "/subscriptions?view=finished");
});

it("never reads the subscriptions category for an academy that is not a centre", async () => {
  renderScreen();
  await screen.findByTestId("section-action");
  expect(listNotifications).not.toHaveBeenCalledWith("SUBSCRIPTIONS");
});

it("shows no report alerts to an academy that asks for no lesson report (a centre)", async () => {
  const user = userEvent.setup();
  renderScreen({ capabilities: ["invoicing", "groups", "accounting", "centre"] });

  await user.click(await screen.findByTestId("tab-follow"));
  // Its package alerts are not a centre's either, so nothing is left to follow up.
  expect(await screen.findByText(t.calm.follow)).toBeInTheDocument();
  expect(screen.queryByTestId("report-group")).toBeNull();
});

it("keeps report alerts for a centre that opted into the structured lesson report", async () => {
  const user = userEvent.setup();
  renderScreen({ capabilities: ["invoicing", "groups", "accounting", "centre", "lesson_report"] });

  await user.click(await screen.findByTestId("tab-follow"));
  expect(await screen.findAllByTestId("report-group")).toHaveLength(2);
});
