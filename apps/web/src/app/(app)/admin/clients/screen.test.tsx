import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { FeaturesCard } from "@/components/clients/features-card";
import { ModulesCard } from "@/components/clients/modules-card";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../messages/en.json";
import { ClientsScreen } from "./screen";

// 05-MODULES-NOT-PACKAGES: the client roster shows one row per client with the module chips its
// TYPE can fill; the Modules card is the one writer for enable / price / trial / activate / pause;
// the Features card is where a single feature gets switched off for one client.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listClients: vi.fn(),
  enableClientModule: vi.fn(),
  updateClientModuleFeatures: vi.fn(),
  extendClientModuleTrial: vi.fn(),
  activateClientModule: vi.fn(),
  pauseClientModule: vi.fn(),
  endClientModule: vi.fn(),
}));

import * as api from "@/lib/api";

const wrap = (node: React.ReactNode, permissions: string[]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider
      value={authValue(makeSession("SUPER_ADMIN", { permissions }))}
    >
      <ToastProvider>{node}</ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

const chip = (over: Partial<api.ClientModuleChip>): api.ClientModuleChip => ({
  module: "MANAGEMENT",
  status: "ACTIVE",
  is_trial: false,
  trial_end: null,
  plan_id: "p1",
  plan_code: "PRO",
  plan_name: "Pro",
  billing_interval: "MONTHLY",
  current_period_end: null,
  total_cost_minor: 99900,
  currency: "EGP",
  ...over,
});

describe("ClientsScreen (the client hub)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listClients).mockResolvedValue({
      clients: [
        {
          id: "c1",
          name: "Bright Steps Center",
          client_type: "MANAGEMENT",
          status: "ACTIVE",
          suspended_reason: null,
          default_currency: "EGP",
          timezone: "Africa/Cairo",
          subdomain: "bright",
          created_at: "2026-03-01T00:00:00Z",
          owner_email: "owner@bright.eg",
          student_count: 210,
          teacher_count: 12,
          modules: [
            chip({}),
            chip({
              module: "VIDEO",
              is_trial: true,
              trial_end: new Date(Date.now() + 3 * 86_400_000).toISOString(),
              plan_code: "MEET",
              plan_name: "Meet",
              total_cost_minor: 40000,
            }),
          ],
        },
        {
          id: "c2",
          name: "Sunrise Nursery",
          client_type: "WHATSAPP",
          status: "TRIAL",
          suspended_reason: null,
          default_currency: "EGP",
          timezone: "Africa/Cairo",
          subdomain: null,
          created_at: "2026-07-01T00:00:00Z",
          owner_email: null,
          student_count: 0,
          teacher_count: 0,
          modules: [chip({ module: "WHATSAPP", plan_code: "WA_STANDARD" })],
        },
      ],
    });
  });

  it("renders one row per client with its module chips", async () => {
    render(wrap(<ClientsScreen />, ["academy.read", "academy.create"]));

    expect(await screen.findByText("Bright Steps Center")).toBeInTheDocument();
    expect(screen.getByText("Sunrise Nursery")).toBeInTheDocument();

    // Bright Steps is a management client: MANAGEMENT active + VIDEO trial on, WHATSAPP off.
    const row = screen.getByTestId("client-row-c1");
    expect(
      row.querySelector('[data-module="MANAGEMENT"][data-state="active"]'),
    ).not.toBeNull();
    expect(
      row.querySelector('[data-module="VIDEO"][data-state="trial"]'),
    ).not.toBeNull();
    expect(
      row.querySelector('[data-module="WHATSAPP"][data-state="off"]'),
    ).not.toBeNull();
  });

  it("filters by module", async () => {
    const user = userEvent.setup();
    render(wrap(<ClientsScreen />, ["academy.read"]));
    await screen.findByText("Bright Steps Center");

    await user.click(screen.getByRole("button", { name: "WhatsApp" }));

    expect(screen.queryByText("Bright Steps Center")).not.toBeInTheDocument();
    expect(screen.getByText("Sunrise Nursery")).toBeInTheDocument();
  });
});

