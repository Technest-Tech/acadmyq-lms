import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { StaffHandoverCard } from "@/components/staff/staff-handover-card";
import { makeSession, withAuth } from "@/test/auth";

const getHandoverCounts = vi.fn();
const handOverSupervision = vi.fn();
const listTeamActors = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getHandoverCounts: (...args: unknown[]) => getHandoverCounts(...args),
  handOverSupervision: (...args: unknown[]) => handOverSupervision(...args),
  listTeamActors: (...args: unknown[]) => listTeamActors(...args),
}));

const t = arMessages.staff.handover;

function renderCard() {
  render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["staff.read", "staff.update"] }),
      <StaffHandoverCard userId="u-left" name="منى" />,
    ),
  );
}

describe("StaffHandoverCard — hand a supervisor's people to another", () => {
  beforeEach(() => {
    getHandoverCounts.mockReset();
    handOverSupervision.mockReset();
    listTeamActors.mockResolvedValue({
      actors: [
        { id: "u-left", name: "منى", role: "SUPERVISOR", role_name: null, is_active: false },
        { id: "u-new", name: "سارة", role: "SUPERVISOR", role_name: null, is_active: true },
        { id: "u-off", name: "هالة", role: "SUPERVISOR", role_name: null, is_active: false },
      ],
    });
  });

  it("hands the chosen kinds to an active team member and shows what moved", async () => {
    getHandoverCounts
      .mockResolvedValueOnce({ counts: { student: 3, teacher: 10, guardian: 0 } })
      .mockResolvedValueOnce({ counts: { student: 3, teacher: 0, guardian: 0 } });
    handOverSupervision.mockResolvedValue({ moved: { student: 0, teacher: 10, guardian: 0 } });
    renderCard();

    expect(await screen.findByTestId("handover-counts")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("handover-open"));

    // Only active members other than the one handing over can take them.
    const select = screen.getByTestId("handover-to");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual(["", "u-new"]);
    // Nothing to move of a kind with none: unticked and locked.
    expect(screen.getByTestId("handover-type-guardian")).toBeDisabled();

    await userEvent.selectOptions(select, "u-new");
    await userEvent.click(screen.getByTestId("handover-type-student"));
    await userEvent.click(screen.getByTestId("handover-confirm"));

    await waitFor(() => expect(handOverSupervision).toHaveBeenCalledWith("u-left", "u-new", ["teacher"]));
    expect(await screen.findByText(/تم النقل إلى سارة/)).toBeInTheDocument();
    expect(getHandoverCounts).toHaveBeenCalledTimes(2);
  });

  it("says there is nothing to hand over, with no button", async () => {
    getHandoverCounts.mockResolvedValue({ counts: { student: 0, teacher: 0, guardian: 0 } });
    renderCard();

    expect(await screen.findByText(t.none)).toBeInTheDocument();
    expect(screen.queryByTestId("handover-open")).not.toBeInTheDocument();
  });
});
