import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../messages/en.json";
import { AdminVideoAcademyScreen } from "./screen";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getVideoAcademy: vi.fn(),
  getVideoPlans: vi.fn(),
  setVideoAccess: vi.fn(),
  getVideoAcademyRoomLog: vi.fn(),
}));

import * as api from "@/lib/api";

const V = enMessages.adminVideo;

const DETAIL = {
  academy: {
    id: "a1",
    name: "Noor Academy",
    currency: "EGP",
    subdomain: "noor",
    created_at: "2026-01-01T00:00:00Z",
    plan_id: "p1",
    plan_name: "Pro",
    plan_code: "PRO",
    video_plan_id: null,
    video_plan_name: null,
    video_access: "ENABLED" as const,
    video_trial_ends_at: null,
    base_entitled: true,
    video_status: "ENABLED" as const,
    video_limits: { maxRooms: 10, recordingAllowed: 1 },
    video_overrides: null,
  },
  subscription: {
    status: "ACTIVE",
    is_trial: false,
    trial_start: null,
    trial_end: null,
    current_period_start: "2026-01-01T00:00:00Z",
    current_period_end: "2026-02-01T00:00:00Z",
    currency: "EGP",
    plan_name: "Pro",
  },
  stats: { active_rooms: 1, total_rooms: 2, recordings_count: 3, storage_bytes: 2_000_000_000, recording_seconds: 3600, active_recordings: 0, participant_sessions: 12 },
  rooms: [
    { id: "r1", name: "Halaqa 1", status: "ACTIVE" as const, created_at: "2026-01-02T00:00:00Z", deleted_at: null, recordings_count: 2, storage_bytes: 1_000_000_000, active_recordings: 0, participant_sessions: 8, last_activity: "2026-01-05T00:00:00Z" },
  ],
};

function renderScreen(permissions: string[] = ["platform.manage"]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
        <AdminVideoAcademyScreen academyId="a1" />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("AdminVideoAcademyScreen (Tier 2 detail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getVideoAcademy).mockResolvedValue(DETAIL);
    vi.mocked(api.getVideoPlans).mockResolvedValue({ plans: [{ id: "vt1", code: "VID", name: "Video Tier", grants_video: true, options: { maxRooms: 5 }, video_capable: true }] });
    vi.mocked(api.setVideoAccess).mockResolvedValue({ ok: true, academy: DETAIL.academy });
    vi.mocked(api.getVideoAcademyRoomLog).mockResolvedValue({
      room: { id: "r1", academy_id: "a1", name: "Halaqa 1", status: "ACTIVE", created_at: "2026-01-02T00:00:00Z" },
      sessions: [{ id: "s1", identity: "guest-x", display_name: "Sara", user_id: null, user_name: null, role: "PARTICIPANT", joined_at: "2026-01-05T10:00:00Z", left_at: "2026-01-05T10:30:00Z", duration_s: 1800, ongoing: false }],
      events: [{ id: "e1", action: "video_recording.start", actor_user_id: null, actor_name: null, actor_role: "HOST_LINK", after: null, created_at: "2026-01-05T10:05:00Z" }],
    });
  });

  it("renders academy status, stats and rooms", async () => {
    renderScreen();
    expect(await screen.findByText("Noor Academy")).toBeInTheDocument();
    expect(screen.getByText(V.status.ENABLED)).toBeInTheDocument();
    expect(screen.getByText("Halaqa 1")).toBeInTheDocument();
    // The "deactivate" control is offered for an enabled academy.
    expect(screen.getByTestId("deactivate")).toBeInTheDocument();
  });

  it("deactivates video via the access control", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Noor Academy");
    await user.click(screen.getByTestId("deactivate"));
    await waitFor(() => expect(api.setVideoAccess).toHaveBeenCalledWith("a1", expect.objectContaining({ action: "disable" })));
  });

  it("changes the video tier", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Noor Academy");
    await user.selectOptions(screen.getByTestId("tier-select"), "vt1");
    await waitFor(() => expect(api.setVideoAccess).toHaveBeenCalledWith("a1", expect.objectContaining({ action: "set_tier", video_plan_id: "vt1" })));
  });

  it("opens a room access-log modal", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Halaqa 1");
    await user.click(screen.getByTestId("room-logs-r1"));
    await waitFor(() => expect(api.getVideoAcademyRoomLog).toHaveBeenCalledWith("a1", "r1"));
    expect(await screen.findByText("Sara")).toBeInTheDocument();
    expect(screen.getByText("video_recording.start")).toBeInTheDocument();
  });

  it("blocks a user without platform.manage", () => {
    renderScreen([]);
    expect(screen.getByText(V.noPermission)).toBeInTheDocument();
    expect(api.getVideoAcademy).not.toHaveBeenCalled();
  });
});