describe("ModulesCard (the one writer)", () => {
  const modules: api.ModuleSubscription[] = [
    {
      id: "ms1",
      module: "MANAGEMENT",
      status: "ACTIVE",
      is_trial: true,
      trial_start: new Date().toISOString(),
      trial_end: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      activated_at: null,
      current_period_start: null,
      current_period_end: null,
      billing_interval: "MONTHLY",
      base_price_minor: 99900,
      addons_price_minor: 0,
      total_cost_minor: 99900,
      currency: "EGP",
      overrides: null,
      plan_id: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    const subscription = modules[0] as api.ModuleSubscription;
    vi.mocked(api.enableClientModule).mockResolvedValue({ subscription });
    vi.mocked(api.extendClientModuleTrial).mockResolvedValue({ subscription });
  });

  it("shows one row per module the client type allows, with enable actions for the empty ones", () => {
    render(
      wrap(
        <ModulesCard
          clientId="c1"
          clientType="MANAGEMENT"
          modules={modules}
          currency="EGP"
          onChanged={vi.fn()}
        />,
        ["academy_billing.manage"],
      ),
    );

    expect(screen.getByTestId("module-row-MANAGEMENT")).toHaveTextContent(
      "Trial · 3 days left",
    );
    // VIDEO + WHATSAPP are off → enable actions. A management client never offers Courses.
    expect(screen.getByTestId("enable-VIDEO")).toBeInTheDocument();
    expect(screen.getByTestId("enable-WHATSAPP")).toBeInTheDocument();
    expect(screen.queryByTestId("module-row-LMS")).not.toBeInTheDocument();
  });

  it("sells a module at the price typed for this client", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(
      wrap(
        <ModulesCard
          clientId="c1"
          clientType="MANAGEMENT"
          modules={modules}
          currency="EGP"
          defaultPricing={{ VIDEO: { price_minor: 40000, currency: "EGP" } }}
          onChanged={onChanged}
        />,
        ["academy_billing.manage"],
      ),
    );

    await user.click(screen.getByTestId("enable-VIDEO"));
    const form = screen.getByTestId("enable-form-VIDEO");
    await user.click(within(form).getByRole("button", { name: "Enable…" }));

    await waitFor(() =>
      expect(api.enableClientModule).toHaveBeenCalledWith("c1", "VIDEO", {
        mode: "trial",
        price_minor: 40000, // pre-filled from the platform default
        currency: "EGP",
        billing_interval: "MONTHLY",
        trial_days: 5,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("hides all write actions without academy_billing.manage", () => {
    render(
      wrap(
        <ModulesCard
          clientId="c1"
          clientType="MANAGEMENT"
          modules={modules}
          currency="EGP"
          onChanged={vi.fn()}
        />,
        ["academy.read"],
      ),
    );

    expect(screen.queryByTestId("enable-VIDEO")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
  });
});

describe("FeaturesCard (switching a feature off for one client)", () => {
  const catalog: api.ClientFeatureCatalog = {
    clientType: "MANAGEMENT",
    allowedModules: ["MANAGEMENT", "VIDEO", "WHATSAPP"],
    modules: {
      MANAGEMENT: {
        capabilities: {
          invoicing: "Invoice management & billing",
          certificates: "Student certificates",
        },
        limits: { maxStudents: "Max students" },
      },
    },
  };

  const sub: api.ModuleSubscription = {
    id: "ms1",
    module: "MANAGEMENT",
    status: "ACTIVE",
    is_trial: false,
    trial_start: null,
    trial_end: null,
    activated_at: null,
    current_period_start: null,
    current_period_end: null,
    billing_interval: "MONTHLY",
    base_price_minor: 99900,
    addons_price_minor: 0,
    total_cost_minor: 99900,
    currency: "EGP",
    overrides: { disabled: ["certificates"], limits: { maxStudents: 120 } },
    plan_id: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.updateClientModuleFeatures).mockResolvedValue({ subscription: sub });
  });

  it("reflects what is switched off and saves a change", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(
      wrap(
        <FeaturesCard clientId="c1" catalog={catalog} modules={[sub]} onChanged={onChanged} />,
        ["academy_billing.manage"],
      ),
    );

    // Everything the module owns is listed; only what we switched off is unchecked.
    expect(screen.getByTestId("feature-invoicing")).toBeChecked();
    expect(screen.getByTestId("feature-certificates")).not.toBeChecked();
    expect(screen.getByTestId("cap-maxStudents")).toHaveValue(120);

    await user.click(screen.getByTestId("feature-invoicing"));
    await user.click(screen.getByTestId("save-MANAGEMENT"));

    await waitFor(() =>
      expect(api.updateClientModuleFeatures).toHaveBeenCalledWith("c1", "MANAGEMENT", {
        disabled: ["certificates", "invoicing"],
        limits: { maxStudents: 120 },
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });
});
