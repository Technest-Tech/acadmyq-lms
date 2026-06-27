import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";

// LiveKit hooks/components the tile pulls in — stub them so it renders without a room.
vi.mock("@livekit/components-react", () => ({
  VideoTrack: () => null,
  isTrackReference: () => false, // → avatar path, no media element
  useIsSpeaking: () => false,
}));
vi.mock("livekit-client", () => ({
  Track: { Source: { Camera: "camera", ScreenShare: "screen_share", Microphone: "microphone" } },
}));
vi.mock("@/lib/api", () => ({
  muteParticipant: vi.fn().mockResolvedValue(undefined),
  removeParticipant: vi.fn().mockResolvedValue(undefined),
}));

import * as api from "@/lib/api";
import { CallControlContext } from "./call-control-context";
import { ParticipantTile } from "./participant-tile";

type TileOpts = { identity?: string; name?: string; isLocal?: boolean; micOn?: boolean };
function trackRef({ identity = "guest-1", name = "Sara", isLocal = false, micOn = true }: TileOpts) {
  return {
    participant: { identity, name, isLocal, isMicrophoneEnabled: micOn },
    source: "camera",
    publication: undefined,
  } as never;
}

function renderTile(opts: TileOpts, control = { canManage: true, roomId: "room-1" }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CallControlContext.Provider value={control}>
        <ParticipantTile trackRef={trackRef(opts)} />
      </CallControlContext.Provider>
    </NextIntlClientProvider>,
  );
}

const muteLabel = enMessages.videoCall.muteParticipant;
const removeLabel = enMessages.videoCall.removeParticipant;

describe("ParticipantTile host controls", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows mute + remove for a host on a remote tile", () => {
    renderTile({});
    expect(screen.getByLabelText(muteLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(removeLabel)).toBeInTheDocument();
  });

  it("hides host controls for a non-host viewer", () => {
    renderTile({}, { canManage: false, roomId: "room-1" });
    expect(screen.queryByLabelText(muteLabel)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(removeLabel)).not.toBeInTheDocument();
  });

  it("never offers host controls on the local (self) tile", () => {
    renderTile({ isLocal: true });
    expect(screen.queryByLabelText(muteLabel)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(removeLabel)).not.toBeInTheDocument();
  });

  it("drops the mute button once the participant is already muted (can't force-unmute)", () => {
    renderTile({ micOn: false });
    expect(screen.queryByLabelText(muteLabel)).not.toBeInTheDocument();
    expect(screen.getByLabelText(removeLabel)).toBeInTheDocument();
  });

  it("force-mutes through the server API with the room id + identity", () => {
    renderTile({ identity: "guest-7" });
    fireEvent.click(screen.getByLabelText(muteLabel));
    expect(api.muteParticipant).toHaveBeenCalledWith("room-1", "guest-7");
  });

  it("removes through the server API with the room id + identity", () => {
    renderTile({ identity: "guest-9" });
    fireEvent.click(screen.getByLabelText(removeLabel));
    expect(api.removeParticipant).toHaveBeenCalledWith("room-1", "guest-9");
  });
});
