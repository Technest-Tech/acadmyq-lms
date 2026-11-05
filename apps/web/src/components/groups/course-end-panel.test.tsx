import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { forWord } from "@/test/level-word";
import type { GroupDetail, GroupMember } from "@/lib/groups-api";
import type { Level } from "@/lib/levels-api";
import { CourseEndPanel } from "./course-end-panel";

/**
 * "نهاية الكورس" (docs/centre-profile, Phase 2 §2): the three ways a term ends, and the exact
 * payloads they send — a renewal from the day after the old end with the ticked members, a
 * promotion to the next level with who passed, a close with its reason.
 */

const renewGroup = vi.fn();
const promoteGroup = vi.fn();
const closeGroup = vi.fn();
const listLevels = vi.fn();
const push = vi.fn();

vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  renewGroup: (id: string, input: unknown) => renewGroup(id, input),
  promoteGroup: (id: string, input: unknown) => promoteGroup(id, input),
  closeGroup: (id: string, reason: unknown) => closeGroup(id, reason),
}));
vi.mock("@/lib/levels-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/levels-api")>()),
  listLevels: () => listLevels(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/groups/g1",
  useSearchParams: () => new URLSearchParams(),
}));

const ar = arMessages.courseTerm;

const level = (id: string, name: string, sort_order: number): Level => ({ id, name, sort_order, is_active: true, students_count: 0, groups_count: 0 });

function member(id: string, name: string): GroupMember {
  return {
    id: `m-${id}`,
    student_id: id,
    full_name: name,
    guardian_name: null,
    joined_on: "2026-03-01",
    left_on: null,
    status: "ACTIVE",
    left_reason: null,
    student_removed: false,
    attendance: { present: 8, late: 0, absent: 2, excused: 0, marked: 10, rate: 0.8 },
    price_minor: null,
  };
}

function group(over: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: "g1",
    name: "English A1 — evening",
    specialization_id: null,
    specialization_name: null,
    level: "A1",
    level_id: "l1",
    teacher_id: "t1",
    teacher_name: "Mona",
    capacity: 10,
    member_count: 3,
    mode: "OFFLINE",
    location: "Room 2",
    meeting_url: null,
    timezone: "Africa/Cairo",
    start_date: "2026-03-01",
    end_date: "2026-05-30",
    status: "ACTIVE",
    state: "FINISHED",
    slots: [{ weekday: 1, start_time_local: "17:00", duration_minutes: 60 }],
    lessons: { held: 24, cancelled: 0, upcoming: 0, overdue: 0, next_lesson_at: null },
    pricing: null,
    teacher_pay: null,
    lessons_planned: 24,
    lessons_held: 24,
    lessons_remaining: 0,
    ends_in_days: -5,
    ending_soon: false,
    waiting_count: 0,
    continues_group_id: null,
    continues_group_name: null,
    closed_reason: null,
    notes: null,
    effective_meeting_url: null,
    members: [member("s-adam", "Adam"), member("s-bassel", "Bassel"), member("s-celine", "Celine")],
    attendance_rate: 0.8,
    ...over,
  };
}

const centreSession = () =>
  makeSession("ACADEMY_OWNER", {
    academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" },
    capabilities: ["centre", "groups"],
    permissions: ["group.read", "group.manage", "student.update"],
  });

beforeEach(() => {
  vi.clearAllMocks();
  listLevels.mockResolvedValue({ levels: [level("l1", "A1", 1), level("l2", "A2", 2), level("l3", "B1", 3)] });
  renewGroup.mockResolvedValue({ group: group({ id: "g2", state: "UPCOMING" }), previous_group_id: "g1" });
  promoteGroup.mockResolvedValue({
    group: group({ id: "g3", level: "A2", level_id: "l2", state: "UPCOMING" }),
    previous_group_id: "g1",
    to_level_id: "l2",
    promoted: ["s-adam", "s-bassel"],
    not_promoted: [{ student_id: "s-celine", full_name: "Celine" }],
  });
  closeGroup.mockResolvedValue({ group: group({ status: "ARCHIVED", state: "ARCHIVED", closed_reason: "CLOSED" }) });
});

