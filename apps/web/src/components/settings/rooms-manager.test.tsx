import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { Room } from "@/lib/rooms-api";
import { RoomsManager } from "./rooms-manager";
import { SettingsManager } from "./settings-manager";

/**
 * Settings → rooms (docs/centre-profile/02-COHERENCE-AUDIT §3): the list in order with its seats,
 * adding one with a capacity, editing the seats, the server's refusal to delete a room in use — and
 * the card is a centre's only.
 */

const listRooms = vi.fn();
const createRoom = vi.fn();
const updateRoom = vi.fn();
const deleteRoom = vi.fn();

vi.mock("@/lib/rooms-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rooms-api")>()),
  listRooms: () => listRooms(),
  createRoom: (input: unknown) => createRoom(input),
  updateRoom: (id: string, patch: unknown) => updateRoom(id, patch),
  deleteRoom: (id: string) => deleteRoom(id),
}));
vi.mock("@/lib/levels-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/levels-api")>()),
  listLevels: () => Promise.resolve({ levels: [] }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listSpecializations: () => Promise.resolve({ specializations: [] }),
}));

const ar = arMessages.rooms;

const room = (over: Partial<Room>): Room => ({
  id: "r1",
  name: "Room 1",
  capacity: null,
  position: 1,
  is_active: true,
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
  listRooms.mockResolvedValue({
    rooms: [
      room({ id: "r1", name: "Room 1", position: 1, capacity: 12, groups_count: 2 }),
      room({ id: "r2", name: "Lab", position: 2 }),
      room({ id: "r3", name: "Old hall", position: 3, is_active: false }),
    ],
  });
  createRoom.mockResolvedValue({ roomId: "r4" });
  updateRoom.mockResolvedValue({ ok: true });
  deleteRoom.mockResolvedValue({ ok: true });
});

describe("RoomsManager", () => {
  it("lists the rooms in order, with their seats, the groups in each, and which are off", async () => {
    render(withAuth(centreSession(), <RoomsManager />));

    expect(await screen.findByText(ar.cardTitle)).toBeInTheDocument();
    const items = within(screen.getByTestId("rooms-list")).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-room"))).toEqual(["r1", "r2", "r3"]);
    expect(within(items[0]!).getByText("12 مقعد · 2 مجموعة")).toBeInTheDocument();
    expect(within(items[2]!).getByText(ar.inactive)).toBeInTheDocument();
  });

  it("adds a room with its seats, and without", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <RoomsManager />));
    await screen.findByTestId("rooms-list");

    await user.type(screen.getByTestId("new-room-name"), "  Room 4 ");
    await user.type(screen.getByTestId("new-room-capacity"), "20");
    await user.click(screen.getByTestId("add-room"));
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith({ name: "Room 4", capacity: 20 }));

    await user.type(screen.getByTestId("new-room-name"), "Studio");
    await user.click(screen.getByTestId("add-room"));
    await waitFor(() => expect(createRoom).toHaveBeenLastCalledWith({ name: "Studio" }));
    expect(listRooms).toHaveBeenCalledTimes(3);
  });

  it("edits only what changed: the seats, or clearing them", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <RoomsManager />));
    await screen.findByTestId("rooms-list");

    await user.click(screen.getByTestId("room-edit-r1"));
    await user.clear(screen.getByTestId("edit-room-capacity"));
    await user.click(screen.getByTestId("save-room"));
    await waitFor(() => expect(updateRoom).toHaveBeenCalledWith("r1", { capacity: null }));
  });

  it("moves a room up by swapping positions with its neighbour", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <RoomsManager />));
    await screen.findByTestId("rooms-list");

    expect(screen.getByTestId("room-up-r1")).toBeDisabled();
    await user.click(screen.getByTestId("room-up-r2"));

    await waitFor(() => expect(updateRoom).toHaveBeenCalledTimes(2));
    expect(updateRoom).toHaveBeenNthCalledWith(1, "r2", { position: 1 });
    expect(updateRoom).toHaveBeenNthCalledWith(2, "r1", { position: 2 });
  });

  it("shows the server's reason when a room in use cannot be deleted", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/api");
    deleteRoom.mockRejectedValueOnce(new ApiError(422, "هذه القاعة مستخدمة (2 مجموعة) — أوقفها بدلًا من حذفها."));
    render(withAuth(centreSession(), <RoomsManager />));
    const list = await screen.findByTestId("rooms-list");

    const first = within(list).getAllByRole("listitem")[0]!;
    await user.click(within(first).getByRole("button", { name: ar.delete }));
    await user.click(screen.getByTestId("confirm-delete-room"));

    expect(await screen.findByText("هذه القاعة مستخدمة (2 مجموعة) — أوقفها بدلًا من حذفها.")).toBeInTheDocument();
    expect(deleteRoom).toHaveBeenCalledWith("r1");
  });
});

describe("Settings → the rooms card", () => {
  it("sits beside the levels for a centre", async () => {
    render(withAuth(centreSession(), <SettingsManager />));
    expect(await screen.findByTestId("rooms-manager")).toBeInTheDocument();
    expect(screen.getByTestId("levels-manager")).toBeInTheDocument();
  });

  it("is not there for an academy without the centre switch", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER"), <SettingsManager />));
    await waitFor(() => expect(screen.getByTestId("settings-tab-courses")).toBeInTheDocument());
    expect(screen.queryByTestId("rooms-manager")).toBeNull();
    expect(listRooms).not.toHaveBeenCalled();
  });
});
