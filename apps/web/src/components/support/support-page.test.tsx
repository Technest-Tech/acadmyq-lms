import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { SupportPage } from "./support-page";

// The academy's Support page: its requests and where each stands, raising a new one, and answering
// the support team inside one.

vi.mock("@/lib/support-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/support-api")>()),
  getSupportRequests: vi.fn(),
  getSupportRequest: vi.fn(),
  createSupportRequest: vi.fn(),
  replySupportRequest: vi.fn(),
  withdrawSupportRequest: vi.fn(),
}));

import * as api from "@/lib/support-api";

const T = enMessages.support;

const row = (over: Partial<api.SupportRequestRow> = {}): api.SupportRequestRow => ({
  id: "r1",
  number: 1,
  kind: "PROBLEM",
  title: "Bills page is empty",
  priority: "NORMAL",
  status: "WAITING",
  source: "ACADEMY",
  page: null,
  createdBy: "Owner One",
  unread: true,
  replies: 1,
  createdAt: "2026-11-20T10:00:00+00:00",
  lastActivityAt: "2026-11-21T09:00:00+00:00",
  closedAt: null,
  ...over,
});

const detailOf = (r: api.SupportRequestRow, messages: api.SupportMessage[] = []): api.SupportRequestDetail => ({
  request: { ...r, body: "Nothing shows since this morning.", attachments: [] },
  messages,
});

const question: api.SupportMessage = {
  id: "m1",
  side: "ADMIN",
  author: null,
  body: "Which month are you looking at?",
  internal: false,
  statusFrom: "NEW",
  statusTo: "WAITING",
  attachments: [],
  createdAt: "2026-11-21T09:00:00+00:00",
};

const wrap = () => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER", { permissions: ["support.manage"] }))}>
      <ToastProvider>
        <SupportPage />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

describe("SupportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/support");
    vi.mocked(api.getSupportRequests).mockResolvedValue({
      rows: [row(), row({ id: "r2", number: 2, kind: "CHANGE", title: "Add a phone column", status: "DONE", unread: false, replies: 0 })],
      counts: { open: 1, waiting: 1, closed: 1, unread: 1 },
    });
  });

  it("lists the requests with their status and filters them by tile", async () => {
    const user = userEvent.setup();
    render(wrap());

    expect(await screen.findByText("Bills page is empty")).toBeInTheDocument();
    expect(screen.getByText("Add a phone column")).toBeInTheDocument();
    expect(screen.getAllByText(T.status.WAITING).length).toBeGreaterThan(0);
    expect(screen.getByText(T.unread)).toBeInTheDocument();

    await user.click(screen.getByTestId("segment-support-tile-closed"));
    expect(screen.queryByText("Bills page is empty")).not.toBeInTheDocument();
    expect(screen.getByText("Add a phone column")).toBeInTheDocument();
  });

  it("raises a request with its type, title, details and urgency", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createSupportRequest).mockResolvedValue(detailOf(row({ id: "r3", number: 3, status: "NEW" })));
    render(wrap());
    await screen.findByText("Bills page is empty");

    await user.click(screen.getByTestId("support-new"));
    // No title → nothing is sent.
    await user.click(screen.getByTestId("support-submit"));
    expect(await screen.findByText(T.form.titleRequired)).toBeInTheDocument();
    expect(api.createSupportRequest).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("support-kind-CHANGE"));
    await user.type(screen.getByTestId("support-title"), "Export students to Excel");
    await user.type(screen.getByTestId("support-body"), "With their phones.");
    await user.click(screen.getByTestId("support-urgent"));
    await user.click(screen.getByTestId("support-submit"));

    await waitFor(() =>
      expect(api.createSupportRequest).toHaveBeenCalledWith({
        kind: "CHANGE",
        title: "Export students to Excel",
        body: "With their phones.",
        priority: "URGENT",
        page: null,
        files: [],
      }),
    );
    expect(await screen.findByText("Request sent — number #3")).toBeInTheDocument();
  });

  it("opens a request, shows the team's question and sends the answer", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSupportRequest).mockResolvedValue(detailOf(row(), [question]));
    vi.mocked(api.replySupportRequest).mockResolvedValue(
      detailOf(row({ status: "NEW" }), [
        question,
        { ...question, id: "m2", side: "ACADEMY", author: "Owner One", body: "November", statusFrom: "WAITING", statusTo: "NEW" },
      ]),
    );
    render(wrap());

    await user.click(await screen.findByText("Bills page is empty"));
    expect(await screen.findByText("Which month are you looking at?")).toBeInTheDocument();
    expect(screen.getByText(T.waitingBanner)).toBeInTheDocument();
    expect(screen.getAllByText(T.team).length).toBeGreaterThan(0);

    // Empty → asks for words instead of sending.
    await user.click(screen.getByTestId("support-send"));
    expect(await screen.findByText(T.composer.empty)).toBeInTheDocument();
    expect(api.replySupportRequest).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("support-reply"), "November");
    await user.click(screen.getByTestId("support-send"));
    await waitFor(() => expect(api.replySupportRequest).toHaveBeenCalledWith("r1", "November", []));
    expect(await screen.findByText(T.event.answered)).toBeInTheDocument();
  });

  it("withdraws a new request only on the second press", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSupportRequest).mockResolvedValue(detailOf(row({ status: "NEW", unread: false })));
    vi.mocked(api.withdrawSupportRequest).mockResolvedValue(detailOf(row({ status: "CANCELLED" })));
    render(wrap());

    await user.click(await screen.findByText("Bills page is empty"));
    await user.click(await screen.findByTestId("support-withdraw"));
    expect(api.withdrawSupportRequest).not.toHaveBeenCalled();
    expect(screen.getByText(T.withdrawConfirm)).toBeInTheDocument();

    await user.click(screen.getByTestId("support-withdraw"));
    await waitFor(() => expect(api.withdrawSupportRequest).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText(T.closedNote)).toBeInTheDocument();
  });
});
