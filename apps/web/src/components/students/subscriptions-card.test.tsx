import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { subRow, studentPick } from "@/components/subscriptions/test-fixtures";
import { formatMoney } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { SubscriptionsCard } from "./subscriptions-card";

/**
 * The student's subscriptions card (centre mode): groups and private subscriptions on one card,
 * enrol in a group from it, edit or end any open row — and nothing at all for an academy without
 * `centre`. The private half reads the centre's own table (docs/centre-profile/01), never packages.
 */
const groupsApi = { listBoardMembers: vi.fn(), listGroups: vi.fn(), addGroupMembers: vi.fn(), getGroup: vi.fn(), updateGroupMember: vi.fn(), removeGroupMember: vi.fn(), undoGroupMember: vi.fn() };
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listBoardMembers: (...a: unknown[]) => groupsApi.listBoardMembers(...a),
  listGroups: (...a: unknown[]) => groupsApi.listGroups(...a),
  addGroupMembers: (...a: unknown[]) => groupsApi.addGroupMembers(...a),
  getGroup: (...a: unknown[]) => groupsApi.getGroup(...a),
  updateGroupMember: (...a: unknown[]) => groupsApi.updateGroupMember(...a),
  removeGroupMember: (...a: unknown[]) => groupsApi.removeGroupMember(...a),
  undoGroupMember: (...a: unknown[]) => groupsApi.undoGroupMember(...a),
}));
const policyApi = { getStudentRenewalPolicy: vi.fn(), setStudentRenewalPolicy: vi.fn() };
vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getStudentRenewalPolicy: (...a: unknown[]) => policyApi.getStudentRenewalPolicy(...a),
  setStudentRenewalPolicy: (...a: unknown[]) => policyApi.setStudentRenewalPolicy(...a),
}));
const subsApi = { listSubscriptions: vi.fn(), listSubscriptionStudents: vi.fn(), sellSubscription: vi.fn(), updateSubscription: vi.fn(), getSubscriptionSettlement: vi.fn(), closeSubscription: vi.fn(), cancelSubscription: vi.fn(), getSubscription: vi.fn() };
vi.mock("@/lib/subscriptions-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscriptions-api")>()),
  listSubscriptions: (...a: unknown[]) => subsApi.listSubscriptions(...a),
  listSubscriptionStudents: (...a: unknown[]) => subsApi.listSubscriptionStudents(...a),
  sellSubscription: (...a: unknown[]) => subsApi.sellSubscription(...a),
  updateSubscription: (...a: unknown[]) => subsApi.updateSubscription(...a),
  getSubscriptionSettlement: (...a: unknown[]) => subsApi.getSubscriptionSettlement(...a),
  closeSubscription: (...a: unknown[]) => subsApi.closeSubscription(...a),
  cancelSubscription: (...a: unknown[]) => subsApi.cancelSubscription(...a),
  getSubscription: (...a: unknown[]) => subsApi.getSubscription(...a),
}));
const listLessonPackages = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listLessonPackages: (...a: unknown[]) => listLessonPackages(...a),
  listTeachers: () => Promise.resolve({ rows: [{ id: "t1", full_name: "Mr Ali" }], total: 1, page: 1, pageSize: 200 }),
}));

