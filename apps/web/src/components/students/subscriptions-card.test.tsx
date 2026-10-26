import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { SubscriptionsCard } from "./subscriptions-card";

/**
 * The student's subscriptions card (centre mode): groups and private subscriptions on one card,
 * enrol in a group from it, edit or end any open row — and nothing at all for an academy without
 * `centre`.
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
const listLessonPackages = vi.fn();
const pkgApi = { closeLessonPackage: vi.fn(), cancelLessonPackage: vi.fn(), updateLessonPackage: vi.fn() };
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listLessonPackages: (...a: unknown[]) => listLessonPackages(...a),
  listPackageStudents: () => Promise.resolve({ students: [] }),
  closeLessonPackage: (...a: unknown[]) => pkgApi.closeLessonPackage(...a),
  cancelLessonPackage: (...a: unknown[]) => pkgApi.cancelLessonPackage(...a),
  updateLessonPackage: (...a: unknown[]) => pkgApi.updateLessonPackage(...a),
}));

const ar = arMessages.students.subscriptions;
const arGroups = arMessages.groups.members;
const perms = ["student.read", "group.read", "group.manage", "package.read", "package.manage"];
const member = (over: Record<string, unknown> = {}) => ({
  id: "m1", group_id: "g1", group_name: "English A1", group_level: "A1", teacher_id: "t1", teacher_name: "Miss Mona", student_id: "s1", full_name: "Adam", guardian_name: null,
  student_removed: false, joined_on: "2026-05-01", left_on: null, status: "ACTIVE", left_reason: null, attendance: { present: 4, late: 0, absent: 0, excused: 0, marked: 4, rate: 1 }, recent: [], absent_streak: 0,
  charge: { currency: "EGP", billed_minor: 45000, outstanding_minor: 45000 }, ...over,
});
const pkg = (over: Record<string, unknown> = {}) => ({
  id: "p1", student_id: "s1", student_name: "Adam", label: "10 hours with Ali", sequence_no: 1, status: "ACTIVE", bill_timing: "ON_START", minutes_total: 600, carried_over_minutes: 0, minutes_sold: 600,
  minutes_consumed: 150, minutes_remaining: 450, minutes_overdrawn: 0, lesson_count: 3, upcoming_lesson_count: 2, next_lesson_at: null, percent_used: 25, price_minor: 100000, hourly_rate_minor: 10000, currency: "EGP",
  starts_on: "2026-06-01", expires_on: null, closed_at: null, closed_reason: null, invoice_id: "i1", invoice_status: "OPEN", invoice_token: null, invoice_total_minor: 100000, invoice_paid_minor: 100000, outstanding_minor: 0, paid_at: null,
  absorbed_overdraft_minutes: 0, auto_renew: true, ...over,
});
const groupDetail = {
  id: "g1", name: "English A1", timezone: "Africa/Cairo", start_date: "2026-04-01", capacity: null, member_count: 1, state: "RUNNING",
  pricing: { billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP" },
  members: [{ id: "m1", student_id: "s1", full_name: "Adam", guardian_name: null, joined_on: "2026-05-01", left_on: null, status: "ACTIVE", left_reason: null, student_removed: false, attendance: null, price_minor: null }],
};
const owner = () => makeSession("ACADEMY_OWNER", { permissions: [...perms, "student.set_price"], capabilities: ["invoicing", "groups", "packages", "centre"] });

beforeEach(() => {
  Object.values(groupsApi).forEach((f) => f.mockReset());
  listLessonPackages.mockReset();
  Object.values(pkgApi).forEach((f) => f.mockReset());
  Object.values(policyApi).forEach((f) => f.mockReset());
  groupsApi.getGroup.mockResolvedValue({ group: groupDetail });
  groupsApi.listBoardMembers.mockResolvedValue({ members: [member()], thresholds: { streak: 3, low_rate: 0.6 }, sees_money: true });
  listLessonPackages.mockResolvedValue({ packages: [pkg()] });
});

describe("SubscriptionsCard", () => {
  it("does not exist — and asks nothing — without centre mode", () => {
    const { container } = render(withAuth(makeSession("ACADEMY_OWNER", { permissions: perms, capabilities: ["invoicing", "groups", "packages"] }), <SubscriptionsCard studentId="s1" studentName="Adam" />));
    expect(container.querySelector('[data-testid="student-subscriptions"]')).toBeNull();
    expect(groupsApi.listBoardMembers).not.toHaveBeenCalled();
    expect(listLessonPackages).not.toHaveBeenCalled();
  });

  it("lists the student's groups and private subscriptions, and enrols them in another group", async () => {
    groupsApi.listGroups.mockResolvedValue({ groups: [{ id: "g1", name: "English A1", start_date: "2026-05-01", lessons: { held: 3 } }, { id: "g2", name: "Math B2", teacher_name: "Mr Ali", start_date: "2026-06-10", lessons: { held: 0 } }], counts: {} });
    groupsApi.addGroupMembers.mockResolvedValue({ added: 1, group: {} });
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: perms, capabilities: ["invoicing", "groups", "packages", "centre"] }), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    const card = await screen.findByTestId("student-subscriptions");
    expect(groupsApi.listBoardMembers).toHaveBeenCalledWith({ student_id: "s1", status: "ALL" });
    expect(listLessonPackages).toHaveBeenCalledWith({ student_id: "s1" });
    expect(within(await screen.findByTestId("subs-groups")).getByRole("link", { name: "English A1" })).toHaveAttribute("href", "/groups/g1?tab=accounts");
    expect(within(screen.getByTestId("subs-packages")).getByText("10 hours with Ali")).toBeTruthy();
    const left = ar.remaining.split("{hours}")[1]!.trim();
    expect(within(card).getByText((text) => text.includes(left))).toBeTruthy();

    await userEvent.click(screen.getByTestId("subs-join-group"));
    // The group they are already in is not offered again.
    const pick = await screen.findByTestId("subs-group-pick");
    await waitFor(() => expect(within(pick).queryByRole("option", { name: /Math B2/ })).toBeTruthy());
    expect(within(pick).queryByRole("option", { name: /English A1/ })).toBeNull();
    await userEvent.selectOptions(pick, "g2");
    await userEvent.click(screen.getByTestId("subs-join-confirm"));
    // A class nobody has attended yet takes the student from its first lesson.
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
    // The price tab is there for whoever may price; the move tab always.
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

  it("edits a private subscription with the packages page's form, and ends it by closing — or cancelling one never used", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg(), pkg({ id: "p2", label: "Untouched", minutes_consumed: 0, minutes_remaining: 600 })] });
    pkgApi.closeLessonPackage.mockResolvedValue({ ok: true, invoice_id: "i1", returned_to_monthly: false });
    pkgApi.cancelLessonPackage.mockResolvedValue({ ok: true });
    render(withAuth(owner(), <SubscriptionsCard studentId="s1" studentName="Adam" />));

    await userEvent.click(within(await screen.findByTestId("subs-package-p1")).getByTestId("subs-edit"));
    expect(await screen.findByDisplayValue("10 hours with Ali")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: arMessages.packages.actions.cancel }));

    // A used package closes (what was used is billed); there is no cancel for it.
    await userEvent.click(within(screen.getByTestId("subs-package-p1")).getByTestId("subs-end"));
    expect(screen.queryByTestId("pkg-cancel-instead")).toBeNull();
    await userEvent.type(screen.getByLabelText(arMessages.packages.close.reason), "left the centre");
    await userEvent.click(screen.getByTestId("pkg-close-confirm"));
    await waitFor(() => expect(pkgApi.closeLessonPackage).toHaveBeenCalledWith("p1", "left the centre", false));

    // One nothing was taken from can be cancelled instead.
    await userEvent.click(within(await screen.findByTestId("subs-package-p2")).getByTestId("subs-end"));
    await userEvent.click(await screen.findByTestId("pkg-cancel-confirm"));
    await waitFor(() => expect(pkgApi.cancelLessonPackage).toHaveBeenCalledWith("p2", undefined));
  });

  it("offers no edit or end to whoever may not manage groups or packages", async () => {
    render(withAuth(makeSession("SUPERVISOR", { permissions: ["student.read", "group.read", "package.read"], capabilities: ["invoicing", "groups", "packages", "centre"] }), <SubscriptionsCard studentId="s1" studentName="Adam" />));
    await screen.findByTestId("subs-group-g1");
    expect(screen.queryByTestId("subs-edit")).toBeNull();
    expect(screen.queryByTestId("subs-end")).toBeNull();
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

  it("shows a family-wide pay first as set, locked, pointing at the family's page", async () => {
    const withAccounting = makeSession("ACADEMY_OWNER", { permissions: [...perms, "invoice.read", "invoice.mark_paid"], capabilities: ["invoicing", "groups", "packages", "centre", "accounting"] });
    policyApi.getStudentRenewalPolicy.mockResolvedValue({ policy: "FREE", family_policy: "PAY_FIRST", guardian_id: "gd1", effective: "PAY_FIRST" });
    render(withAuth(withAccounting, <SubscriptionsCard studentId="s1" studentName="Adam" />));
    const control = await screen.findByTestId("renewal-policy");
    expect(within(control).getByTestId("renewal-PAY_FIRST")).toHaveAttribute("aria-checked", "true");
    expect(within(control).getByTestId("renewal-FREE")).toBeDisabled();
    expect(within(control).getByRole("link", { name: arMessages.accounting.renewal.inherited })).toHaveAttribute("href", "/guardians/gd1");
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
});
