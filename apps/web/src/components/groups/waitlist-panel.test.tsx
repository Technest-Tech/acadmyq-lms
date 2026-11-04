import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { GroupDetail, Waitlist, WaitlistEntry } from "@/lib/groups-api";
import { WaitlistPanel } from "./waitlist-panel";

/**
 * The waiting list (docs/centre-profile, Phase 2 §2): the queue in order, the "a seat is free" hint,
 * and the calls behind seat / remove / reorder / add — a registered student or a walk-in's name.
 */

const getGroupWaitlist = vi.fn();
const addToWaitlist = vi.fn();
const removeFromWaitlist = vi.fn();
const seatFromWaitlist = vi.fn();
const reorderWaitlist = vi.fn();

vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  getGroupWaitlist: (id: string) => getGroupWaitlist(id),
  addToWaitlist: (id: string, input: unknown) => addToWaitlist(id, input),
  removeFromWaitlist: (id: string, entryId: string) => removeFromWaitlist(id, entryId),
  seatFromWaitlist: (id: string, entryId: string, joinedOn: unknown) => seatFromWaitlist(id, entryId, joinedOn),
  reorderWaitlist: (id: string, ids: string[]) => reorderWaitlist(id, ids),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listStudents: () =>
    Promise.resolve({
      rows: [
        { id: "s-adam", full_name: "Adam", whatsapp_phone: null, secondary_phone: null, guardian_name: null, guardian_phone: null, is_self_guardian: true },
        { id: "s-dina", full_name: "Dina", whatsapp_phone: "+201005556666", secondary_phone: null, guardian_name: null, guardian_phone: null, is_self_guardian: true },
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    }),
}));

const ar = arMessages.courseTerm.waitlist;

function entry(id: string, position: number, over: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return { id, position, student_id: `s-${id}`, name: id, phone: null, note: null, status: "WAITING", added_by_name: null, created_at: "2026-06-01T10:00:00Z", ...over };
}

function list(entries: WaitlistEntry[], over: Partial<Waitlist> = {}): Waitlist {
  return { entries, waiting_count: entries.length, member_count: 2, capacity: 2, free_seats: 0, ...over };
}

function group(over: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: "g1",
    name: "English A1",
    specialization_id: null,
    specialization_name: null,
    level: "A1",
    level_id: "l1",
    teacher_id: "t1",
    teacher_name: "Mona",
    capacity: 2,
    member_count: 2,
    mode: "OFFLINE",
    location: "Room 2",
    meeting_url: null,
    timezone: "Africa/Cairo",
    start_date: "2026-03-01",
    end_date: null,
    status: "ACTIVE",
    state: "RUNNING",
    slots: [],
    lessons: { held: 4, cancelled: 0, upcoming: 6, overdue: 0, next_lesson_at: null },
    pricing: null,
    teacher_pay: null,
    waiting_count: 2,
    notes: null,
    effective_meeting_url: null,
    members: [
      { id: "m1", student_id: "s-adam", full_name: "Adam", guardian_name: null, joined_on: "2026-03-01", left_on: null, status: "ACTIVE", left_reason: null, student_removed: false, attendance: null, price_minor: null },
    ],
    attendance_rate: null,
    ...over,
  };
}

const centreSession = (permissions = ["group.read", "group.manage"]) =>
  makeSession("ACADEMY_OWNER", {
    academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" },
    capabilities: ["centre", "groups"],
    permissions,
  });

beforeEach(() => {
  vi.clearAllMocks();
  getGroupWaitlist.mockResolvedValue(list([entry("celine", 1, { note: "Called twice" }), entry("yusuf", 2, { student_id: null, phone: "0100 123 4567" })]));
});