const ar = arMessages.students.subscriptions;
const money = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");
const arSubs = arMessages.subscriptions;
const arGroups = arMessages.groups.members;
const perms = ["student.read", "group.read", "group.manage", "package.read", "package.manage"];
const member = (over: Record<string, unknown> = {}) => ({
  id: "m1", group_id: "g1", group_name: "English A1", group_level: "A1", teacher_id: "t1", teacher_name: "Miss Mona", student_id: "s1", full_name: "Adam", guardian_name: null,
  student_removed: false, joined_on: "2026-05-01", left_on: null, status: "ACTIVE", left_reason: null, attendance: { present: 4, late: 0, absent: 0, excused: 0, marked: 4, rate: 1 }, recent: [], absent_streak: 0,
  charge: { currency: "EGP", billed_minor: 45000, outstanding_minor: 45000 }, ...over,
});
const groupDetail = {
  id: "g1", name: "English A1", timezone: "Africa/Cairo", start_date: "2026-04-01", capacity: null, member_count: 1, state: "RUNNING",
  pricing: { billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP" },
  members: [{ id: "m1", student_id: "s1", full_name: "Adam", guardian_name: null, joined_on: "2026-05-01", left_on: null, status: "ACTIVE", left_reason: null, student_removed: false, attendance: null, price_minor: null }],
};
const owner = () => makeSession("ACADEMY_OWNER", { permissions: [...perms, "student.set_price"], capabilities: ["invoicing", "groups", "packages", "centre"] });

beforeEach(() => {
  Object.values(groupsApi).forEach((f) => f.mockReset());
  Object.values(subsApi).forEach((f) => f.mockReset());
  Object.values(policyApi).forEach((f) => f.mockReset());
  listLessonPackages.mockReset();
  groupsApi.getGroup.mockResolvedValue({ group: groupDetail });
  groupsApi.listBoardMembers.mockResolvedValue({ members: [member()], thresholds: { streak: 3, low_rate: 0.6 }, sees_money: true });
  subsApi.listSubscriptions.mockResolvedValue({ rows: [subRow()], summary: {}, meta: {} });
  subsApi.listSubscriptionStudents.mockResolvedValue({ rows: [studentPick()] });
  subsApi.getSubscriptionSettlement.mockResolvedValue({ paid_minor: 72000, used_value_minor: 27000, owed_back_minor: 0, currency: "EGP", can_refund: false });
});

describe("SubscriptionsCard", () => {
  it("does not exist — and asks nothing — without centre mode", () => {
    const { container } = render(withAuth(makeSession("ACADEMY_OWNER", { permissions: perms, capabilities: ["invoicing", "groups", "packages"] }), <SubscriptionsCard studentId="s1" studentName="Adam" />));
    expect(container.querySelector('[data-testid="student-subscriptions"]')).toBeNull();
    expect(groupsApi.listBoardMembers).not.toHaveBeenCalled();
    expect(subsApi.listSubscriptions).not.toHaveBeenCalled();
  });

  it("lists the student's groups and private subscriptions — read from /subscriptions, never packages — and enrols them in another group", async () => {
    groupsApi.listGroups.mockResolvedValue({ groups: [{ id: "g1", name: "English A1", start_date: "2026-05-01", lessons: { held: 3 } }, { id: "g2", name: "Math B2", teacher_name: "Mr Ali", start_date: "2026-06-10", lessons: { held: 0 } }], counts: {} });
    groupsApi.addGroupMembers.mockResolvedValue({ added: 1, group: {} });
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: perms, capabilities: ["invoicing", "groups", "packages", "centre"] }), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    await screen.findByTestId("student-subscriptions");
    expect(groupsApi.listBoardMembers).toHaveBeenCalledWith({ student_id: "s1", status: "ALL" });
    expect(subsApi.listSubscriptions).toHaveBeenCalledWith({ student_id: "s1" });
    expect(listLessonPackages).not.toHaveBeenCalled();
    expect(within(await screen.findByTestId("subs-groups")).getByRole("link", { name: "English A1" })).toHaveAttribute("href", "/groups/g1?tab=accounts");
    const row = within(screen.getByTestId("subs-packages")).getByTestId("subscription-sub1");
    // The block's facts: lessons used of sold, the lesson's price and length, the bill paid.
    expect(within(row).getByTestId("subscription-lessons-bar")).toHaveTextContent("3 / 8");
    expect(within(row).getByTestId("subscription-facts").textContent).toContain("40");
    expect(within(row).getByTestId("subscription-bill")).toHaveTextContent(arSubs.row.paid);

    await userEvent.click(screen.getByTestId("subs-join-group"));
    const pick = await screen.findByTestId("subs-group-pick");
    await waitFor(() => expect(within(pick).queryByRole("option", { name: /Math B2/ })).toBeTruthy());
    expect(within(pick).queryByRole("option", { name: /English A1/ })).toBeNull();
    await userEvent.selectOptions(pick, "g2");
    await userEvent.click(screen.getByTestId("subs-join-confirm"));
    await waitFor(() => expect(groupsApi.addGroupMembers).toHaveBeenCalledWith("g2", expect.objectContaining({ student_ids: ["s1"], joined_on: "2026-06-10" })));
  });

  it("edits a group membership: the join date opens on the row's own, and saves through the member endpoint", async () => {
    groupsApi.updateGroupMember.mockResolvedValue({ group: groupDetail });
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    const row = await screen.findByTestId("subs-group-g1");
    await userEvent.click(within(row).getByTestId("subs-edit"));
    await waitFor(() => expect(groupsApi.getGroup).toHaveBeenCalledWith("g1"));
    const date = await screen.findByTestId("join-date");
    expect(date).toHaveValue("2026-05-01");
    expect(screen.getByTestId("subs-tab-price")).toBeTruthy();
    expect(screen.getByTestId("subs-tab-move")).toBeTruthy();

    await userEvent.clear(date);
    await userEvent.type(date, "2026-04-20");
    await userEvent.click(screen.getByTestId("join-date-save"));
    await waitFor(() => expect(groupsApi.updateGroupMember).toHaveBeenCalledWith("g1", "s1", { joined_on: "2026-04-20" }));
    expect(await screen.findByText(ar.saved)).toBeTruthy();
  });

  it("ends one group — a pause with its date and a note — and shows it greyed with the reason", async () => {
    groupsApi.removeGroupMember.mockResolvedValue({ group: groupDetail });
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    await userEvent.click(within(await screen.findByTestId("subs-group-g1")).getByTestId("subs-end"));
    const on = await screen.findByTestId("leave-on");
    await userEvent.clear(on);
    await userEvent.type(on, "2026-07-01");
    await userEvent.selectOptions(screen.getByTestId("leave-kind"), "PAUSED");
    await userEvent.type(screen.getByTestId("leave-note"), "travelling");
    groupsApi.listBoardMembers.mockResolvedValue({
      members: [member({ status: "LEFT", left_on: "2026-07-01", left_reason: "PAUSED: travelling" })], thresholds: { streak: 3, low_rate: 0.6 }, sees_money: true,
    });
    await userEvent.click(screen.getByRole("button", { name: arGroups.removeConfirm }));

    await waitFor(() => expect(groupsApi.removeGroupMember).toHaveBeenCalledWith("g1", "s1", { left_on: "2026-07-01", reason: "PAUSED: travelling" }));
    const row = await screen.findByTestId("subs-group-g1");
    await waitFor(() => expect(row.textContent).toContain(`${arGroups.leaveKinds.PAUSED} — travelling`));
    expect(within(row).queryByTestId("subs-end")).toBeNull();
  });

  it("edits a private subscription with the subscriptions page's form, and ends it by closing with a reason", async () => {
    subsApi.updateSubscription.mockResolvedValue({ subscription: subRow({ lessons_sold: 10 }), invoice_id: "i1", credited_minor: 0, due_minor: 18000, moved_lessons: 0 });
    subsApi.closeSubscription.mockResolvedValue({ subscription: subRow({ status: "CLOSED" }), settlement: null });
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    await userEvent.click(within(await screen.findByTestId("subscription-sub1")).getByTestId("subscription-edit"));
    const lessons = await screen.findByTestId("edit-lessons");
    expect(lessons).toHaveValue(8);
    await userEvent.clear(lessons);
    await userEvent.type(lessons, "10");
    await userEvent.click(screen.getByTestId("edit-confirm"));
    await waitFor(() => expect(subsApi.updateSubscription).toHaveBeenCalledWith("sub1", expect.objectContaining({ lessons_sold: 10, lesson_price_minor: 9000, price_minor: 90000, teacher_id: "t1", course: "English", starts_on: "2026-10-01" })));
    // What a dearer block leaves owed is said back.
    await waitFor(() => expect(document.body.textContent).toContain(money(18000)));
    expect(document.body.textContent).toContain(arSubs.edit.savedDue.split("{amount}")[0]!.trim());

    await userEvent.click(within(await screen.findByTestId("subscription-sub1")).getByTestId("subscription-close"));
    await waitFor(() => expect(subsApi.getSubscriptionSettlement).toHaveBeenCalledWith("sub1"));
    // Nothing paid beyond what was used: no settlement asked. A used block cannot be deleted.
    expect(screen.queryByTestId("subscription-settlement")).toBeNull();
    expect(screen.queryByTestId("close-cancel-instead")).toBeNull();
    await userEvent.type(screen.getByTestId("close-reason"), "left the centre");
    await userEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(subsApi.closeSubscription).toHaveBeenCalledWith("sub1", { reason: "left the centre" }));
  });

  it("asks, as a paid block closes with lessons left, what becomes of the money — and sends the answer with the close", async () => {
    subsApi.getSubscriptionSettlement.mockResolvedValue({ paid_minor: 72000, used_value_minor: 27000, owed_back_minor: 45000, currency: "EGP", can_refund: false });
    subsApi.closeSubscription.mockResolvedValue({ subscription: subRow({ status: "CLOSED" }), settlement: { mode: "KEEP", amount_minor: 45000, currency: "EGP" } });
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    await userEvent.click(within(await screen.findByTestId("subscription-sub1")).getByTestId("subscription-close"));
    const fields = await screen.findByTestId("subscription-settlement");
    // No refund from here: that choice is offered, and closed; "later" is there.
    expect(within(screen.getByTestId("subscription-settle-REFUND")).getByRole("radio")).toBeDisabled();
    expect(within(fields).getByTestId("subscription-settle-LATER")).toBeTruthy();
    await userEvent.click(within(screen.getByTestId("subscription-settle-KEEP")).getByRole("radio"));
    await userEvent.type(screen.getByTestId("subscription-settle-note"), "Stopped without notice");
    await userEvent.type(screen.getByTestId("close-reason"), "stopped");
    await userEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(subsApi.closeSubscription).toHaveBeenCalledWith("sub1", { reason: "stopped", settlement: "KEEP", settlement_note: "Stopped without notice" }));
    await waitFor(() => expect(document.body.textContent).toContain(money(45000)));
  });

  it("says why a finished subscription ended, and sells the next one only for a subject's latest block with nothing open — prefilled from it", async () => {
    const sama = { id: "t9", full_name: "Ms Sama" };
    subsApi.listSubscriptions.mockResolvedValue({
      rows: [
        subRow({ id: "open", sequence_no: 3 }),
        subRow({ id: "ended", teacher: sama, course: "Connect Plus", sequence_no: 2, status: "CLOSED", closed_reason: "travelling", closed_at: "2026-10-28T10:00:00Z", closed_by_name: "Nour", lessons_used: 8, lessons_left: 0 }),
        subRow({ id: "older", teacher: sama, course: "Connect Plus", sequence_no: 1, status: "FINISHED", finished_at: "2026-10-20T10:00:00Z", lessons_used: 8, lessons_left: 0 }),
        subRow({ id: "ali-old", sequence_no: 0, status: "FINISHED", lessons_used: 8, lessons_left: 0 }),
      ],
      summary: {},
      meta: {},
    });
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    const ended = await screen.findByTestId("subscription-ended");
    expect(within(ended).getByTestId("subscription-facts")).toHaveTextContent("travelling · Nour");
    // Connect Plus has nothing open: its newest block sells again; English is still running.
    expect(within(screen.getByTestId("subscription-older")).queryByTestId("subscription-renew")).toBeNull();
    expect(within(screen.getByTestId("subscription-ali-old")).queryByTestId("subscription-renew")).toBeNull();
    await userEvent.click(within(ended).getByTestId("subscription-renew"));
    expect(await screen.findByText(ar.newPrivateTitle.replace("{name}", "Adam"))).toBeInTheDocument();
    // The sell form starts from the finished block's terms.
    expect(await screen.findByTestId("sell-lessons")).toHaveValue(8);
    expect(screen.getByTestId("sell-unit-price")).toHaveValue(90);
  });

  it("offers no edit or end to whoever may not manage groups or subscriptions", async () => {
    render(withAuth(makeSession("SUPERVISOR", { permissions: ["student.read", "group.read", "package.read"], capabilities: ["invoicing", "groups", "packages", "centre"] }), <SubscriptionsCard studentId="s1" studentName="Adam" />));
    await screen.findByTestId("subscription-sub1");
    expect(screen.queryByTestId("subs-edit")).toBeNull();
    expect(screen.queryByTestId("subs-end")).toBeNull();
    expect(screen.queryByTestId("subscription-edit")).toBeNull();
    expect(screen.queryByTestId("subscription-close")).toBeNull();
  });

  it("sets this student's renewal policy where the academy is on receipts — and asks nothing elsewhere", async () => {
    const { unmount } = render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));
    await screen.findByTestId("subs-group-g1");
    expect(policyApi.getStudentRenewalPolicy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("renewal-policy")).toBeNull();
    unmount();

    const withAccounting = makeSession("ACADEMY_OWNER", { permissions: [...perms, "invoice.read", "invoice.mark_paid"], capabilities: ["invoicing", "groups", "packages", "centre", "accounting"] });
    policyApi.getStudentRenewalPolicy.mockResolvedValue({ policy: "FREE", family_policy: "FREE", guardian_id: "gd1", effective: "FREE" });
    policyApi.setStudentRenewalPolicy.mockResolvedValue({ policy: "PAY_FIRST", family_policy: "FREE", guardian_id: "gd1", effective: "PAY_FIRST" });
    render(withAuth(withAccounting, <SubscriptionsCard studentId="s1" studentName="Adam" />));
    const control = await screen.findByTestId("renewal-policy");
    await userEvent.click(within(control).getByTestId("renewal-PAY_FIRST"));
    await waitFor(() => expect(policyApi.setStudentRenewalPolicy).toHaveBeenCalledWith("s1", "PAY_FIRST"));
    await waitFor(() => expect(within(screen.getByTestId("renewal-policy")).getByTestId("renewal-PAY_FIRST")).toHaveAttribute("aria-checked", "true"));
  });

  it("offers Delete only on a group subscription that can still be undone, and deletes it", async () => {
    groupsApi.listBoardMembers.mockResolvedValue({
      members: [member({ deletable: true }), member({ id: "m2", group_id: "g2", group_name: "Math B2", deletable: false })],
      thresholds: { streak: 3, low_rate: 0.6 }, sees_money: true,
    });
    groupsApi.undoGroupMember.mockResolvedValue({ group: groupDetail, credited_minor: 0 });
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    const wrong = await screen.findByTestId("subs-group-g1");
    expect(within(screen.getByTestId("subs-group-g2")).queryByTestId("subs-delete")).toBeNull();
    await userEvent.click(within(wrong).getByTestId("subs-delete"));
    await userEvent.click(await screen.findByTestId("subs-delete-confirm"));
    await waitFor(() => expect(groupsApi.undoGroupMember).toHaveBeenCalledWith("g1", "s1"));
    expect(await screen.findByText(ar.deleted)).toBeTruthy();
  });

  it("offers Delete only on a private subscription the API says can go, and voids it", async () => {
    subsApi.listSubscriptions.mockResolvedValue({
      rows: [subRow(), subRow({ id: "sub2", label: "Opened by mistake", lessons_used: 0, lessons_left: 8, invoice_paid_minor: 0, outstanding_minor: 72000, deletable: true })],
      summary: {},
      meta: {},
    });
    subsApi.cancelSubscription.mockResolvedValue(undefined);
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    const wrong = await screen.findByTestId("subscription-sub2");
    expect(within(screen.getByTestId("subscription-sub1")).queryByTestId("subscription-cancel")).toBeNull();
    await userEvent.click(within(wrong).getByTestId("subscription-cancel"));
    await userEvent.click(await screen.findByTestId("subscription-cancel-confirm"));
    await waitFor(() => expect(subsApi.cancelSubscription).toHaveBeenCalledWith("sub2"));
    expect(await screen.findByText(arSubs.cancel.done)).toBeTruthy();
  });
});
