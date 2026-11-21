import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { SupportInbox } from "./support-inbox";

// The platform team's inbox: every client's requests, and the moves on one — accept, ask, done,
// decline (with words where the client must read them), reply, internal note.

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/support-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/support-api")>()),
  getSupportInbox: vi.fn(),
  getSupportInboxRequest: vi.fn(),
  respondSupportRequest: vi.fn(),
  updateSupportRequest: vi.fn(),
  logSupportRequest: vi.fn(),
}));

import * as api from "@/lib/support-api";

const T = enMessages.adminSupport;

const row: api.SupportRequestRow = {
  id: "r1",
  number: 4,
  kind: "PROBLEM",
  title: "Bills page is empty",
  priority: "URGENT",
  status: "NEW",
  source: "ACADEMY",
  page: "/invoices",
  createdBy: "Owner One",
  unread: true,
  replies: 0,
  createdAt: "2026-11-20T10:00:00+00:00",
  lastActivityAt: "2026-11-21T09:00:00+00:00",
  closedAt: null,
  academy: { id: "a1", name: "Lingo Academy" },
};

const detail: api.SupportRequestDetail = {
  request: { ...row, body: "Nothing shows.", attachments: [] },
  messages: [
    {
      id: "m0",
      side: "ADMIN",
      author: "Ahmed",
      body: "Probably the nightly roll.",
      internal: true,
      statusFrom: null,
      statusTo: null,
      attachments: [],
      createdAt: "2026-11-21T08:00:00+00:00",
    },
  ],
};

const counts: api.SupportInboxCounts = {
  NEW: 1,
  IN_PROGRESS: 0,
  WAITING: 0,
  DONE: 0,
  REJECTED: 0,
  CANCELLED: 0,
  OPEN: 1,
  CLOSED: 0,
  ALL: 1,
  UNREAD: 1,
  URGENT: 1,
};

const wrap = (props: { academyId?: string; academyName?: string } = {}) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions: ["platform.manage"] }))}>
      <ToastProvider>
        <SupportInbox {...props} />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

describe("SupportInbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/admin/support");
    vi.mocked(api.getSupportInbox).mockResolvedValue({ rows: [row], total: 1, page: 1, pageSize: 50, counts });
    vi.mocked(api.getSupportInboxRequest).mockResolvedValue(detail);
  });

  it("lists every client's requests, open first, and filters by status", async () => {
    const user = userEvent.setup();
    render(wrap());

    expect(await screen.findByText("Bills page is empty")).toBeInTheDocument();
    expect(screen.getByText("Lingo Academy")).toBeInTheDocument();
    expect(api.getSupportInbox).toHaveBeenLastCalledWith(expect.objectContaining({ status: "OPEN", academyId: undefined }));

    await user.click(screen.getByTestId("support-filter-UNREAD"));
    await waitFor(() => expect(api.getSupportInbox).toHaveBeenLastCalledWith(expect.objectContaining({ status: "UNREAD" })));
  });

  it("shows one client's whole history on its page", async () => {
    render(wrap({ academyId: "a1", academyName: "Lingo Academy" }));
    await screen.findByText("Bills page is empty");
    expect(api.getSupportInbox).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ALL", academyId: "a1" }));
    // The client is the page itself — not repeated on each row.
    expect(screen.queryByText("Lingo Academy")).not.toBeInTheDocument();
  });

  it("will not decline without a reason, then declines with one", async () => {
    const user = userEvent.setup();
    vi.mocked(api.respondSupportRequest).mockResolvedValue({
      ...detail,
      request: { ...detail.request, status: "REJECTED" },
    });
    render(wrap());

    await user.click(await screen.findByText("Bills page is empty"));
    expect(await screen.findByText("Probably the nightly roll.")).toBeInTheDocument();
    expect(screen.getByTestId("support-internal")).toBeInTheDocument();

    await user.click(screen.getByTestId("support-action-reject"));
    expect(await screen.findByText(T.needsWords.REJECTED)).toBeInTheDocument();
    expect(api.respondSupportRequest).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("support-admin-reply"), "Not something we can build.");
    await user.click(screen.getByTestId("support-action-reject"));
    await waitFor(() =>
      expect(api.respondSupportRequest).toHaveBeenCalledWith("r1", {
        body: "Not something we can build.",
        status: "REJECTED",
        internal: false,
        files: [],
      }),
    );
  });

  it("accepts in one press, and keeps an internal note away from the status moves", async () => {
    const user = userEvent.setup();
    vi.mocked(api.respondSupportRequest).mockResolvedValue({
      ...detail,
      request: { ...detail.request, status: "IN_PROGRESS" },
    });
    render(wrap());

    await user.click(await screen.findByText("Bills page is empty"));
    await user.click(await screen.findByTestId("support-action-accept"));
    await waitFor(() =>
      expect(api.respondSupportRequest).toHaveBeenCalledWith("r1", { body: "", status: "IN_PROGRESS", internal: false, files: [] }),
    );

    await user.click(screen.getByTestId("support-internal-toggle"));
    expect(screen.queryByTestId("support-action-ask")).not.toBeInTheDocument();
    await user.type(screen.getByTestId("support-admin-reply"), "Check the roll log.");
    await user.click(screen.getByTestId("support-admin-send"));
    await waitFor(() =>
      expect(api.respondSupportRequest).toHaveBeenLastCalledWith("r1", {
        body: "Check the roll log.",
        status: null,
        internal: true,
        files: [],
      }),
    );
  });
});
