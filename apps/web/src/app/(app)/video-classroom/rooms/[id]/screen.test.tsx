import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../../messages/en.json";
import { RoomLogsScreen } from "./screen";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getRoomLogs: vi.fn(),
}));

import * as api from "@/lib/api";

const t = enMessages.videoClassroom;

function renderScreen(permissions: string[] = ["room.read"]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}>
        <RoomLogsScreen roomId="r1" />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

const LOGS: api.RoomLogs = {
  room: { id: "r1", name: "Halaqa 1", status: "ACTIVE", created_at: "2026-06-01T10:00:00Z" },
  sessions: [
    {
      id: "s1",
      identity: "guest-abc",
      display_name: "Sara",
      user_id: null,
      user_name: null,
      role: "PARTICIPANT",
      joined_at: "2026-06-02T10:00:00Z",
      left_at: null,
      duration_s: null,
      ongoing: true,
    },
    {
      id: "s2",
      identity: "host-xyz",
      display_name: "Ustadh",
      user_id: "u9",
      user_name: "Ustadh Ali",
      role: "HOST",
      joined_at: "2026-06-01T10:00:00Z",
      left_at: "2026-06-01T10:30:00Z",
      duration_s: 1800,
      ongoing: false,
    },
  ],
  events: [
    {
      id: "e1",
      action: "video_room.update",
      actor_user_id: "u9",
      actor_name: "Ustadh Ali",
      actor_role: "ACADEMY_OWNER",
      after: null,
      created_at: "2026-06-02T09:00:00Z",
    },
  ],
  stats: { total_sessions: 2, unique_participants: 2, total_seconds: 1800, last_access: "2026-06-02T10:00:00Z" },
  truncated: false,
};

describe("RoomLogsScreen (08-ROOM-ACCESS §15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getRoomLogs).mockResolvedValue(LOGS);
  });

  it("blocks a user without room.read", () => {
    renderScreen([]);
    expect(screen.getByText(t.noPermission)).toBeInTheDocument();
    expect(api.getRoomLogs).not.toHaveBeenCalled();
  });

  it("renders the room name, sessions and an ongoing pill", async () => {
    renderScreen();
    expect(await screen.findByText("Halaqa 1")).toBeInTheDocument();
    // Both participants render; the live one shows the Ongoing pill.
    expect(screen.getByText("Sara")).toBeInTheDocument();
    expect(screen.getByText("Ustadh")).toBeInTheDocument();
    expect(screen.getByText(t.ongoing)).toBeInTheDocument();
    expect(screen.getAllByTestId("session-row")).toHaveLength(2);
  });

  it("renders the activity timeline with a humanized action label", async () => {
    renderScreen();
    await screen.findByText("Halaqa 1");
    expect(screen.getByText(t.events.update)).toBeInTheDocument();
    expect(screen.getAllByTestId("event-row")).toHaveLength(1);
  });

  it("surfaces an error when the log fails to load", async () => {
    vi.mocked(api.getRoomLogs).mockRejectedValue(new Error("boom"));
    renderScreen();
    expect(await screen.findByText(t.logsError)).toBeInTheDocument();
  });
});
