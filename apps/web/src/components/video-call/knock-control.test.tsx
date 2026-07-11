import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import type { PendingKnock } from "@/lib/api";
import { KnockControl } from "./knock-control";

const { mockListKnocks, mockDecideKnock } = vi.hoisted(() => ({
  mockListKnocks: vi.fn<() => Promise<{ knocks: PendingKnock[] }>>(),
  mockDecideKnock: vi.fn<() => Promise<{ ok: boolean; status: string }>>(),
}));
vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return { ...actual, listKnocks: mockListKnocks, decideKnock: mockDecideKnock };
});

function renderControl() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <KnockControl manageToken="manage-tok" />
    </NextIntlClientProvider>,
  );
}

describe("KnockControl", () => {
  beforeEach(() => {
    mockListKnocks.mockReset();
    mockDecideKnock.mockReset();
    mockDecideKnock.mockResolvedValue({ ok: true, status: "ADMITTED" });
  });

  it("renders nothing while the queue is empty", async () => {
    mockListKnocks.mockResolvedValue({ knocks: [] });
    renderControl();
    await waitFor(() => expect(mockListKnocks).toHaveBeenCalled());
    expect(screen.queryByTestId("knock-control")).not.toBeInTheDocument();
  });

  it("lists pending knockers", async () => {
    mockListKnocks.mockResolvedValue({
      knocks: [
        { id: "k1", displayName: "Sara", createdAt: "2026-06-28T00:00:00Z" },
        { id: "k2", displayName: "Yusuf", createdAt: "2026-06-28T00:00:01Z" },
      ],
    });
    renderControl();
    await waitFor(() => expect(screen.getByTestId("knock-control")).toBeInTheDocument());
    expect(screen.getByText("Sara")).toBeInTheDocument();
    expect(screen.getByText("Yusuf")).toBeInTheDocument();
    expect(screen.getAllByTestId("knock-row")).toHaveLength(2);
  });

  it("admits a knocker and drops the row optimistically", async () => {
    mockListKnocks.mockResolvedValue({
      knocks: [{ id: "k1", displayName: "Sara", createdAt: "2026-06-28T00:00:00Z" }],
    });
    renderControl();
    await waitFor(() => expect(screen.getByText("Sara")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Admit"));

    expect(mockDecideKnock).toHaveBeenCalledWith("manage-tok", "k1", "admit");
    await waitFor(() => expect(screen.queryByText("Sara")).not.toBeInTheDocument());
  });

  it("denies a knocker", async () => {
    mockListKnocks.mockResolvedValue({
      knocks: [{ id: "k1", displayName: "Sara", createdAt: "2026-06-28T00:00:00Z" }],
    });
    renderControl();
    await waitFor(() => expect(screen.getByText("Sara")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Deny"));

    expect(mockDecideKnock).toHaveBeenCalledWith("manage-tok", "k1", "deny");
  });

  // The decision and the poll race: a poll that was already in flight (or one that lands before the
  // server list catches up) still answers with the decided knocker. It must not spring back.
  it("keeps a decided knocker out of the queue even while the server still lists them", async () => {
    mockListKnocks.mockResolvedValue({
      knocks: [{ id: "k1", displayName: "Sara", createdAt: "2026-06-28T00:00:00Z" }],
    });
    renderControl();
    await waitFor(() => expect(screen.getByText("Sara")).toBeInTheDocument());
    const pollsBefore = mockListKnocks.mock.calls.length;

    fireEvent.click(screen.getByLabelText("Admit"));

    // decide() re-polls once the decision settles, and the mock still reports Sara as pending.
    await waitFor(() => expect(mockListKnocks.mock.calls.length).toBeGreaterThan(pollsBefore));
    expect(screen.queryByText("Sara")).not.toBeInTheDocument();
    expect(screen.queryByTestId("knock-control")).not.toBeInTheDocument();
  });

  it("restores the row when the decision fails", async () => {
    mockListKnocks.mockResolvedValue({
      knocks: [{ id: "k1", displayName: "Sara", createdAt: "2026-06-28T00:00:00Z" }],
    });
    mockDecideKnock.mockRejectedValue(new Error("network"));
    renderControl();
    await waitFor(() => expect(screen.getByText("Sara")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Admit"));

    // The optimistic drop is rolled back by the refresh that follows the failed decision.
    await waitFor(() => expect(screen.getByText("Sara")).toBeInTheDocument());
  });
});
