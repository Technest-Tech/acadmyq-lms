import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../messages/en.json";
import { AdminVideoScreen } from "./screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getVideoUsage: vi.fn(),
  getVideoCompliance: vi.fn(),
  getVideoHealth: vi.fn(),
}));

import * as api from "@/lib/api";

const V = enMessages.adminVideo;

function renderScreen(permissions: string[] = ["platform.manage"]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
        <AdminVideoScreen />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("AdminVideoScreen (Tier 1 oversight)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getVideoUsage).mockResolvedValue({
      academies: [
        {
          academy_id: "a1",
          academy_name: "Noor Academy",
          currency: "EGP",
          plan_name: "Pro",
          plan_code: "PRO",
          video_plan_name: null,
          video_access: null,
          video_trial_ends_at: null,
          video_status: "PLAN",
          video_enabled: true,
          active_rooms: 2,
          live_rooms: 2,
          max_rooms: 5,
          recordings_count: 3,
          storage_bytes: 2_000_000_000,
          recording_seconds: 3600,
          active_recordings: 1,
          participant_sessions: 40,
        },
        {
          academy_id: "a2",
          academy_name: "Falah Academy",
          currency: "EGP",
          plan_name: "Basic",
          plan_code: "BASIC",
          video_plan_name: null,
          video_access: "ENABLED",
          video_trial_ends_at: null,
          video_status: "ENABLED",
          video_enabled: true,
          active_rooms: 1,
          live_rooms: 1,
          max_rooms: null,
          recordings_count: 0,
          storage_bytes: 0,
          recording_seconds: 0,
          active_recordings: 0,
          participant_sessions: 3,
        },
      ],
      totals: {
        academies: 2,
        enabled: 2,
        trial: 0,
        active_rooms: 3,
        recordings_count: 3,
        storage_bytes: 2_000_000_000,
        recording_seconds: 3600,
        active_recordings: 1,
      },
    });
    vi.mocked(api.getVideoCompliance).mockResolvedValue({
      rows: [
        { id: "e1", academy_id: "a1", academy_name: "Noor Academy", actor_user_id: "u1", actor_name: "Sara", actor_role: "ACADEMY_OWNER", action: "video_room.monitor_join", entity_type: "video_room", entity_id: "r1", after: null, created_at: "2026-06-20T10:00:00Z" },
        { id: "e2", academy_id: "a2", academy_name: "Falah Academy", actor_user_id: null, actor_name: null, actor_role: "HOST_LINK", action: "video_recording.start", entity_type: "room_recording", entity_id: "rec1", after: null, created_at: "2026-06-20T09:00:00Z" },
      ],
      total: 2,
      limit: 100,
    });
    vi.mocked(api.getVideoHealth).mockResolvedValue({
      livekit: { ok: true, rooms: 0, error: null },
      egress: { ok: true, active: 1, error: null },
      storage: { ok: true, configured: true, bucket: "recordings", status: 403, error: null },
      capacity: { active_recordings: 1, soft_limit: 2, level: "busy" },
      checked_at: "2026-06-20T10:00:00Z",
    });
  });

  it("renders cross-academy usage rows with plan caps", async () => {
    renderScreen();
    // "2 / 5" is unique to the usage table (the capped academy). The academy name also appears in
    // the compliance feed, so assert its presence with getAllByText.
    expect(await screen.findByText("2 / 5")).toBeInTheDocument();
    // The unlimited academy shows the ∞ cap.
    expect(screen.getByText("1 / ∞")).toBeInTheDocument();
    expect(screen.getAllByText("Noor Academy").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Falah Academy").length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces a monitor_join entry with the supervision badge in the compliance feed", async () => {
    renderScreen();
    expect(await screen.findByText(V.action["video_room_monitor_join"])).toBeInTheDocument();
    expect(screen.getByText(V.compliance.monitorBadge)).toBeInTheDocument();
    expect(screen.getByText(V.action["video_recording_start"])).toBeInTheDocument();
    // A null actor falls back to the "System" label.
    expect(screen.getByText(V.compliance.system)).toBeInTheDocument();
  });

  it("renders the service health card with the capacity hint", async () => {
    renderScreen();
    // 1 active egress, soft limit 2 → "In use" (unique to the capacity hint).
    expect(await screen.findByText(V.health.level.busy)).toBeInTheDocument();
    // LiveKit + Egress + Storage all reachable → at least 3 "Reachable" pills.
    expect(screen.getAllByText(V.health.online).length).toBeGreaterThanOrEqual(3);
  });

  it("blocks a user without platform.manage and never fetches", () => {
    renderScreen([]);
    expect(screen.getByText(V.noPermission)).toBeInTheDocument();
    expect(api.getVideoUsage).not.toHaveBeenCalled();
    expect(api.getVideoHealth).not.toHaveBeenCalled();
  });
});
