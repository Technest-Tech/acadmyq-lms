import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { SubscriptionsCard } from "./subscriptions-card";

/**
 * The student's subscriptions card (centre mode): groups and private subscriptions on one card,
 * enrol in a group from it — and nothing at all for an academy without `centre`.
 */
const groupsApi = { listBoardMembers: vi.fn(), listGroups: vi.fn(), addGroupMembers: vi.fn() };
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listBoardMembers: (...a: unknown[]) => groupsApi.listBoardMembers(...a),
  listGroups: (...a: unknown[]) => groupsApi.listGroups(...a),
  addGroupMembers: (...a: unknown[]) => groupsApi.addGroupMembers(...a),
}));
const listLessonPackages = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listLessonPackages: (...a: unknown[]) => listLessonPackages(...a),
  listPackageStudents: () => Promise.resolve({ students: [] }),
}));

const ar = arMessages.students.subscriptions;
const perms = ["student.read", "group.read", "group.manage", "package.read", "package.manage"];
const member = (over: Record<string, unknown> = {}) => ({
  id: "m1", group_id: "g1", group_name: "English A1", group_level: "A1", teacher_id: "t1", teacher_name: "Miss Mona", student_id: "s1", full_name: "Adam", guardian_name: null,
  student_removed: false, joined_on: "2026-05-01", left_on: null, status: "ACTIVE", attendance: { present: 4, late: 0, absent: 0, excused: 0, marked: 4, rate: 1 }, recent: [], absent_streak: 0,
  charge: { currency: "EGP", billed_minor: 45000, outstanding_minor: 45000 }, ...over,
});
const pkg = (over: Record<string, unknown> = {}) => ({
  id: "p1", student_id: "s1", student_name: "Adam", label: "10 hours with Ali", sequence_no: 1, status: "ACTIVE", bill_timing: "ON_START", minutes_total: 600, carried_over_minutes: 0, minutes_sold: 600,
  minutes_consumed: 150, minutes_remaining: 450, minutes_overdrawn: 0, lesson_count: 3, upcoming_lesson_count: 2, next_lesson_at: null, percent_used: 25, price_minor: 100000, hourly_rate_minor: 10000, currency: "EGP",
  starts_on: "2026-06-01", expires_on: null, closed_at: null, closed_reason: null, invoice_id: "i1", invoice_status: "OPEN", invoice_token: null, invoice_total_minor: 100000, invoice_paid_minor: 100000, outstanding_minor: 0, paid_at: null, ...over,
});

beforeEach(() => {
  Object.values(groupsApi).forEach((f) => f.mockReset());
  listLessonPackages.mockReset();
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
});
