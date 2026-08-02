import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";

vi.mock("@livekit/components-react", () => ({
  useLocalParticipant: () => ({ localParticipant: { getTrackPublication: () => undefined } }),
  useMediaDeviceSelect: ({ kind }: { kind: string }) => ({
    devices: [{ deviceId: "d1", label: "Device 1", kind }],
    activeDeviceId: "d1",
    className: "",
    setActiveMediaDevice: vi.fn(),
  }),
}));
vi.mock("livekit-client", () => ({
  Track: { Source: { Microphone: "microphone", Camera: "camera" } },
  supportsAudioOutputSelection: () => true,
  VideoPresets: { h720: { resolution: {} }, h360: { resolution: {} } },
}));
vi.mock("@livekit/track-processors", () => ({
  supportsBackgroundProcessors: () => true,
  BackgroundProcessor: vi.fn(),
}));

import { SettingsDialog } from "./settings-dialog";
import { CallSettingsContext, DEFAULT_SETTINGS } from "./use-call-settings";

const v = enMessages.videoCall;

function renderDialog(update = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CallSettingsContext.Provider value={{ settings: DEFAULT_SETTINGS, update, hydrated: true }}>
        <SettingsDialog open onClose={vi.fn()} />
      </CallSettingsContext.Provider>
    </NextIntlClientProvider>,
  );
  return update;
}

describe("SettingsDialog", () => {
  it("opens to the Audio section with mic picker + noise/echo toggles", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(v.microphone)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: v.noiseSuppression })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: v.echoCancellation })).toBeInTheDocument();
  });

  it("switches to the Video tab and toggling mirror persists the change", () => {
    const update = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: v.video }));
    fireEvent.click(screen.getByRole("switch", { name: v.mirrorVideo }));
    expect(update).toHaveBeenCalledWith({ mirror: false });
  });

  it("shows apply-automatically already on, and persists turning it off", () => {
    // It renders CHECKED because remembering the setup is now the default — teachers were re-picking
    // their camera and background on every join because this shipped off and buried in the footer.
    const update = renderDialog();
    const toggle = screen.getByRole("switch", { name: v.applyAutomatically });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ autoApply: false });
  });

  it("toggling noise suppression persists it", () => {
    const update = renderDialog();
    fireEvent.click(screen.getByRole("switch", { name: v.noiseSuppression }));
    expect(update).toHaveBeenCalledWith({ noiseSuppression: false });
  });

  it("offers voice isolation, on by default, and persists turning it off", () => {
    const update = renderDialog();
    const toggle = screen.getByRole("switch", { name: v.voiceIsolation });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ voiceIsolation: false });
  });

  it("switches to the Background tab and lists effect options", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: v.background }));
    expect(screen.getByRole("button", { name: v.backgroundNone })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: v.backgroundBlur })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: v.backgroundBlurStrong })).toBeInTheDocument();
  });
});
