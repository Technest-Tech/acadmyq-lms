import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { ParentPortalCard } from "./parent-portal-card";

vi.mock("@/lib/portal-api", () => ({
  getPortalLink: vi.fn(),
  issuePortalLink: vi.fn(),
  revokePortalLink: vi.fn(),
  sendPortalLink: vi.fn(),
}));

import * as portal from "@/lib/portal-api";

const URL_ = "https://nour.acadmyq.com/p/AbCdEf123";

function renderCard({ edit = true, active = true }: { edit?: boolean; active?: boolean } = {}) {
  const permissions = edit ? ["guardian.read", "guardian.update"] : ["guardian.read"];
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}>
        <ParentPortalCard guardianId="g1" active={active} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("ParentPortalCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portal.getPortalLink).mockResolvedValue({ url: null, issued_at: null });
  });

  it("sends the link on WhatsApp from a family that has none yet, and then shows it", async () => {
    vi.mocked(portal.sendPortalLink).mockResolvedValue({
      url: URL_,
      phone: "+201001112223",
      message: "…",
      transport: "WASENDER",
      sent: true,
    });
    renderCard();

    await userEvent.click(await screen.findByTestId("parent-portal-send"));

    expect(portal.sendPortalLink).toHaveBeenCalledWith("g1");
    expect(await screen.findByTestId("parent-portal-notice")).toHaveTextContent("Link sent to +201001112223");
    expect(screen.getByTestId("parent-portal-url")).toHaveTextContent(URL_);
  });

  it("opens wa.me with the message when the academy's WhatsApp is not connected", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(portal.sendPortalLink).mockResolvedValue({
      url: URL_,
      phone: "+201001112223",
      message: "Hello",
      transport: "DEEPLINK",
      sent: false,
    });
    renderCard();

    await userEvent.click(await screen.findByTestId("parent-portal-send"));

    await waitFor(() => expect(open).toHaveBeenCalledWith("https://wa.me/201001112223?text=Hello", "_blank", "noopener,noreferrer"));
    open.mockRestore();
  });

  it("replaces the link only after confirming", async () => {
    vi.mocked(portal.getPortalLink).mockResolvedValue({ url: URL_, issued_at: "2026-06-01T10:00:00Z" });
    vi.mocked(portal.issuePortalLink).mockResolvedValue({ url: `${URL_}X`, issued_at: "2026-06-17T10:00:00Z" });
    renderCard();

    await userEvent.click(await screen.findByTestId("parent-portal-rotate"));
    expect(portal.issuePortalLink).not.toHaveBeenCalled();
    expect(screen.getByTestId("parent-portal-confirm")).toHaveTextContent("The old link stops working");

    await userEvent.click(screen.getByRole("button", { name: "Yes" }));

    expect(portal.issuePortalLink).toHaveBeenCalledWith("g1", true);
    await waitFor(() => expect(screen.getByTestId("parent-portal-url")).toHaveTextContent(`${URL_}X`));
  });

  it("lets someone who can only read the family copy the link, not send or change it", async () => {
    vi.mocked(portal.getPortalLink).mockResolvedValue({ url: URL_, issued_at: null });
    renderCard({ edit: false });

    expect(await screen.findByTestId("parent-portal-url")).toHaveTextContent(URL_);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByTestId("parent-portal-send")).toBeNull();
    expect(screen.queryByTestId("parent-portal-rotate")).toBeNull();
    expect(screen.queryByTestId("parent-portal-revoke")).toBeNull();
  });

  it("asks to reactivate an inactive family first", async () => {
    renderCard({ active: false });

    expect(await screen.findByText("Reactivate the family to use the parent page.")).toBeInTheDocument();
    expect(screen.queryByTestId("parent-portal-send")).toBeNull();
  });
});
