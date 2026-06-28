import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import enMessages from "../../../messages/en.json";
import { CallControlContext } from "./call-control-context";
import { RecordingProvider, useRecording } from "./recording-context";

// Controllable LiveKit recording signal — flip `serverRecording` then rerender to simulate egress.
const state = vi.hoisted(() => ({ serverRecording: false }));
vi.mock("@livekit/components-react", () => ({
  useIsRecording: () => state.serverRecording,
}));

const { mockStart, mockStop, mockToast } = vi.hoisted(() => ({
  mockStart: vi.fn<() => Promise<{ recordingId: string }>>(),
  mockStop: vi.fn<() => Promise<{ ok: boolean }>>(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return { ...actual, startRoomRecording: mockStart, stopRoomRecording: mockStop };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => mockToast }));

import { ApiError } from "@/lib/api";

function Harness() {
  const { phase, isRecording, busy, toggle } = useRecording();
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="rec">{String(isRecording)}</span>
      <span data-testid="busy">{String(busy)}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

function tree(): ReactElement {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CallControlContext.Provider value={{ canManage: true, roomId: "room-1", manageToken: null }}>
        <RecordingProvider>
          <Harness />
        </RecordingProvider>
      </CallControlContext.Provider>
    </NextIntlClientProvider>
  );
}

describe("RecordingProvider", () => {
  beforeEach(() => {
    state.serverRecording = false;
    mockStart.mockReset().mockResolvedValue({ recordingId: "r1" });
    mockStop.mockReset().mockResolvedValue({ ok: true });
    mockToast.success.mockReset();
    mockToast.error.mockReset();
    mockToast.info.mockReset();
  });

  it("starts: optimistic 'starting' → 'recording' + 'saved' toast when egress flips", async () => {
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText("toggle"));

    expect(mockStart).toHaveBeenCalledWith("room-1", null);
    expect(screen.getByTestId("phase").textContent).toBe("starting");
    expect(screen.getByTestId("busy").textContent).toBe("true");
    expect(mockToast.info).toHaveBeenCalledWith("Starting recording…");

    // Egress is live now.
    act(() => void (state.serverRecording = true));
    rerender(tree());
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("recording"));
    expect(mockToast.success).toHaveBeenCalledWith("Recording started");
  });

  it("stops: optimistic 'stopping' → 'idle' + 'saved' toast when egress flips off", async () => {
    state.serverRecording = true;
    const { rerender } = render(tree());
    expect(screen.getByTestId("phase").textContent).toBe("recording");

    fireEvent.click(screen.getByText("toggle"));
    expect(mockStop).toHaveBeenCalledWith("room-1", null);
    expect(screen.getByTestId("phase").textContent).toBe("stopping");
    expect(mockToast.info).toHaveBeenCalledWith("Stopping recording — saving…");

    act(() => void (state.serverRecording = false));
    rerender(tree());
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("idle"));
    expect(mockToast.success).toHaveBeenCalledWith("Recording saved to your account.");
  });

  it("reverts to idle and shows the disabled toast on a 403 start", async () => {
    mockStart.mockRejectedValue(new ApiError(403, "recording disabled"));
    render(tree());
    fireEvent.click(screen.getByText("toggle"));

    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("idle"));
    expect(mockToast.error).toHaveBeenCalledWith("Recording is turned off for this room.");
  });

  it("ignores clicks while a transition is already in flight", () => {
    render(tree());
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("toggle"));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
