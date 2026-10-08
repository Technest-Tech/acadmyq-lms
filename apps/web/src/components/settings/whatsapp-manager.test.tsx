import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { WhatsAppManager } from "./whatsapp-manager";

// Settings → WhatsApp: the academy links its own number. Connected shows the number; not connected
// offers Connect, which shows the QR and watches until the phone links; unlinking asks first.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getAcademyWhatsApp: vi.fn(),
  connectAcademyWhatsApp: vi.fn(),
  logoutAcademyWhatsApp: vi.fn(),
}));

import * as api from "@/lib/api";

const wa = (over: Partial<api.AcademyWhatsApp>): api.AcademyWhatsApp => ({
  state: "disconnected",
  qr: null,
  phone: null,
  last_connected_at: null,
  ...over,
});

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    {node}
  </NextIntlClientProvider>
);

describe("WhatsAppManager", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows the linked number when connected", async () => {
    vi.mocked(api.getAcademyWhatsApp).mockResolvedValue(wa({ state: "connected", phone: "201090091143" }));
    render(wrap(<WhatsAppManager />));

    expect(await screen.findByTestId("whatsapp-connected")).toBeInTheDocument();
    expect(screen.getByText("+201090091143")).toBeInTheDocument();
    expect(screen.queryByTestId("whatsapp-connect")).not.toBeInTheDocument();
  });

  it("pairs by QR and stops watching once the phone links", { timeout: 10_000 }, async () => {
    vi.mocked(api.getAcademyWhatsApp).mockResolvedValueOnce(wa({ state: "logged_out" }));
    vi.mocked(api.connectAcademyWhatsApp).mockResolvedValue(wa({ state: "qr", qr: "data:image/png;base64,QR" }));
    render(wrap(<WhatsAppManager />));

    await userEvent.click(await screen.findByTestId("whatsapp-connect"));
    expect(await screen.findByAltText("WhatsApp pairing code")).toHaveAttribute("src", "data:image/png;base64,QR");

    // The next poll (every 3s) finds the phone linked.
    vi.mocked(api.getAcademyWhatsApp).mockResolvedValue(wa({ state: "connected", phone: "201000000000" }));
    await waitFor(() => expect(screen.getByTestId("whatsapp-connected")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("+201000000000")).toBeInTheDocument();
  });

  it("shows a QR that is already waiting without pressing Connect", async () => {
    vi.mocked(api.getAcademyWhatsApp).mockResolvedValue(wa({ state: "qr", qr: "data:image/png;base64,OLD" }));
    render(wrap(<WhatsAppManager />));

    expect(await screen.findByAltText("WhatsApp pairing code")).toHaveAttribute("src", "data:image/png;base64,OLD");
    expect(api.connectAcademyWhatsApp).not.toHaveBeenCalled();
  });

  it("asks before unlinking the number", async () => {
    vi.mocked(api.getAcademyWhatsApp).mockResolvedValue(wa({ state: "connected", phone: "201090091143" }));
    vi.mocked(api.logoutAcademyWhatsApp).mockResolvedValue(wa({ state: "disconnected" }));
    render(wrap(<WhatsAppManager />));

    await userEvent.click(await screen.findByRole("button", { name: "Unlink number" }));
    expect(api.logoutAcademyWhatsApp).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("whatsapp-unlink-confirm"));
    await waitFor(() => expect(api.logoutAcademyWhatsApp).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("whatsapp-disconnected")).toBeInTheDocument();
  });
});