describe("CourseEndPanel — renew / promote / close", () => {
  it("renews from the day after the old end, same length, with only the ticked members", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <CourseEndPanel group={group()} onClosed={() => {}} />));

    await user.click(screen.getByTestId("course-renew"));
    const form = await screen.findByTestId("renew-form");
    // The day after 30 May, kept 90 days long like the old term.
    expect(within(form).getByTestId("term-start")).toHaveValue("2026-05-31");
    expect(within(form).getByTestId("term-end")).toHaveValue("2026-08-29");
    expect(within(form).getByTestId("term-lessons")).toHaveValue(24);
    expect(within(form).getByTestId("renew-name")).toHaveValue("English A1 — evening");

    await user.click(within(form).getByTestId("renew-members-s-celine"));
    await user.clear(within(form).getByTestId("term-lessons"));
    await user.type(within(form).getByTestId("term-lessons"), "20");
    await user.click(within(form).getByTestId("renew-submit"));

    await waitFor(() => expect(renewGroup).toHaveBeenCalledTimes(1));
    const [id, input] = renewGroup.mock.calls[0]!;
    expect(id).toBe("g1");
    expect(input).toEqual({
      start_date: "2026-05-31",
      end_date: "2026-08-29",
      lessons_planned: 20,
      name: null,
      keep_members: false,
      member_ids: ["s-adam", "s-bassel"],
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/groups/g2"));
  });

  it("keeps everyone with keep_members when nobody is unticked, and sends a changed name", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <CourseEndPanel group={group({ end_date: null, state: "RUNNING", ends_in_days: null })} onClosed={() => {}} />));

    await user.click(screen.getByTestId("course-renew"));
    const form = await screen.findByTestId("renew-form");
    expect(within(form).getByTestId("term-end")).toHaveValue("");
    await user.clear(within(form).getByTestId("renew-name"));
    await user.type(within(form).getByTestId("renew-name"), "English A1 — summer");
    await user.click(within(form).getByTestId("renew-submit"));

    await waitFor(() => expect(renewGroup).toHaveBeenCalledTimes(1));
    const input = renewGroup.mock.calls[0]![1];
    expect(input.keep_members).toBe(true);
    expect(input.member_ids).toBeUndefined();
    expect(input.name).toBe("English A1 — summer");
    expect(input.end_date).toBeNull();
  });

  it("promotes to the next level by default, with who passed, and says who stayed behind", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <CourseEndPanel group={group()} onClosed={() => {}} />));

    await user.click(screen.getByTestId("course-promote"));
    const form = await screen.findByTestId("promote-form");
    // A1 → A2 is preselected from the academy's order.
    await waitFor(() => expect(within(form).getByTestId("promote-to-level")).toHaveValue("l2"));

    await user.click(within(form).getByTestId("promote-members-s-celine"));
    await user.click(within(form).getByTestId("promote-submit"));

    await waitFor(() => expect(promoteGroup).toHaveBeenCalledTimes(1));
    const [id, input] = promoteGroup.mock.calls[0]!;
    expect(id).toBe("g1");
    expect(input).toEqual({
      to_level_id: "l2",
      start_date: "2026-05-31",
      end_date: "2026-08-29",
      lessons_planned: 24,
      member_ids: ["s-adam", "s-bassel"],
    });

    // The result stays on screen before the new course opens: who was not promoted is named.
    expect(await screen.findByTestId("promote-done")).toBeInTheDocument();
    expect(screen.getByTestId("promote-not-promoted")).toHaveTextContent("Celine");
    await user.click(screen.getByTestId("promote-open-new"));
    expect(push).toHaveBeenCalledWith("/groups/g3");
  });

  it("lets the level be chosen when the group's level has no next one", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <CourseEndPanel group={group({ level: "B1", level_id: "l3" })} onClosed={() => {}} />));

    await user.click(screen.getByTestId("course-promote"));
    const form = await screen.findByTestId("promote-form");
    expect(await within(form).findByText(forWord(ar.promote.noNext))).toBeInTheDocument();
    expect(within(form).getByTestId("promote-submit")).toBeDisabled();

    await user.selectOptions(within(form).getByTestId("promote-to-level"), "l1");
    await user.click(within(form).getByTestId("promote-submit"));
    await waitFor(() => expect(promoteGroup).toHaveBeenCalledTimes(1));
    expect(promoteGroup.mock.calls[0]![1].to_level_id).toBe("l1");
  });

  it("closes with a reason and hands the archived group back", async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    render(withAuth(centreSession(), <CourseEndPanel group={group({ state: "RUNNING", ending_soon: true, ends_in_days: 3 })} onClosed={onClosed} />));

    // Ending soon is said out loud.
    expect(screen.getByTestId("course-end-panel")).toHaveTextContent(ar.panel.endingSoon);

    await user.click(screen.getByTestId("course-close"));
    const form = await screen.findByTestId("close-form");
    await user.type(within(form).getByTestId("close-reason"), "Teacher moved abroad");
    await user.click(within(form).getByTestId("close-submit"));

    await waitFor(() => expect(closeGroup).toHaveBeenCalledWith("g1", "Teacher moved abroad"));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onClosed.mock.calls[0]![0].closed_reason).toBe("CLOSED");
  });
});
