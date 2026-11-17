import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { ClientDeletedTab } from "./client-deleted";

// The client page's Deleted tab: what a client deleted, a restore looked at before it is applied,
// and permanent deletes listed for the record only.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getClientDeleted: vi.fn(),
  restoreClientDeleted: vi.fn(),
}));

import * as api from "@/lib/api";

const T = enMessages.clients.deleted;

const wrap = (permissions: string[] = ["platform.manage"]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
      <ToastProvider>
        <ClientDeletedTab clientId="c1" />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

const family: api.DeletedItem = {
  kind: "family",
  id: "g1",
  label: "Waleed Arafat",
  deleted_at: "2026-11-16T16:44:56+00:00",
  deleted_by: "Radwa",
  detail: { phone: "+966597780872", children: ["Jawad", "Jumana"] },
};
const lead: api.DeletedItem = {
  kind: "lead",
  id: "l1",
  label: "Sara Lead",
  deleted_at: "2026-11-10T10:00:00+00:00",
  deleted_by: null,
  detail: { phone: null, status: "LOST" },
};

describe("ClientDeletedTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getClientDeleted).mockResolvedValue({
      items: [family, lead],
      log: [
        {
          id: "a1",
          action: "teacher.delete",
          label: "Mr Gone",
          amount_minor: null,
          currency: null,
          when: null,
          deleted_at: "2026-11-16T16:42:34+00:00",
          deleted_by: "Radwa",
        },
      ],
    });
  });

  it("is closed without platform.manage", () => {
    render(wrap([]));
    expect(screen.getByText(T.noPermission)).toBeInTheDocument();
    expect(api.getClientDeleted).not.toHaveBeenCalled();
  });

  it("lists what was deleted, by whom, with a family's children, and filters by kind", async () => {
    render(wrap());
    const user = userEvent.setup();

    const row = await screen.findByTestId("deleted-family-g1");
    expect(within(row).getByText(/Children: Jawad، Jumana/)).toBeInTheDocument();
    expect(within(row).getByText(/Deleted by Radwa/)).toBeInTheDocument();
    expect(screen.getByTestId("deleted-lead-l1")).toBeInTheDocument();

    await user.click(screen.getByTestId("deleted-filter-lead"));
    expect(screen.queryByTestId("deleted-family-g1")).not.toBeInTheDocument();
    expect(screen.getByTestId("deleted-lead-l1")).toBeInTheDocument();

    // Permanent deletes are shown for the record, with no restore button.
    const log = screen.getByTestId("deleted-log");
    expect(within(log).getByText(/Mr Gone/)).toBeInTheDocument();
    expect(within(log).queryByRole("button")).not.toBeInTheDocument();
  });

  it("previews first, says what won't come back, then restores and reloads", async () => {
    vi.mocked(api.restoreClientDeleted)
      .mockResolvedValueOnce({
        applied: false,
        done: [
          { key: "family", label: "Waleed Arafat" },
          { key: "student", label: "Jawad" },
          { key: "block_rebilled", label: "Jawad private class" },
        ],
        skipped: [{ key: "package_closed", label: "8 lessons" }],
      })
      .mockResolvedValueOnce({ applied: true, done: [], skipped: [] });
    render(wrap());
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("preview-g1"));
    expect(api.restoreClientDeleted).toHaveBeenLastCalledWith("c1", "family", "g1", false);

    const report = await screen.findByTestId("report-g1");
    expect(within(report).getByText(T.previewNote)).toBeInTheDocument();
    expect(within(report).getByText("Student: Jawad")).toBeInTheDocument();
    expect(within(report).getByText(/Block: Jawad private class \(on a new bill/)).toBeInTheDocument();
    expect(within(report).getByTestId("report-skipped")).toHaveTextContent("Package 8 lessons was closed");

    vi.mocked(api.getClientDeleted).mockResolvedValueOnce({ items: [lead], log: [] });
    await user.click(within(report).getByTestId("apply-g1"));

    expect(api.restoreClientDeleted).toHaveBeenLastCalledWith("c1", "family", "g1", true);
    await waitFor(() => expect(screen.queryByTestId("deleted-family-g1")).not.toBeInTheDocument());
    expect(api.getClientDeleted).toHaveBeenCalledTimes(2);
  });

  it("says so when nothing was deleted", async () => {
    vi.mocked(api.getClientDeleted).mockResolvedValue({ items: [], log: [] });
    render(wrap());
    expect(await screen.findByTestId("deleted-empty")).toHaveTextContent(T.empty);
  });
});
