import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { forWord } from "@/test/level-word";
import type { Level } from "@/lib/levels-api";
import { LevelsManager, LevelsSwitch } from "./levels-manager";

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

const updateAcademyLevelLabel = vi.fn();
const updateAcademyLevelsEnabled = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  updateAcademyLevelLabel: (label: unknown) => updateAcademyLevelLabel(label),
  updateAcademyLevelsEnabled: (on: unknown) => updateAcademyLevelsEnabled(on),
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
  updateAcademyLevelLabel.mockResolvedValue({ ok: true });
  updateAcademyLevelsEnabled.mockResolvedValue({ ok: true });
});

const quranSession = (levelsEnabled: boolean) =>
  makeSession("ACADEMY_OWNER", {
    academy: { name: "EnglishSpirit", displayName: "EnglishSpirit", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "QURAN", levelsEnabled },
    capabilities: ["invoicing", "packages"],
  });

describe("LevelsSwitch (a Quran academy's own choice)", () => {
  it("starts off with no list, and switching on saves and shows the list", async () => {
    const user = userEvent.setup();
    render(withAuth(quranSession(false), <LevelsSwitch />));

    const toggle = screen.getByTestId("levels-enabled");
    expect(toggle).not.toBeChecked();
    expect(screen.queryByTestId("levels-manager")).toBeNull();
    expect(listLevels).not.toHaveBeenCalled();

    await user.click(toggle);
    await waitFor(() => expect(updateAcademyLevelsEnabled).toHaveBeenCalledWith(true));
    expect(await screen.findByTestId("levels-list")).toBeInTheDocument();
  });

  it("shows the list straight away when the academy already switched it on", async () => {
    render(withAuth(quranSession(true), <LevelsSwitch />));
    expect(screen.getByTestId("levels-enabled")).toBeChecked();
    expect(await screen.findByTestId("levels-list")).toBeInTheDocument();
  });
});

describe("LevelsManager", () => {
  it("lists the levels in order, with who stands at each and which are off", async () => {
    render(withAuth(centreSession(), <LevelsManager />));

    expect(await screen.findByText(forWord(ar.cardTitle))).toBeInTheDocument();
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

  it("names the classification in the academy's own word, and saving a new word re-reads the session", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => {});
    render(withAuth(centreSession(), <LevelsManager />, { refresh }));
    await screen.findByTestId("levels-list");

    expect(screen.getByTestId("level-word-LEVEL")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: forWord(ar.cardTitle, "LEVEL") })).toBeInTheDocument();

    await user.click(screen.getByTestId("level-word-GRADE"));

    await waitFor(() => expect(updateAcademyLevelLabel).toHaveBeenCalledWith("GRADE"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("level-word-GRADE")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: forWord(ar.cardTitle, "GRADE") })).toBeInTheDocument();
  });

  it("goes back to the word it had when the save fails, and says so", async () => {
    const user = userEvent.setup();
    updateAcademyLevelLabel.mockRejectedValueOnce(new Error("nope"));
    render(withAuth(centreSession(), <LevelsManager />));
    await screen.findByTestId("levels-list");

    await user.click(screen.getByTestId("level-word-YEAR"));

    expect(await screen.findByText(ar.word.failed)).toBeInTheDocument();
    expect(screen.getByTestId("level-word-LEVEL")).toHaveAttribute("aria-checked", "true");
  });

  it("reads a grade-keeping academy's card in its word", async () => {
    const session = centreSession();
    session.academy = { ...session.academy!, levelLabel: "GRADE" };
    render(withAuth(session, <LevelsManager />));
    await screen.findByTestId("levels-list");

    expect(screen.getByRole("heading", { name: "الصفوف الدراسية" })).toBeInTheDocument();
    expect(screen.getByTestId("level-word-GRADE")).toHaveAttribute("aria-checked", "true");
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
