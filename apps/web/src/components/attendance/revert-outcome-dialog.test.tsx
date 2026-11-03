import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { withAuth, makeSession } from "@/test/auth";
import { RevertOutcomeDialog } from "./revert-outcome-dialog";

/**
 * Undoing a lesson whose month's salary is already final (a centre, lingo 2026-11-03): nothing is
 * refused, but money moved somewhere nobody asked about, so the dialog stays to say how much.
 */

const revertAttendance = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  revertAttendance: (id: string) => revertAttendance(id),
}));

function open(onReverted = vi.fn()) {
  render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["session.revert_attendance"] }),
      <RevertOutcomeDialog sessionId="s1" studentName="سليم" currentStatus="ATTENDED" open onClose={() => {}} onReverted={onReverted} />,
    ),
  );
  return onReverted;
}

describe("RevertOutcomeDialog", () => {
  beforeEach(() => {
    revertAttendance.mockReset();
  });

  it("closes straight away on an ordinary undo", async () => {
    revertAttendance.mockResolvedValue({ status: "SCHEDULED", billed: false, carried: null });
    const user = userEvent.setup();
    const onReverted = open();

    await user.click(screen.getByTestId("revert-confirm"));

    await waitFor(() => expect(onReverted).toHaveBeenCalled());
    expect(screen.queryByTestId("revert-carried")).toBeNull();
  });

  it("says what came off the teacher's open statement before closing", async () => {
    revertAttendance.mockResolvedValue({ status: "SCHEDULED", billed: false, carried: { amount_minor: 9000, currency: "EGP" } });
    const user = userEvent.setup();
    const onReverted = open();

    await user.click(screen.getByTestId("revert-confirm"));

    const note = await screen.findByTestId("revert-carried");
    expect(note.textContent).toContain(arMessages.attendance.revert.carried.split("{amount}")[0]!.trim());
    expect(onReverted).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("revert-done"));
    expect(onReverted).toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    revertAttendance.mockRejectedValue(new Error("Cannot reverse"));
    const user = userEvent.setup();
    const onReverted = open();

    await user.click(screen.getByTestId("revert-confirm"));

    expect((await screen.findByTestId("revert-error")).textContent).toContain("Cannot reverse");
    expect(onReverted).not.toHaveBeenCalled();
  });
});
