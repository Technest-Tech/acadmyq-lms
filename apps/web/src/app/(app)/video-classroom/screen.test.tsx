import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../messages/en.json";
import { VideoClassroomScreen } from "./screen";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listVideoRooms: vi.fn(),
  listVideoRecordings: vi.fn(),
  getRoomPresence: vi.fn(),
  createVideoRoom: vi.fn(),
  updateVideoRoom: vi.fn(),
  deleteVideoRoom: vi.fn(),
}));

import * as api from "@/lib/api";

const ROOM_CAPS = [
  "room.read",
  "room.create",
  "room.join",
  "room.manage",
  "recording.view",
];

function renderScreen(permissions: string[] = ROOM_CAPS) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider
        value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}
      >
        <VideoClassroomScreen />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("VideoClassroomScreen (Phase 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listVideoRooms).mockResolvedValue({
      rooms: [
        {
          id: "r1",
          name: "Halaqa 1",
          teacher_id: null,
          status: "ACTIVE",
          join_token: "halaqa-1-k3p9x",
          host_token: "halaqa-1-h7m2q",
          academy_subdomain: "noor",
          created_at: "2026-06-01T10:00:00Z",
        },
        {
          id: "r2",
          name: "Halaqa 2",
          teacher_id: null,
          status: "ARCHIVED",
          join_token: "halaqa-2-b8n4z",
          created_at: "2026-06-02T10:00:00Z",
        },
      ],
    });
    vi.mocked(api.listVideoRecordings).mockResolvedValue({ recordings: [] });
    vi.mocked(api.getRoomPresence).mockResolvedValue({ presence: {} });
    vi.mocked(api.createVideoRoom).mockResolvedValue({ roomId: "r3" });
  });

  // AC-V2.1: the academy's rooms render.
  it("lists the academy's rooms", async () => {
    renderScreen();
    expect(await screen.findByText("Halaqa 1")).toBeInTheDocument();
    expect(screen.getByText("Halaqa 2")).toBeInTheDocument();
    expect(screen.getAllByTestId("video-room-card")).toHaveLength(2);
  });

  // Live presence: occupied rooms show who's in + their camera/mic/screen state.
  it("shows live occupancy on a room card", async () => {
    vi.mocked(api.getRoomPresence).mockResolvedValue({
      presence: {
        r1: {
          count: 2,
          monitors: 0,
          camerasOn: 1,
          micsOn: 2,
          screenSharing: 1,
          participants: [
            { identity: "h1", name: "Ustadh Ali", role: "host", camera: true, mic: true, screen: true, joinedAt: 1 },
            { identity: "g1", name: "Sara", role: "guest", camera: false, mic: true, screen: false, joinedAt: 2 },
          ],
        },
      },
    });
    renderScreen();
    await screen.findByText("Halaqa 1");

    // The occupied card carries a live badge, the occupant names, and the "in call now" hero stat.
    expect(await screen.findByTestId("room-live-badge")).toBeInTheDocument();
    expect(screen.getByText("Ustadh Ali")).toBeInTheDocument();
    expect(screen.getByText("Sara")).toBeInTheDocument();
    expect(screen.getByText("In call now")).toBeInTheDocument();
    // The empty room (Halaqa 2) shows no live block.
    expect(screen.getAllByTestId("room-presence")).toHaveLength(1);
  });

  // S2: the private host link copy is room.manage-only.
  it("shows the host link copy for a manager, hides it otherwise", async () => {
    renderScreen();
    await screen.findByText("Halaqa 1");
    expect(screen.getByTestId("copy-host-link-r1")).toBeInTheDocument();
  });

  it("hides the host link copy without room.manage", async () => {
    renderScreen(["room.read"]);
    await screen.findByText("Halaqa 1");
    expect(screen.queryByTestId("copy-host-link-r1")).not.toBeInTheDocument();
  });

  // Tabs: Rooms ⇄ Recordings (recordings tab only for recording.view holders).
  it("switches between the Rooms and Recordings tabs", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Halaqa 1");
    expect(screen.getAllByTestId("video-room-card")).toHaveLength(2);

    await user.click(screen.getByTestId("video-tab-recordings"));
    expect(screen.queryAllByTestId("video-room-card")).toHaveLength(0);
    expect(
      screen.getByText(enMessages.videoClassroom.recordingsEmpty),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("video-tab-rooms"));
    expect(screen.getAllByTestId("video-room-card")).toHaveLength(2);
  });

  it("hides the recordings tab without recording.view", async () => {
    renderScreen(["room.read"]);
    await screen.findByText("Halaqa 1");
    expect(screen.queryByTestId("video-tab-recordings")).not.toBeInTheDocument();
  });

  // Client-side permission gate (server still enforces).
  it("blocks a user without room.read", () => {
    renderScreen([]);
    expect(
      screen.getByText(enMessages.videoClassroom.noPermission),
    ).toBeInTheDocument();
    expect(api.listVideoRooms).not.toHaveBeenCalled();
  });

  // AC-V2.1: create a room through the modal.
  it("creates a room through the modal", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Halaqa 1");

    await user.click(
      screen.getByRole("button", { name: enMessages.videoClassroom.createRoom }),
    );

    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(enMessages.videoClassroom.nameLabel),
      "New Room",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: enMessages.videoClassroom.create,
      }),
    );

    await waitFor(() =>
      expect(api.createVideoRoom).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New Room" }),
      ),
    );
  });
});
