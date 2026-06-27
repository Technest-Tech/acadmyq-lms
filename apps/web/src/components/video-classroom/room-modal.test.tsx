import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { RoomModal } from "./room-modal";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  createVideoRoom: vi.fn(),
  updateVideoRoom: vi.fn(),
}));

import * as api from "@/lib/api";

const t = enMessages.videoClassroom;

function renderModal(room: api.VideoRoom | null = null) {
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RoomModal open room={room} onClose={vi.fn()} onSaved={onSaved} />
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
};

describe("RoomModal access settings (S1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createVideoRoom).mockResolvedValue({ roomId: "r9" });
    vi.mocked(api.updateVideoRoom).mockResolvedValue({ ok: true, changed: [] });
  });

  it("creates with no password and behaviour-preserving defaults", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(t.nameLabel), "Halaqa");
    await user.click(screen.getByRole("button", { name: t.create }));

    await waitFor(() =>
      expect(api.createVideoRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Halaqa",
          settings: expect.objectContaining({
            guest_password: null, // blank → no password (OPTIONAL)
            max_participants: null,
            recording_enabled: true,
            require_host_present: false,
            allow_guest_screenshare: true,
          }),
        }),
      ),
    );
  });

  it("sets an optional guest password and a max-participants cap", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(t.nameLabel), "Halaqa");
    await user.type(screen.getByPlaceholderText(t.guestPasswordPlaceholder), "open-sesame");
    await user.type(screen.getByPlaceholderText(t.maxParticipantsPlaceholder), "12");
    await user.click(screen.getByRole("button", { name: t.create }));

    await waitFor(() =>
      expect(api.createVideoRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            guest_password: "open-sesame",
            max_participants: 12,
          }),
        }),
      ),
    );
  });

  it("rejects a too-short password without calling the API", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(t.nameLabel), "Halaqa");
    await user.type(screen.getByPlaceholderText(t.guestPasswordPlaceholder), "ab");
    await user.click(screen.getByRole("button", { name: t.create }));

    expect(await screen.findByText(t.passwordTooShort)).toBeInTheDocument();
    expect(api.createVideoRoom).not.toHaveBeenCalled();
  });

  it("pre-fills from an existing room and submits the merged settings on edit", async () => {
    const user = userEvent.setup();
    const room: api.VideoRoom = {
      id: "r1",
      name: "Existing",
      teacher_id: null,
      status: "ACTIVE",
      record_default: false,
      join_token: "tok",
      created_at: "2026-06-01T00:00:00Z",
      config: {
        ...baseConfig,
        guest_password: "old-pass",
        recording_enabled: false,
        require_host_present: true,
        allow_guest_screenshare: false,
        max_participants: 5,
      },
    };
    renderModal(room);

    // The password field is pre-filled and the toggles reflect the stored config.
    expect(screen.getByPlaceholderText(t.guestPasswordPlaceholder)).toHaveValue("old-pass");
    expect(screen.getByLabelText(t.recordingEnabled)).not.toBeChecked();
    expect(screen.getByLabelText(t.requireHostPresent)).toBeChecked();
    expect(screen.getByLabelText(t.allowGuestScreenshare)).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: t.save }));

    await waitFor(() =>
      expect(api.updateVideoRoom).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          settings: expect.objectContaining({
            guest_password: "old-pass",
            recording_enabled: false,
            require_host_present: true,
            allow_guest_screenshare: false,
            max_participants: 5,
          }),
        }),
      ),
    );
  });
});
