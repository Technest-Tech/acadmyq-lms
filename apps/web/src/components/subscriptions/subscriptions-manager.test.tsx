import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { subRow, subSummary } from "@/components/subscriptions/test-fixtures";
import { formatMoney } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { SubscriptionsManager } from "./subscriptions-manager";

/**
 * The centre's subscriptions page (docs/centre-profile/01): four views of one table with the
 * summary over them, the due view grouped by family, and every action on a row — through the
 * contract's routes and nothing else.
 */
const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/subscriptions",
  useSearchParams: () => nav.params,
}));
const payLink = vi.fn();
const api = { listSubscriptions: vi.fn(), getSubscription: vi.fn(), remindSubscription: vi.fn(), cancelSubscription: vi.fn(), listSubscriptionStudents: vi.fn(), getSubscriptionSettlement: vi.fn(), closeSubscription: vi.fn(), updateSubscription: vi.fn() };
vi.mock("@/lib/subscriptions-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscriptions-api")>()),
  listSubscriptions: (...a: unknown[]) => api.listSubscriptions(...a),
  getSubscription: (...a: unknown[]) => api.getSubscription(...a),
  remindSubscription: (...a: unknown[]) => api.remindSubscription(...a),
  cancelSubscription: (...a: unknown[]) => api.cancelSubscription(...a),
  listSubscriptionStudents: (...a: unknown[]) => api.listSubscriptionStudents(...a),
  getSubscriptionSettlement: (...a: unknown[]) => api.getSubscriptionSettlement(...a),
  closeSubscription: (...a: unknown[]) => api.closeSubscription(...a),
  updateSubscription: (...a: unknown[]) => api.updateSubscription(...a),
  createSubscriptionFamilyPayLink: (...a: unknown[]) => payLink(...a),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () => Promise.resolve({ rows: [{ id: "t1", full_name: "Mr Ali" }], total: 1, page: 1, pageSize: 200 }),
}));

const ar = arMessages.subscriptions;
const money = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");
const owner = (extra: string[] = []) =>
  makeSession("ACADEMY_OWNER", { permissions: ["student.read", "teacher.read", "package.read", "package.manage", ...extra], capabilities: ["invoicing", "groups", "accounting", "centre"] });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  nav.replace.mockReset();
  nav.params = new URLSearchParams();
  api.listSubscriptions.mockResolvedValue({ rows: [subRow()], summary: subSummary(), meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 } });
  api.listSubscriptionStudents.mockResolvedValue({ rows: [] });
});

