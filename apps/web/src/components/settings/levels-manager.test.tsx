import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { Level } from "@/lib/levels-api";
import { LevelsManager } from "./levels-manager";

/**
 * Settings → levels / grades (docs/centre-profile, Phase 2.1): the list in order, adding one,
 * moving one up (two position writes), and the server's refusal to delete a level in use.
 */

const listLevels = vi.fn();
const createLevel = vi.fn();
const updateLevel = vi.fn();
const deleteLevel = vi.fn();

vi.mock("@/lib/levels-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/levels-api")>()),
  listLevels: () => listLevels(),
  createLevel: (input: unknown) => createLevel(input),
  updateLevel: (id: string, patch: unknown) => updateLevel(id, patch),
  deleteLevel: (id: string) => deleteLevel(id),
}));

const ar = arMessages.levels;

const level = (over: Partial<Level>): Level => ({
  id: "l1",
  name: "A1",
  sort_order: 1,
  is_active: true,
  students_count: 0,
  groups_count: 0,
  ...over,
});

const centreSession = () =>
  makeSession("ACADEMY_OWNER", {
    academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" },
    capabilities: ["centre", "groups", "accounting"],
  });

beforeEach(() => {
  vi.clearAllMocks();
  listLevels.mockResolvedValue({
    levels: [
      level({ id: "l1", name: "A1", sort_order: 1, students_count: 3, groups_count: 1 }),
      level({ id: "l2", name: "A2", sort_order: 2 }),
      level({ id: "l3", name: "B1", sort_order: 3, is_active: false }),
    ],
  });
  createLevel.mockResolvedValue({ levelId: "l4" });
  updateLevel.mockResolvedValue({ ok: true });
  deleteLevel.mockResolvedValue({ ok: true });
});

describe("LevelsManager", () => {
  it("lists the levels in order, with who stands at each and which are off", async () => {
    render(withAuth(centreSession(), <LevelsManager />));

    expect(await screen.findByText(ar.cardTitle)).toBeInTheDocument();
    const items = within(screen.getByTestId("levels-list")).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-level"))).toEqual(["l1", "l2", "l3"]);
    expect(within(items[0]!).getByText("3 طالب · 1 مجموعة")).toBeInTheDocument();
    expect(within(items[2]!).getByText(ar.inactive)).toBeInTheDocument();
  });

  it("adds a level by name and re-reads the list", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <LevelsManager />));
    await screen.findByTestId("levels-list");

    await user.type(screen.getByTestId("new-level-name"), "  B2 ");
    await user.click(screen.getByTestId("add-level"));

    await waitFor(() => expect(createLevel).toHaveBeenCalledWith({ name: "B2" }));
    expect(listLevels).toHaveBeenCalledTimes(2);
  });

  it("moves a level up by swapping positions with its neighbour", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <LevelsManager />));
    await screen.findByTestId("levels-list");

    expect(screen.getByTestId("level-up-l1")).toBeDisabled();
    await user.click(screen.getByTestId("level-up-l2"));

    await waitFor(() => expect(updateLevel).toHaveBeenCalledTimes(2));
    expect(updateLevel).toHaveBeenNthCalledWith(1, "l2", { sort_order: 1 });
    expect(updateLevel).toHaveBeenNthCalledWith(2, "l1", { sort_order: 2 });
  });

  it("shows the server's reason when a level in use cannot be deleted", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api");
    deleteLevel.mockRejectedValueOnce(new ApiError(422, "هذا المستوى مستخدم — أوقفه بدلًا من حذفه."));
    render(withAuth(centreSession(), <LevelsManager />));
    const list = await screen.findByTestId("levels-list");

    const first = within(list).getAllByRole("listitem")[0]!;
    await user.click(within(first).getByRole("button", { name: ar.delete }));
    await user.click(screen.getByTestId("confirm-delete-level"));

    expect(await screen.findByText("هذا المستوى مستخدم — أوقفه بدلًا من حذفه.")).toBeInTheDocument();
    expect(deleteLevel).toHaveBeenCalledWith("l1");
  });
});
