import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import type { JoinRoomResponse, KnockPoll } from "@/lib/api";
import { WaitingScreen } from "./waiting-screen";

// Override only pollKnock; keep the real isAdmitted/ApiError helpers the component uses.
const { mockPollKnock } = vi.hoisted(() => ({ mockPollKnock: vi.fn<() => Promise<KnockPoll>>() }));
vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return { ...actual, pollKnock: mockPollKnock };
});

const admittedCreds: JoinRoomResponse = {
  state: "admitted",
  url: "wss://media.test",
  token: "tok",
  roomName: "r-1",
  roomTitle: "Halaqa",
  roomId: "room-1",
  identity: "guest-abc",
  displayName: "Sara",
  role: "guest",
  canManage: false,
  manageToken: null,
};

function renderScreen(overrides: Partial<Parameters<typeof WaitingScreen>[0]> = {}) {
  const props = {
    knockToken: "knock-tok",
    roomTitle: "Halaqa",
    onAdmitted: vi.fn(),
    onDenied: vi.fn(),
    onExpired: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WaitingScreen {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("WaitingScreen", () => {
  beforeEach(() => {
    mockPollKnock.mockReset();
  });

  it("shows the knocking state with the room title", () => {
    mockPollKnock.mockResolvedValue({ state: "knocking" });
    renderScreen();
    expect(screen.getByTestId("waiting-screen")).toBeInTheDocument();
    expect(screen.getByText("You're in the waiting room")).toBeInTheDocument();
    expect(screen.getByText("Halaqa")).toBeInTheDocument();
  });

  it("calls onAdmitted with the minted credential when the host admits", async () => {
    mockPollKnock.mockResolvedValue(admittedCreds);
    const props = renderScreen();
    await waitFor(() => expect(props.onAdmitted).toHaveBeenCalledWith(admittedCreds));
  });

  it("calls onDenied when the host denies", async () => {
    mockPollKnock.mockResolvedValue({ state: "denied" });
    const props = renderScreen();
    await waitFor(() => expect(props.onDenied).toHaveBeenCalled());
  });

  it("calls onExpired when the knock times out", async () => {
    mockPollKnock.mockResolvedValue({ state: "expired" });
    const props = renderScreen();
    await waitFor(() => expect(props.onExpired).toHaveBeenCalled());
  });

  it("cancels back to the lobby", () => {
    mockPollKnock.mockResolvedValue({ state: "knocking" });
    const props = renderScreen();
    fireEvent.click(screen.getByText("Cancel"));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
