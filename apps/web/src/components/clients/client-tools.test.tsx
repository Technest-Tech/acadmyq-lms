import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { ClientToolsTab } from "./client-tools";

// The client page's Maintenance tab: a repair is looked at before it is applied, and what the
// command printed is what the admin reads.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getClientTools: vi.fn(),
  runClientTool: vi.fn(),
}));

import * as api from "@/lib/api";

const T = enMessages.clients.tools;

const wrap = (permissions: string[] = ["platform.manage"]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
      <ToastProvider>
        <ClientToolsTab clientId="c1" />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

describe("ClientToolsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getClientTools).mockResolvedValue({
      tools: [
        { key: "generate_lessons", preview: false },
        { key: "finish_removals", preview: true },
      ],
      runnable: true,
    });
  });

  it("is closed without platform.manage", () => {
    render(wrap([]));
    expect(screen.getByText(T.noPermission)).toBeInTheDocument();
    expect(api.getClientTools).not.toHaveBeenCalled();
  });

  it("looks first: Apply only appears under a preview, and applying shows what changed", async () => {
    vi.mocked(api.runClientTool)
      .mockResolvedValueOnce({ ok: true, applied: false, output: "Bright Steps — 1 removed students\n  Long Gone …" })
      .mockResolvedValueOnce({ ok: true, applied: true, output: "  → wound down\nDone: 1 removed students wound down." });
    render(wrap());
    const user = userEvent.setup();

    await screen.findByTestId("tool-finish_removals");
    expect(screen.getByText(T.tool.finish_removals.title)).toBeInTheDocument();
    // Nothing to apply until it has been looked at.
    expect(screen.queryByTestId("apply-finish_removals")).toBeNull();

    await user.click(screen.getByTestId("preview-finish_removals"));
    await waitFor(() => expect(api.runClientTool).toHaveBeenCalledWith("c1", "finish_removals", false));
    expect(await screen.findByTestId("output-finish_removals")).toHaveTextContent("Long Gone");
    expect(screen.getByText(T.outputPreview)).toBeInTheDocument();

    await user.click(screen.getByTestId("apply-finish_removals"));
    await waitFor(() => expect(api.runClientTool).toHaveBeenLastCalledWith("c1", "finish_removals", true));
    expect(await screen.findByText(T.outputApplied)).toBeInTheDocument();
    expect(screen.getByTestId("output-finish_removals")).toHaveTextContent("wound down");
    // Applied: there is nothing left to apply until it is looked at again.
    expect(screen.queryByTestId("apply-finish_removals")).toBeNull();
  });

  it("runs a tool that has nothing to preview straight away", async () => {
    vi.mocked(api.runClientTool).mockResolvedValue({ ok: true, applied: true, output: "c1 → created 12, removed 0\nDone (1 academy/academies)." });
    render(wrap());

    await userEvent.setup().click(await screen.findByTestId("run-generate_lessons"));

    await waitFor(() => expect(api.runClientTool).toHaveBeenCalledWith("c1", "generate_lessons", true));
    expect(await screen.findByTestId("output-generate_lessons")).toHaveTextContent("created 12");
    expect(screen.queryByTestId("preview-generate_lessons")).toBeNull();
  });

  it("says so, and switches the buttons off, for a client that is not active", async () => {
    vi.mocked(api.getClientTools).mockResolvedValue({ tools: [{ key: "finish_removals", preview: true }], runnable: false });
    render(wrap());

    expect(await screen.findByText(T.notActive)).toBeInTheDocument();
    expect(screen.getByTestId("preview-finish_removals")).toBeDisabled();
  });

  it("shows the server's reason when a run is refused, and offers nothing to apply", async () => {
    vi.mocked(api.runClientTool).mockRejectedValue(new api.ApiError(409, "Maintenance tools only run on an active client."));
    render(wrap());

    await userEvent.setup().click(await screen.findByTestId("preview-finish_removals"));

    expect(await screen.findByText("Maintenance tools only run on an active client.")).toBeInTheDocument();
    expect(screen.queryByTestId("output-finish_removals")).toBeNull();
  });
});
