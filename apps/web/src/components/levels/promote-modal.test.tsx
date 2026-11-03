import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { GroupRow } from "@/lib/groups-api";
import type { Level } from "@/lib/levels-api";
import { PromoteModal } from "./promote-modal";

/**
 * "ترقية" (docs/centre-profile, Phase 2.1): the level picked narrows the groups to that level, and
 * the submit sends exactly what the server expects — level, group, day, note.
 */

const listLevels = vi.fn();
const promoteStudent = vi.fn();
const listGroups = vi.fn();

vi.mock("@/lib/levels-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/levels-api")>()),
  listLevels: () => listLevels(),
  promoteStudent: (id: string, input: unknown) => promoteStudent(id, input),
}));

vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listGroups: (p: unknown) => listGroups(p),
}));

const ar = arMessages.levels;

const level = (id: string, name: string, sort_order: number): Level => ({ id, name, sort_order, is_active: true, students_count: 0, groups_count: 0 });

const group = (over: Partial<GroupRow>): GroupRow => ({
  id: "g1",
  name: "A2 evening",
  specialization_id: null,
  specialization_name: null,
  level: "A2",
  level_id: "l2",
  teacher_id: "t1",
  teacher_name: "Mona",
  capacity: 10,
  member_count: 4,
  mode: "OFFLINE",
  location: "Room 1",
  meeting_url: null,
  timezone: "Africa/Cairo",
  start_date: "2026-06-01",
  end_date: null,
  status: "ACTIVE",
  state: "RUNNING",
  slots: [],
  lessons: { held: 3, cancelled: 0, upcoming: 5, overdue: 0, next_lesson_at: null },
  pricing: null,
  teacher_pay: null,
  ...over,
});

const centreSession = () =>
  makeSession("ACADEMY_OWNER", {
    academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" },
    capabilities: ["centre", "groups", "accounting"],
  });

beforeEach(() => {
  vi.clearAllMocks();
  listLevels.mockResolvedValue({ levels: [level("l1", "A1", 1), level("l2", "A2", 2), level("l3", "B1", 3)] });
  listGroups.mockResolvedValue({
    groups: [
      group({ id: "g1", name: "A2 evening", level_id: "l2" }),
      group({ id: "g2", name: "A2 morning", level_id: "l2", teacher_name: null, capacity: null }),
      group({ id: "g3", name: "B1 evening", level_id: "l3", level: "B1" }),
    ],
    counts: { UPCOMING: 0, RUNNING: 3, FINISHED: 0, ARCHIVED: 0 },
  });
  promoteStudent.mockResolvedValue({
    ok: true,
    promotion: { history_id: "h1", from_level_id: "l1", to_level_id: "l2", to_level_name: "A2", from_group_id: null, to_group_id: "g1", effective_on: "2026-06-20" },
    history: [],
  });
});

describe("PromoteModal", () => {
  it("offers only the groups of the level picked, then sends level, group, day and note", async () => {
    const user = userEvent.setup();
    const onPromoted = vi.fn();
    const onClose = vi.fn();
    render(
      withAuth(
        centreSession(),
        <PromoteModal open onClose={onClose} studentId="s1" studentName="Adam" currentLevelId="l1" currentLevelName="A1" onPromoted={onPromoted} />,
      ),
    );

    expect(await screen.findByText(ar.promote.title)).toBeInTheDocument();
    expect(screen.getByText(ar.promote.current).nextElementSibling).toHaveTextContent("A1");
    // No level picked yet: no group picker, and nothing to submit.
    expect(screen.queryByTestId("promote-group")).not.toBeInTheDocument();
    expect(screen.getByTestId("promote-submit")).toBeDisabled();

    const levelSelect = screen.getByTestId("promote-level");
    await waitFor(() => expect(within(levelSelect).getAllByRole("option")).toHaveLength(4));
    await user.selectOptions(levelSelect, "l2");

    const groupSelect = await screen.findByTestId("promote-group");
    await waitFor(() => expect(within(groupSelect).getAllByRole("option")).toHaveLength(3));
    expect(within(groupSelect).getByRole("option", { name: /A2 evening · Mona \(4\/10\)/ })).toBeInTheDocument();
    expect(within(groupSelect).queryByRole("option", { name: /B1 evening/ })).not.toBeInTheDocument();
    await user.selectOptions(groupSelect, "g1");

    const date = screen.getByTestId("promote-date");
    await user.clear(date);
    await user.type(date, "2026-06-20");
    await user.type(screen.getByRole("textbox", { name: ar.promote.note }), "  Passed the test ");

    await user.click(screen.getByTestId("promote-submit"));

    await waitFor(() => expect(promoteStudent).toHaveBeenCalledTimes(1));
    expect(promoteStudent).toHaveBeenCalledWith("s1", {
      to_level_id: "l2",
      to_group_id: "g1",
      effective_on: "2026-06-20",
      note: "Passed the test",
    });
    expect(onPromoted).toHaveBeenCalledWith(expect.objectContaining({ promotion: expect.objectContaining({ to_level_name: "A2" }) }));
    expect(onClose).toHaveBeenCalled();
  });

  it("promotes by level alone when no group is chosen, and keeps the dialog open on a refusal", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api");
    promoteStudent.mockRejectedValueOnce(new ApiError(422, "المجموعة مكتملة."));
    const onClose = vi.fn();
    render(
      withAuth(
        centreSession(),
        <PromoteModal open onClose={onClose} studentId="s1" studentName="Adam" currentLevelId={null} currentLevelName={null} onPromoted={vi.fn()} />,
      ),
    );

    expect(await screen.findByText(ar.promote.noCurrent)).toBeInTheDocument();
    const levelSelect = screen.getByTestId("promote-level");
    await waitFor(() => expect(within(levelSelect).getAllByRole("option")).toHaveLength(4));
    await user.selectOptions(levelSelect, "l3");
    // B1 has one running group; leaving the picker on "keep groups" sends no group.
    expect(await screen.findByTestId("promote-group")).toHaveValue("");

    await user.click(screen.getByTestId("promote-submit"));

    expect(await screen.findByText("المجموعة مكتملة.")).toBeInTheDocument();
    expect(promoteStudent).toHaveBeenCalledWith("s1", expect.objectContaining({ to_level_id: "l3", to_group_id: null, note: null }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
