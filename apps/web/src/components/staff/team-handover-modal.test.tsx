import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { TeamHandoverModal } from "@/components/staff/team-handover-modal";
import { makeSession, withAuth } from "@/test/auth";

const listHandoverOwners = vi.fn();
const handOverSupervision = vi.fn();
const listTeamActors = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listHandoverOwners: (...args: unknown[]) => listHandoverOwners(...args),
  handOverSupervision: (...args: unknown[]) => handOverSupervision(...args),
  listTeamActors: (...args: unknown[]) => listTeamActors(...args),
}));

const t = arMessages.staff.handover;

describe("TeamHandoverModal — move a deleted supervisor's people", () => {
  beforeEach(() => {
    listHandoverOwners.mockReset();
    handOverSupervision.mockReset();
    listTeamActors.mockResolvedValue({
      actors: [{ id: "u-new", name: "سارة", role: "SUPERVISOR", role_name: null, is_active: true }],
    });
    listHandoverOwners
      .mockResolvedValueOnce({
        owners: [
          { user_id: "u-gone", name: "منى", role: null, state: "gone", counts: { student: 4, teacher: 10, guardian: 2 } },
          { user_id: null, name: null, role: null, state: "nobody", counts: { student: 3, teacher: 0, guardian: 0 } },
          { user_id: "u-new", name: "سارة", role: "SUPERVISOR", state: "active", counts: { student: 7, teacher: 1, guardian: 0 } },
        ],
      })
      .mockResolvedValueOnce({
        owners: [{ user_id: "u-new", name: "سارة", role: "SUPERVISOR", state: "active", counts: { student: 11, teacher: 11, guardian: 2 } }],
      });
  });

  it("lists the deleted supervisor first and hands her people to an active one", async () => {
    handOverSupervision.mockResolvedValue({ moved: { student: 4, teacher: 10, guardian: 2 } });
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", { permissions: ["staff.read", "staff.update"] }),
        <TeamHandoverModal open onClose={() => {}} />,
      ),
    );

    const rows = await screen.findAllByTestId("team-handover-row");
    expect(rows[0]).toHaveAttribute("data-state", "gone");
    expect(within(rows[0]!).getByText(t.state.gone)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(t.nobody)).toBeInTheDocument();

    await userEvent.click(within(rows[0]!).getByTestId("team-handover-pick"));
    await userEvent.selectOptions(await screen.findByTestId("handover-to"), "u-new");
    await userEvent.click(screen.getByTestId("handover-confirm"));

    await waitFor(() => expect(handOverSupervision).toHaveBeenCalledWith("u-gone", "u-new", ["student", "teacher", "guardian"]));
    expect(await screen.findByText(/تم النقل إلى سارة/)).toBeInTheDocument();
    expect(listHandoverOwners).toHaveBeenCalledTimes(2);
  });

  it("hands over the records nobody added as \"none\"", async () => {
    handOverSupervision.mockResolvedValue({ moved: { student: 3, teacher: 0, guardian: 0 } });
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", { permissions: ["staff.read", "staff.update"] }),
        <TeamHandoverModal open onClose={() => {}} />,
      ),
    );

    const rows = await screen.findAllByTestId("team-handover-row");
    await userEvent.click(within(rows[1]!).getByTestId("team-handover-pick"));
    await userEvent.selectOptions(await screen.findByTestId("handover-to"), "u-new");
    await userEvent.click(screen.getByTestId("handover-confirm"));

    await waitFor(() => expect(handOverSupervision).toHaveBeenCalledWith("none", "u-new", ["student"]));
  });
});