describe("SubscriptionsManager", () => {
  it("opens on the open view with the summary numbers, reads the rows from the contract's list, and says where group months live", async () => {
    render(withAuth(owner(), <SubscriptionsManager />));
    await screen.findByTestId("subscription-sub1");
    expect(api.listSubscriptions).toHaveBeenCalledWith({ view: "open", q: undefined, teacher_id: undefined, page: 1 });
    expect(screen.getByTestId("stat-open")).toHaveTextContent("4");
    expect(screen.getByTestId("stat-due")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-finished")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-outside")).toHaveTextContent("1");
    expect(screen.getByTestId("subscriptions-tab-open")).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByTestId("subscriptions-groups-note")).getByRole("link")).toHaveAttribute("href", "/groups");
    // A row's facts: the bar, the price, the bill, the next lesson.
    const row = screen.getByTestId("subscription-sub1");
    expect(within(row).getByTestId("subscription-lessons-bar")).toHaveTextContent("3 / 8");
    expect(within(row).getByTestId("subscription-bill")).toHaveTextContent(ar.row.paid);
    expect(within(row).getByRole("link", { name: "Adam" })).toHaveAttribute("href", "/students/s1");
  });

  it("gives a family with several bills one pay link, through the centre's own door, and a single bill its own", async () => {
    nav.params = new URLSearchParams("view=due");
    payLink.mockReset().mockResolvedValue({ url: "https://lingo.test/f/tok" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    api.listSubscriptions.mockResolvedValue({
      rows: [
        subRow({ id: "a", outstanding_minor: 72000, invoice_token: "t-a" }),
        subRow({ id: "b", student: { id: "s2", full_name: "Sara", guardian_id: "gd1", guardian_name: "Umm Adam", is_self_guardian: false }, outstanding_minor: 30000, invoice_token: "t-b" }),
        subRow({ id: "c", student: { id: "s3", full_name: "Omar", guardian_id: null, guardian_name: null, is_self_guardian: true }, outstanding_minor: 10000, invoice_token: "t-c" }),
        subRow({ id: "d", student: { id: "s4", full_name: "Lina", guardian_id: "gd2", guardian_name: "Umm Lina", is_self_guardian: false }, outstanding_minor: 5000, invoice_token: null }),
      ],
      summary: subSummary(),
      meta: { current_page: 1, last_page: 1, per_page: 50, total: 4 },
    });
    render(withAuth(owner(), <SubscriptionsManager />));
    await screen.findByTestId("subscriptions-families");

    const family = screen.getByTestId("family-gd1");
    await userEvent.click(within(family).getByTestId("family-pay-copy"));
    expect(payLink).toHaveBeenCalledWith("gd1");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://lingo.test/f/tok"));

    // One bill: its own page, no family link asked for.
    payLink.mockClear();
    await userEvent.click(within(screen.getByTestId("family-student:s3")).getByTestId("family-pay-copy"));
    expect(payLink).not.toHaveBeenCalled();
    await waitFor(() => expect(writeText.mock.calls.at(-1)?.[0]).toContain("t-c"));

    // Nothing payable yet (no bill page): no bar.
    expect(within(screen.getByTestId("family-gd2")).queryByTestId("family-pay-bar")).toBeNull();
  });

  it("switches views from the tabs and the URL, and groups the due view by family with what each owes", async () => {
    nav.params = new URLSearchParams("view=due");
    api.listSubscriptions.mockResolvedValue({
      rows: [
        subRow({ id: "a", outstanding_minor: 72000, invoice_paid_minor: 0 }),
        subRow({ id: "b", student: { id: "s2", full_name: "Sara", guardian_id: "gd1", guardian_name: "Umm Adam", is_self_guardian: false }, outstanding_minor: 30000, invoice_paid_minor: 42000 }),
        subRow({ id: "c", student: { id: "s3", full_name: "Omar", guardian_id: null, guardian_name: null, is_self_guardian: true }, outstanding_minor: 9000, invoice_paid_minor: 63000, renewal_held: true, outside_count: 2 }),
      ],
      summary: subSummary(),
      meta: { current_page: 1, last_page: 1, per_page: 50, total: 3 },
    });
    render(withAuth(owner(), <SubscriptionsManager />));
    await screen.findByTestId("subscriptions-families");
    expect(api.listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ view: "due" }));
    const family = screen.getByTestId("family-gd1");
    expect(family).toHaveTextContent("Umm Adam");
    expect(family).toHaveTextContent("Adam");
    expect(family).toHaveTextContent("Sara");
    // 720 + 300 owed by the family, in one figure.
    expect(family.textContent).toContain(money(102000));
    const omar = screen.getByTestId("family-student:s3");
    expect(within(omar).getByTestId("subscription-held")).toBeTruthy();
    expect(within(omar).getByTestId("subscription-outside")).toBeTruthy();

    await userEvent.click(screen.getByTestId("subscriptions-tab-finished"));
    expect(nav.replace).toHaveBeenCalledWith("/subscriptions?view=finished");
    await waitFor(() => expect(api.listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ view: "finished" })));
  });

  it("filters by the search box and the teacher", async () => {
    render(withAuth(owner(), <SubscriptionsManager />));
    await screen.findByTestId("subscription-sub1");
    await userEvent.type(screen.getByLabelText(ar.search), "Adam");
    await waitFor(() => expect(api.listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ q: "Adam" })));
    await userEvent.click(await screen.findByTestId("subscriptions-teacher"));
    await userEvent.click(await screen.findByRole("option", { name: /Mr Ali/ }));
    await waitFor(() => expect(api.listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ teacher_id: "t1" })));
  });

  it("offers the actions the status allows: close on an open block, sell next on a finished one, delete only while deletable, reminders on what is owed", async () => {
    api.listSubscriptions.mockResolvedValue({
      rows: [
        subRow({ id: "open" }),
        subRow({ id: "fin", status: "FINISHED", lessons_used: 8, lessons_left: 0, outstanding_minor: 20000 }),
        subRow({ id: "new", deletable: true, lessons_used: 0, lessons_left: 8, invoice_paid_minor: 0, outstanding_minor: 72000 }),
      ],
      summary: subSummary(),
      meta: { current_page: 1, last_page: 1, per_page: 50, total: 3 },
    });
    render(withAuth(owner(), <SubscriptionsManager />));
    const open = await screen.findByTestId("subscription-open");
    expect(within(open).getByTestId("subscription-close")).toBeTruthy();
    expect(within(open).queryByTestId("subscription-renew")).toBeNull();
    expect(within(open).queryByTestId("subscription-cancel")).toBeNull();
    expect(within(open).queryByTestId("subscription-remind-payment")).toBeNull();
    const fin = screen.getByTestId("subscription-fin");
    expect(within(fin).getByTestId("subscription-renew")).toBeTruthy();
    expect(within(fin).queryByTestId("subscription-close")).toBeNull();
    expect(within(fin).getByTestId("subscription-remind-payment")).toBeTruthy();
    expect(within(fin).getByTestId("subscription-remind-finished")).toBeTruthy();
    const fresh = screen.getByTestId("subscription-new");
    expect(within(fresh).getByTestId("subscription-cancel")).toBeTruthy();
  });

  it("sends a reminder through the contract's route and shows the message that went (or did not)", async () => {
    api.listSubscriptions.mockResolvedValue({ rows: [subRow({ outstanding_minor: 20000 })], summary: subSummary(), meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 } });
    api.remindSubscription.mockResolvedValue({ sent: false, preview: "مرحبًا، فاتورة الاشتراك…" });
    render(withAuth(owner(), <SubscriptionsManager />));
    await userEvent.click(within(await screen.findByTestId("subscription-sub1")).getByTestId("subscription-remind-payment"));
    await waitFor(() => expect(api.remindSubscription).toHaveBeenCalledWith("sub1", "PAYMENT"));
    const preview = await screen.findByTestId("subscription-remind-preview");
    expect(preview).toHaveTextContent("مرحبًا، فاتورة الاشتراك…");
    expect(preview).toHaveTextContent(ar.remind.notSent.replace("{name}", "Adam"));
  });

  it("opens a block's detail — its facts and the lessons numbered 1..sold, one outside it flagged — from the row and from ?id=", async () => {
    api.getSubscription.mockResolvedValue({
      subscription: subRow(),
      lessons: [
        { session_id: "l1", scheduled_at_utc: "2026-10-02T15:00:00Z", duration_minutes: 40, teacher_name: "Mr Ali", status: "ATTENDED", counted_at: "2026-10-02T16:00:00Z", number: 1 },
        { session_id: "l2", scheduled_at_utc: "2026-10-04T15:00:00Z", duration_minutes: 40, teacher_name: "Mr Ali", status: "ATTENDED", counted_at: "2026-10-04T16:00:00Z", number: 2 },
        { session_id: "l9", scheduled_at_utc: "2026-11-01T15:00:00Z", duration_minutes: 40, teacher_name: "Mr Ali", status: "ATTENDED", counted_at: null, number: null },
      ],
    });
    render(withAuth(owner(), <SubscriptionsManager />));
    await userEvent.click(within(await screen.findByTestId("subscription-sub1")).getByTestId("subscription-detail-open"));
    await waitFor(() => expect(api.getSubscription).toHaveBeenCalledWith("sub1"));
    const list = await screen.findByTestId("subscription-lessons");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("subscription-lesson-l2")).toHaveTextContent("2");
    expect(screen.getByTestId("subscription-lesson-l9")).toHaveAttribute("data-outside", "true");
    expect(screen.getByTestId("subscription-lesson-l9")).toHaveTextContent(ar.detail.outsideLesson);
    expect(screen.getByTestId("subscription-detail")).toHaveTextContent("Nour");
  });

  it("opens the detail straight from ?id= (a bill line on the family's account) and the sell form from ?open=", async () => {
    nav.params = new URLSearchParams("id=sub1");
    api.getSubscription.mockResolvedValue({ subscription: subRow(), lessons: [] });
    const { unmount } = render(withAuth(owner(), <SubscriptionsManager />));
    await waitFor(() => expect(api.getSubscription).toHaveBeenCalledWith("sub1"));
    expect(await screen.findByTestId("subscription-detail")).toBeTruthy();
    unmount();

    nav.params = new URLSearchParams("open=s1");
    render(withAuth(owner(), <SubscriptionsManager />));
    expect(await screen.findByTestId("sell-subscription-form")).toBeTruthy();
    await waitFor(() => expect(api.listSubscriptionStudents).toHaveBeenCalled());
  });

  it("shows no sell button, no edit and no close to whoever may only read", async () => {
    render(withAuth(makeSession("ACCOUNTANT", { permissions: ["package.read"], capabilities: ["centre"] }), <SubscriptionsManager />));
    const row = await screen.findByTestId("subscription-sub1");
    expect(screen.queryByTestId("subscriptions-sell")).toBeNull();
    expect(within(row).queryByTestId("subscription-edit")).toBeNull();
    expect(within(row).queryByTestId("subscription-close")).toBeNull();
  });

  it("shows the view's own empty state, with a sell button on the open view only", async () => {
    api.listSubscriptions.mockResolvedValue({ rows: [], summary: subSummary({ open: 0 }), meta: { current_page: 1, last_page: 1, per_page: 50, total: 0 } });
    render(withAuth(owner(), <SubscriptionsManager />));
    const empty = await screen.findByTestId("subscriptions-empty");
    expect(empty).toHaveTextContent(ar.empty.open);
    expect(within(empty).getByRole("button")).toBeTruthy();
    await userEvent.click(screen.getByTestId("subscriptions-tab-outside"));
    await waitFor(() => expect(screen.getByTestId("subscriptions-empty")).toHaveTextContent(ar.empty.outside));
    expect(within(screen.getByTestId("subscriptions-empty")).queryByRole("button")).toBeNull();
  });
});
