import { fireEvent, render, screen } from "@testing-library/react";
import { Mic } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { DeviceMenu } from "./device-menu";
import { DevicePicker } from "./device-picker";

// Shared spies/state hoisted above the module mocks below.
const { mockSupportsOutput, mockSetActiveMediaDevice } = vi.hoisted(() => ({
  mockSupportsOutput: vi.fn(() => true),
  mockSetActiveMediaDevice: vi.fn(),
}));

// Only `supportsAudioOutputSelection` is imported from livekit-client by the menu.
vi.mock("livekit-client", () => ({
  supportsAudioOutputSelection: () => mockSupportsOutput(),
}));

// Stand in for the LiveKit hook so the menu can render without a real room/SFU.
vi.mock("@livekit/components-react", () => ({
  useMediaDeviceSelect: ({ kind }: { kind: MediaDeviceKind }) => {
    const lists: Record<string, Array<Partial<MediaDeviceInfo>>> = {
      videoinput: [
        { deviceId: "cam-1", label: "FaceTime Camera", kind: "videoinput" },
        { deviceId: "cam-2", label: "USB Camera", kind: "videoinput" },
      ],
      audioinput: [{ deviceId: "mic-1", label: "Built-in Mic", kind: "audioinput" }],
      audiooutput: [
        { deviceId: "spk-1", label: "Built-in Speakers", kind: "audiooutput" },
        { deviceId: "spk-2", label: "AirPods", kind: "audiooutput" },
      ],
    };
    const devices = lists[kind] ?? [];
    return {
      devices: devices as MediaDeviceInfo[],
      activeDeviceId: devices[0]?.deviceId ?? "",
      className: "",
      setActiveMediaDevice: mockSetActiveMediaDevice,
    };
  },
}));

function renderMenu() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DeviceMenu />
    </NextIntlClientProvider>,
  );
}

describe("DeviceMenu", () => {
  beforeEach(() => {
    mockSupportsOutput.mockReturnValue(true);
    mockSetActiveMediaDevice.mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is closed until the More button is clicked", () => {
    renderMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enMessages.videoCall.more }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("lists camera and microphone pickers", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: enMessages.videoCall.more }));
    expect(screen.getByLabelText(enMessages.videoCall.camera)).toBeInTheDocument();
    expect(screen.getByLabelText(enMessages.videoCall.microphone)).toBeInTheDocument();
  });

  it("shows the speaker picker only when output selection is supported", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: enMessages.videoCall.more }));
    expect(screen.getByLabelText(enMessages.videoCall.speaker)).toBeInTheDocument();
  });

  it("hides the speaker picker when output selection is unsupported", () => {
    mockSupportsOutput.mockReturnValue(false);
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: enMessages.videoCall.more }));
    expect(screen.queryByLabelText(enMessages.videoCall.speaker)).not.toBeInTheDocument();
  });

  it("switches the active camera through room.switchActiveDevice", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: enMessages.videoCall.more }));
    fireEvent.change(screen.getByLabelText(enMessages.videoCall.camera), {
      target: { value: "cam-2" },
    });
    expect(mockSetActiveMediaDevice).toHaveBeenCalledWith("cam-2");
  });

  it("closes on Escape", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: enMessages.videoCall.more }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on an outside click", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: enMessages.videoCall.more }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("DevicePicker", () => {
  it("renders each device and reports the chosen id", () => {
    const onChange = vi.fn();
    render(
      <DevicePicker
        label="Microphone"
        Icon={Mic}
        devices={
          [
            { deviceId: "a", label: "Mic A" },
            { deviceId: "b", label: "Mic B" },
          ] as MediaDeviceInfo[]
        }
        activeId="a"
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText("Microphone") as HTMLSelectElement;
    expect(select.value).toBe("a");
    expect(screen.getByRole("option", { name: "Mic B" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("falls back to a numbered label and disables when empty", () => {
    const { rerender } = render(
      <DevicePicker
        label="Camera"
        Icon={Mic}
        devices={[{ deviceId: "x", label: "" } as MediaDeviceInfo]}
        activeId="x"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: "Camera 1" })).toBeInTheDocument();

    rerender(
      <DevicePicker label="Camera" Icon={Mic} devices={[]} activeId="" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Camera")).toBeDisabled();
  });
});
