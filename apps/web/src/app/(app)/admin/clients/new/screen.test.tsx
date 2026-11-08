import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../../messages/en.json";
import { NewClientScreen } from "./screen";

// Creating a client in three steps: the client, its owner, its subscription. A WhatsApp-only client
// skips the owner; video is not on offer anywhere.

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getAcademyTypes: vi.fn(),
  getPlatformSettings: vi.fn(),
  createAcademy: vi.fn(),
  setClientAgreement: vi.fn(),
  createWhatsappOnlyClient: vi.fn(),
}));

import * as api from "@/lib/api";

const wrap = () => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions: ["academy.create"] }))}>
      <ToastProvider>
        <NewClientScreen />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

describe("NewClientScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getAcademyTypes).mockResolvedValue({
      academyTypes: [
        { id: "t-quran", code: "QURAN", name: "Qur'an", description: null, reportFieldTemplate: [] },
        { id: "t-centre", code: "CENTRE", name: "Centre", description: null, reportFieldTemplate: [] },
      ],
    });
    vi.mocked(api.getPlatformSettings).mockResolvedValue({
      settings: { module_pricing: { MANAGEMENT: { price_minor: 99900, currency: "EGP" }, WHATSAPP: { price_minor: 20000, currency: "EGP" } } },
    } as never);
    vi.mocked(api.createAcademy).mockResolvedValue({ academyId: "new-1", ownerId: "o1", reportFields: 0 });
    vi.mocked(api.createWhatsappOnlyClient).mockResolvedValue({ clientId: "wa-1" });
  });

  it("offers no video anywhere: the client types are management, courses and WhatsApp", async () => {
    render(wrap());
    expect(await screen.findByTestId("kind-MANAGEMENT")).toBeInTheDocument();
    expect(screen.getByTestId("kind-LMS")).toBeInTheDocument();
    expect(screen.getByTestId("kind-WHATSAPP")).toBeInTheDocument();
    expect(screen.queryByTestId("kind-VIDEO")).toBeNull();
    expect(screen.getByTestId("new-client-screen")).not.toHaveTextContent(/video/i);
  });

  it("will not move on without a name, then walks the three steps and creates the academy", async () => {
    const user = userEvent.setup();
    render(wrap());
    await screen.findByTestId("school-CENTRE");

    await user.click(screen.getByTestId("create-next"));
    expect(screen.getByTestId("step-client")).toHaveTextContent("Required");

    await user.click(screen.getByTestId("school-QURAN"));
    await user.type(screen.getByTestId("create-name"), "Al-Noor Academy");
    await user.type(screen.getByTestId("create-subdomain"), "Al Noor!");
    expect(screen.getByTestId("create-subdomain")).toHaveValue("alnoor");
    await user.click(screen.getByTestId("create-next"));

    // Step 2: the owner.
    expect(screen.getByTestId("step-owner")).toBeInTheDocument();
    await user.type(screen.getByTestId("create-owner-name"), "Omar Salem");
    await user.type(screen.getByTestId("create-owner-phone"), "+20 100 123 4567");
    await user.type(screen.getByTestId("create-email"), "omar@alnoor.eg");
    await user.click(screen.getByTestId("create-generate"));
    expect((screen.getByTestId("create-password") as HTMLInputElement).value).toHaveLength(12);
    await user.click(screen.getByTestId("create-next"));

    // Step 3: the subscription — the platform's price pre-filled, yearly, WhatsApp on top, a 10-day trial, the modern look.
    expect(screen.getByTestId("create-price")).toHaveValue(999);
    await user.click(screen.getByTestId("create-interval-YEARLY"));
    await user.clear(screen.getByTestId("create-price"));
    await user.type(screen.getByTestId("create-price"), "12000");
    await user.click(screen.getByTestId("create-whatsapp"));
    await user.clear(screen.getByTestId("create-trial-days"));
    await user.type(screen.getByTestId("create-trial-days"), "10");
    await user.click(screen.getByTestId("create-modern"));

    expect(screen.getByTestId("create-summary")).toHaveTextContent("Al-Noor Academy");
    expect(screen.getByTestId("create-summary")).toHaveTextContent("10-day trial");

    await user.click(screen.getByTestId("create-submit"));

    await waitFor(() => expect(api.createAcademy).toHaveBeenCalled());
    expect(api.createAcademy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Al-Noor Academy",
        academy_type_id: "t-quran",
        client_type: "MANAGEMENT",
        status: "TRIAL",
        trial_days: 10,
        subdomain: "alnoor",
        email: "omar@alnoor.eg",
        owner_name: "Omar Salem",
        owner_phone: "+20 100 123 4567",
        enable_features: ["modern_look"],
        modules: [
          { module: "MANAGEMENT", price_minor: 1_200_000, billing_interval: "YEARLY" },
          { module: "WHATSAPP", price_minor: 20000, billing_interval: "YEARLY" },
        ],
      }),
    );
    expect(nav.push).toHaveBeenCalledWith("/admin/clients/new-1");
  });

  it("does not send the modern look switch for a centre, which always has it", async () => {
    const user = userEvent.setup();
    render(wrap());
    await user.click(await screen.findByTestId("school-CENTRE"));
    await user.type(screen.getByTestId("create-name"), "Lingo");
    await user.click(screen.getByTestId("create-next"));
    await user.type(screen.getByTestId("create-email"), "o@lingo.eg");
    await user.type(screen.getByTestId("create-password"), "longenough");
    await user.click(screen.getByTestId("create-next"));

    expect(screen.queryByTestId("create-modern")).toBeNull();
    await user.click(screen.getByTestId("start-paid"));
    await user.click(screen.getByTestId("create-submit"));

    await waitFor(() => expect(api.createAcademy).toHaveBeenCalled());
    const payload = vi.mocked(api.createAcademy).mock.calls[0]![0];
    expect(payload.academy_type_id).toBe("t-centre");
    expect(payload.status).toBe("ACTIVE");
    expect(payload.enable_features).toBeUndefined();
    expect(payload.trial_days).toBeUndefined();
    // Paying from today: its agreement goes into the accounts book at once, and the page opens on it.
    await waitFor(() => expect(api.setClientAgreement).toHaveBeenCalled());
    expect(vi.mocked(api.setClientAgreement).mock.calls[0]![1]).toMatchObject({
      plan: "MONTHLY",
      currency: "EGP",
      recurring: { amount_minor: 99900 },
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/clients/new-1?tab=subscription"));
  });

  it("creates a WhatsApp-only client in two steps, with no owner login", async () => {
    const user = userEvent.setup();
    render(wrap());
    await user.click(await screen.findByTestId("kind-WHATSAPP"));
    await user.type(screen.getByTestId("create-name"), "Sunrise Nursery");
    await user.click(screen.getByTestId("create-next"));

    expect(screen.queryByTestId("step-owner")).toBeNull();
    expect(screen.getByTestId("step-plan")).toBeInTheDocument();
    expect(screen.getByTestId("create-price")).toHaveValue(200);
    await user.click(screen.getByTestId("create-submit"));

    await waitFor(() =>
      expect(api.createWhatsappOnlyClient).toHaveBeenCalledWith({
        name: "Sunrise Nursery",
        mode: "trial",
        price_minor: 20000,
        billing_interval: "MONTHLY",
        trial_days: 5,
      }),
    );
    expect(api.createAcademy).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/admin/clients/wa-1");
  });
});
