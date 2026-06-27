import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// LiveKit hooks the provider subscribes to — empty room is fine for the gating/render checks.
vi.mock("@livekit/components-react", () => ({
  useTracks: () => [],
  useParticipants: () => [],
  isTrackReference: () => false,
}));
vi.mock("livekit-client", () => ({ Track: { Source: { Camera: "camera" } } }));

import { CompositePipProvider, usePip } from "./composite-pip";

function Probe() {
  const { supported, isActive } = usePip();
  return <div data-testid="probe">{`${supported}:${isActive}`}</div>;
}

function setPipEnabled(value: boolean | undefined) {
  Object.defineProperty(document, "pictureInPictureEnabled", { value, configurable: true });
}

describe("CompositePipProvider", () => {
  afterEach(() => setPipEnabled(undefined));

  it("renders children and reports support from document.pictureInPictureEnabled", () => {
    setPipEnabled(true);
    render(
      <CompositePipProvider>
        <Probe />
      </CompositePipProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("true:false");
  });

  it("reports unsupported when the Picture-in-Picture API is absent", () => {
    setPipEnabled(false);
    render(
      <CompositePipProvider>
        <Probe />
      </CompositePipProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("false:false");
  });
});
