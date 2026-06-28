import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { RoomModal } from "./room-modal";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  createVideoRoom: vi.fn(),
  updateVideoRoom: vi.fn(),
}));

import * as api from "@/lib/api";

const t = enMessages.videoClassroom;

function renderModal(room: api.VideoRoom | null = null, permissions: string[] = ["room.manage"]) {
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}>
        <RoomModal open room={room} onClose={vi.fn()} onSaved={onSaved} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
  return { onSaved };
}

const baseConfig: api.RoomAccessSettings = {
  guest_password: null,
  host_password: null,
  waiting_room: false,
  recording_enabled: true,
  require_host_present: false,
  mute_guests_on_join: false,
  allow_guest_screenshare: true,
  max_participants: null,
  monitor_enabled: false,
  monitor_disclose: true,
};

describe("RoomModal (simplified, 08-ROOM-ACCESS §14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createVideoRoom).mockResolvedValue({ roomId: "r9" });
    vi.mocked(api.updateVideoRoom).mockResolvedValue({ ok: true, changed: [] });
  });

  it("creates with no password, waiting list off and recording allowed by default", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(t.nameLabel), "Halaqa");
    await user.click(screen.getByRole("button", { name: t.create }));

    await waitFor(() =>
      expect(api.createVideoRoom).toHaveBeenCalledWith({
        name: "Halaqa",
        settings: expect.objectContaining({
          host_password: null,
          guest_password: null,
          waiting_room: false,
          recording_enabled: true,
        }),
      }),
    );
    // Removed fields must NOT be sent.
    const arg = vi.mocked(api.createVideoRoom).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("record_default");
    expect(arg).not.toHaveProperty("slug");
    expect(arg.settings).not.toHaveProperty("max_participants");
  });

  it("only shows a password input for the selected side(s)", async () => {
    const user = userEvent.setup();
    renderModal();

    // None → no password inputs.
    expect(screen.queryByLabelText(t.teacherPasswordLabel)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t.studentPasswordLabel)).not.toBeInTheDocument();

    // Teacher only → just the teacher field.
    await user.click(screen.getByTestId("pw-mode-teacher"));
    expect(screen.getByLabelText(t.teacherPasswordLabel)).toBeInTheDocument();
    expect(screen.queryByLabelText(t.studentPasswordLabel)).not.toBeInTheDocument();

    // Both → both fields.
    await user.click(screen.getByTestId("pw-mode-both"));
    expect(screen.getByLabelText(t.teacherPasswordLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(t.studentPasswordLabel)).toBeInTheDocument();
  });

  it("maps Both → host_password (teacher) + guest_password (student)", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(t.nameLabel), "Halaqa");
    await user.click(screen.getByTestId("pw-mode-both"));
    await user.type(screen.getByLabelText(t.teacherPasswordLabel), "teach-key");
    await user.type(screen.getByLabelText(t.studentPasswordLabel), "open-sesame");
    await user.click(screen.getByRole("button", { name: t.create }));

    await waitFor(() =>
      expect(api.createVideoRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            host_password: "teach-key",
            guest_password: "open-sesame",
          }),
        }),
      ),
    );
  });

  it("toggles the waiting list and recording", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(t.nameLabel), "Halaqa");
    await user.click(screen.getByLabelText(t.waitingRoom));
    await user.click(screen.getByLabelText(t.recordingEnabled)); // default on → off
    await user.click(screen.getByRole("button", { name: t.create }));

    await waitFor(() =>
      expect(api.createVideoRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            waiting_room: true,
            recording_enabled: false,
          }),
        }),
      ),
    );
  });

  it("rejects a too-short password without calling the API", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(t.nameLabel), "Halaqa");
    await user.click(screen.getByTestId("pw-mode-student"));
    await user.type(screen.getByLabelText(t.studentPasswordLabel), "ab");
    await user.click(screen.getByRole("button", { name: t.create }));

    expect(await screen.findByText(t.passwordTooShort)).toBeInTheDocument();
    expect(api.createVideoRoom).not.toHaveBeenCalled();
  });

  it("shows supervisor toggles + a covert warning to a room.monitor holder", async () => {
    const user = userEvent.setup();
    renderModal(null, ["room.manage", "room.monitor"]);

    expect(screen.getByText(t.monitorTitle)).toBeInTheDocument();
    await user.click(screen.getByLabelText(t.monitorEnabledLabel)); // enable monitoring
    await user.click(screen.getByLabelText(t.monitorDiscloseLabel)); // turn disclosure OFF → covert
    expect(screen.getByText(t.monitorCovertWarning)).toBeInTheDocument();
  });

  it("hides supervisor toggles from a plain manager", () => {
    renderModal(null, ["room.manage"]);
    expect(screen.queryByText(t.monitorTitle)).not.toBeInTheDocument();
  });

  it("pre-fills the password mode + fields from an existing room and submits merged settings", async () => {
    const user = userEvent.setup();
    const room: api.VideoRoom = {
      id: "r1",
      name: "Existing",
      teacher_id: null,
      status: "ACTIVE",
      join_token: "existing-k3p9x",
      created_at: "2026-06-01T00:00:00Z",
      config: {
        ...baseConfig,
        host_password: "teach-pass",
        guest_password: "old-pass",
        recording_enabled: false,
        waiting_room: true,
      },
    };
    renderModal(room);

    // "Both" mode is derived; both fields pre-filled; toggles reflect stored config.
    expect(screen.getByTestId("pw-mode-both")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(t.teacherPasswordLabel)).toHaveValue("teach-pass");
    expect(screen.getByLabelText(t.studentPasswordLabel)).toHaveValue("old-pass");
    expect(screen.getByLabelText(t.recordingEnabled)).not.toBeChecked();
    expect(screen.getByLabelText(t.waitingRoom)).toBeChecked();

    await user.click(screen.getByRole("button", { name: t.save }));

    await waitFor(() =>
      expect(api.updateVideoRoom).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          settings: expect.objectContaining({
            host_password: "teach-pass",
            guest_password: "old-pass",
            recording_enabled: false,
            waiting_room: true,
          }),
        }),
      ),
    );
  });
});