describe("WaitlistPanel — the queue at a full group's door", () => {
  it("lists the queue in order, marks a walk-in, and hides the seat hint while the group is full", async () => {
    render(withAuth(centreSession(), <WaitlistPanel group={group()} onGroupChanged={() => {}} />));

    const entries = await screen.findByTestId("waitlist-entries");
    const rows = within(entries).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent("celine");
    expect(rows[0]).toHaveTextContent("Called twice");
    expect(rows[1]).toHaveTextContent("yusuf");
    expect(rows[1]).toHaveTextContent(ar.walkInTag);
    expect(rows[1]).toHaveTextContent("0100 123 4567");
    // A walk-in cannot be seated until registered.
    expect(screen.getByTestId("waitlist-seat-yusuf")).toBeDisabled();
    expect(screen.queryByTestId("waitlist-free-seats")).toBeNull();
    expect(screen.getByTestId("waitlist-up-celine")).toBeDisabled();
    expect(screen.getByTestId("waitlist-down-yusuf")).toBeDisabled();
  });

  it("says a seat is free and seats the next name through the members path, handing the group back", async () => {
    getGroupWaitlist.mockResolvedValue(list([entry("celine", 1)], { member_count: 1, free_seats: 1 }));
    const seated = group({ member_count: 2, waiting_count: 0 });
    seatFromWaitlist.mockResolvedValue({ ...list([], { member_count: 2, free_seats: 0 }), group: seated });
    const onGroupChanged = vi.fn();
    const user = userEvent.setup();
    render(withAuth(centreSession(), <WaitlistPanel group={group({ member_count: 1 })} onGroupChanged={onGroupChanged} />));

    expect(await screen.findByTestId("waitlist-free-seats")).toBeInTheDocument();
    await user.click(screen.getByTestId("waitlist-seat-celine"));

    await waitFor(() => expect(seatFromWaitlist).toHaveBeenCalledTimes(1));
    const [id, entryId, joinedOn] = seatFromWaitlist.mock.calls[0]!;
    expect(id).toBe("g1");
    expect(entryId).toBe("celine");
    expect(joinedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(onGroupChanged).toHaveBeenCalledWith(seated);
    expect(await screen.findByText(ar.empty)).toBeInTheDocument();
  });

  it("reorders by swapping with the neighbour and sends the whole queue; removes one by id", async () => {
    reorderWaitlist.mockResolvedValue(list([entry("yusuf", 1, { student_id: null }), entry("celine", 2)]));
    removeFromWaitlist.mockResolvedValue(list([entry("celine", 1)]));
    const user = userEvent.setup();
    render(withAuth(centreSession(), <WaitlistPanel group={group()} onGroupChanged={() => {}} />));

    await screen.findByTestId("waitlist-entries");
    await user.click(screen.getByTestId("waitlist-down-celine"));
    await waitFor(() => expect(reorderWaitlist).toHaveBeenCalledWith("g1", ["yusuf", "celine"]));
    const rows = within(await screen.findByTestId("waitlist-entries")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("yusuf");

    await user.click(screen.getByTestId("waitlist-remove-yusuf"));
    await waitFor(() => expect(removeFromWaitlist).toHaveBeenCalledWith("g1", "yusuf"));
    expect(await screen.findByText(ar.removed)).toBeInTheDocument();
  });

  it("adds a registered student, or a walk-in by name and phone", async () => {
    addToWaitlist.mockResolvedValue({ ...list([entry("celine", 1), entry("dina", 2)]), entry_id: "dina" });
    const user = userEvent.setup();
    render(withAuth(centreSession(), <WaitlistPanel group={group()} onGroupChanged={() => {}} />));
    await screen.findByTestId("waitlist-entries");

    await user.click(screen.getByTestId("waitlist-add"));
    const form = await screen.findByTestId("waitlist-add-form");
    // Adam is already in the group, so only Dina is offered.
    expect(await within(form).findByTestId("pick-s-dina")).toBeInTheDocument();
    expect(within(form).queryByTestId("pick-s-adam")).toBeNull();
    await user.click(within(form).getByTestId("pick-s-dina"));
    await user.type(within(form).getByTestId("waitlist-note"), "Evenings");
    await user.click(within(form).getByTestId("waitlist-save"));

    await waitFor(() => expect(addToWaitlist).toHaveBeenCalledWith("g1", { student_id: "s-dina", note: "Evenings" }));
    expect(await screen.findByText(ar.added)).toBeInTheDocument();

    // A walk-in: name and phone.
    await user.click(screen.getByTestId("waitlist-add"));
    const form2 = await screen.findByTestId("waitlist-add-form");
    await user.click(within(form2).getByTestId("waitlist-mode-walkIn"));
    await user.click(within(form2).getByTestId("waitlist-save"));
    expect(await within(form2).findByText(ar.errors.name)).toBeInTheDocument();
    await user.type(within(form2).getByTestId("waitlist-name"), "Yusuf");
    await user.type(within(form2).getByTestId("waitlist-phone"), "0100 123 4567");
    await user.click(within(form2).getByTestId("waitlist-save"));
    await waitFor(() => expect(addToWaitlist).toHaveBeenLastCalledWith("g1", { name: "Yusuf", phone: "0100 123 4567", note: null }));
  });

  it("is read-only without group.manage", async () => {
    render(withAuth(centreSession(["group.read"]), <WaitlistPanel group={group()} onGroupChanged={() => {}} />));
    await screen.findByTestId("waitlist-entries");
    expect(screen.queryByTestId("waitlist-add")).toBeNull();
    expect(screen.queryByTestId("waitlist-seat-celine")).toBeNull();
  });
});
