import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { useLeaveConfirm } from "./leave-confirm-dialog";

const { mockDisconnect } = vi.hoisted(() => ({ mockDisconnect: vi.fn(() => Promise.resolve()) }));
vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => ({ disconnect: mockDisconnect }),
}));

/** A stand-in for the Leave control in either bar: a button wired to the hook + its dialog. */
function LeaveButton() {
  const leave = useLeaveConfirm();
  return (
    <>
      <button type="button" onClick={leave.requestLeave}>
        Leave
      </button>
      {leave.dialog}
    </>
  );
}

function renderButton() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeaveButton />
    </NextIntlClientProvider>,
  );
}

describe("useLeaveConfirm", () => {
  beforeEach(() => mockDisconnect.mockClear());

  it("asks for confirmation instead of leaving straight away", () => {
    renderButton();
    expect(screen.queryByTestId("leave-confirm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    expect(screen.getByTestId("leave-confirm")).toBeInTheDocument();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it("disconnects once the leave is confirmed", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave" }));

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("leave-confirm")).not.toBeInTheDocument();
  });

  it("stays in the call when the confirmation is dismissed", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    fireEvent.click(screen.getByRole("button", { name: "Stay in call" }));

    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("leave-confirm")).not.toBeInTheDocument();
  });

  it("dismisses on Escape without leaving", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("leave-confirm")).not.toBeInTheDocument();
  });
});
