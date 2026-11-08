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

/** A client that signed in today and owes nothing: no usage signal of its own. */
const quietUsage = {
  owner_name: null,
  owner_phone: null,
  last_login_at: new Date().toISOString(),
  lessons_this_month: 12,
};

const isoDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Its account in the book: monthly at 999, next payment `days` from today (negative = late). */
const account = (days: number): api.AccountSummary => ({
  id: `acct-${days}`,
  plan: "MONTHLY",
  pay_token: null,
  recurring: { deal_id: "d", amount_minor: 99900, list_amount_minor: null, interval: "MONTHLY", currency: "EGP" },
  next_due_on: isoDay(days),
  next_due_minor: 99900,
  next_due_currency: "EGP",
  has_overdue: days < 0,
  overdue: days < 0 ? { EGP: 99900 } : {},
  outstanding: { EGP: 99900 },
  pending_proofs: 0,
  active_deals: 1,
});

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
          ...quietUsage,
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
          ...quietUsage,
          modules: [chip({ module: "WHATSAPP", plan_code: "WA_STANDARD" })],
        },
      ],
    });
  });

  it("renders one row per client with the modules it holds, by name", async () => {
    render(wrap(<ClientsScreen />, ["academy.read", "academy.create"]));

    expect(await screen.findByText("Bright Steps Center")).toBeInTheDocument();
    expect(screen.getByText("Sunrise Nursery")).toBeInTheDocument();

    // Bright Steps holds MANAGEMENT (paid) and VIDEO (on trial); what it does not hold is not listed.
    const row = screen.getByTestId("client-row-c1");
    expect(
      row.querySelector('[data-module="MANAGEMENT"][data-state="active"]'),
    ).not.toBeNull();
    expect(
      row.querySelector('[data-module="VIDEO"][data-state="trial"]'),
    ).not.toBeNull();
    expect(row.querySelector('[data-module="WHATSAPP"]')).toBeNull();
    expect(row).toHaveTextContent("Management");
  });

  it("says in words what is about to happen, and counts it under Needs follow-up", async () => {
    render(wrap(<ClientsScreen />, ["academy.read"]));
    await screen.findByText("Bright Steps Center");

    // The video trial ends in 3 days: a warning on the row, and one client to follow up.
    expect(screen.getByTestId("client-row-c1")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByTestId("client-row-c1")).toHaveTextContent("Video trial ends in 3 days");
    expect(screen.getByTestId("segment-ATTENTION")).toHaveTextContent("1");
    expect(screen.getByTestId("segment-ALL")).toHaveTextContent("2");
  });

  it("narrows the roster to a tile, and puts the most urgent client first", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listClients).mockResolvedValue({
      clients: [
        {
          id: "calm",
          name: "Aaa Calm Academy",
          client_type: "MANAGEMENT",
          status: "ACTIVE",
          suspended_reason: null,
          default_currency: "EGP",
          timezone: "Africa/Cairo",
          subdomain: null,
          created_at: "2026-01-01T00:00:00Z",
          owner_email: "calm@x.eg",
          student_count: 5,
          teacher_count: 1,
          ...quietUsage,
          modules: [chip({ current_period_end: new Date(Date.now() + 40 * 86_400_000).toISOString() })],
        },
        {
          id: "late",
          name: "Zzz Late Academy",
          client_type: "MANAGEMENT",
          status: "ACTIVE",
          suspended_reason: null,
          default_currency: "EGP",
          timezone: "Africa/Cairo",
          subdomain: null,
          created_at: "2026-02-01T00:00:00Z",
          owner_email: "late@x.eg",
          student_count: 50,
          teacher_count: 4,
          ...quietUsage,
          modules: [chip({})],
          account: account(-12),
        },
      ],
    });
    render(wrap(<ClientsScreen />, ["academy.read"]));
    await screen.findByText("Zzz Late Academy");

    // A late payment first, though its name sorts last.
    const order = screen.getAllByTestId(/^client-row-/).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["client-row-late", "client-row-calm"]);
    expect(screen.getByTestId("client-row-late")).toHaveTextContent("Payment 12 days late");

    await user.click(screen.getByTestId("segment-ATTENTION"));
    expect(screen.getByText("Zzz Late Academy")).toBeInTheDocument();
    expect(screen.queryByText("Aaa Calm Academy")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("segment-ALL"));
    await user.selectOptions(screen.getByTestId("clients-sort"), "NAME");
    const byName = screen.getAllByTestId(/^client-row-/).map((el) => el.getAttribute("data-testid"));
    expect(byName).toEqual(["client-row-calm", "client-row-late"]);
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

describe("ClientsScreen — is the client using the system?", () => {
  const base = {
    client_type: "MANAGEMENT" as const,
    status: "ACTIVE" as const,
    suspended_reason: null,
    default_currency: "EGP",
    timezone: "Africa/Cairo",
    subdomain: null,
    created_at: "2026-01-01T00:00:00Z",
    owner_email: "x@x.eg",
    student_count: 10,
    teacher_count: 2,
    modules: [chip({ current_period_end: new Date(Date.now() + 40 * 86_400_000).toISOString() })],
  };

  it("puts a late payment and a client nobody signs in to under Needs follow-up, loudest first", async () => {
    vi.mocked(api.listClients).mockResolvedValue({
      clients: [
        { ...base, ...quietUsage, id: "fine", name: "Fine Academy" },
        {
          ...base,
          ...quietUsage,
          id: "quiet",
          name: "Quiet Academy",
          last_login_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        },
        {
          ...base,
          ...quietUsage,
          id: "owing",
          name: "Owing Academy",
          account: account(-3),
        },
      ],
    });
    render(wrap(<ClientsScreen />, ["academy.read"]));
    await screen.findByText("Owing Academy");

    expect(screen.getByTestId("client-row-owing")).toHaveAttribute("data-tone", "crit");
    expect(screen.getByTestId("client-row-owing")).toHaveTextContent("Payment 3 days late");
    expect(screen.getByTestId("client-row-quiet")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByTestId("client-row-quiet")).toHaveTextContent("No sign-in for 30 days");
    expect(screen.getByTestId("client-row-fine")).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByTestId("segment-ATTENTION")).toHaveTextContent("2");

    const order = screen.getAllByTestId(/^client-row-/).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["client-row-owing", "client-row-quiet", "client-row-fine"]);
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
    // WHATSAPP is off → an enable action. Video is retired: never offered to a client without it.
    // A management client never offers Courses.
    expect(screen.getByTestId("enable-WHATSAPP")).toBeInTheDocument();
    expect(screen.queryByTestId("module-row-VIDEO")).not.toBeInTheDocument();
    expect(screen.queryByTestId("module-row-LMS")).not.toBeInTheDocument();
  });

  it("turns a module on, keeping the platform's default price as the agreement's starting point", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(
      wrap(
        <ModulesCard
          clientId="c1"
          clientType="MANAGEMENT"
          modules={modules}
          currency="EGP"
          defaultPricing={{ WHATSAPP: { price_minor: 40000, currency: "EGP" } }}
          onChanged={onChanged}
        />,
        ["academy_billing.manage"],
      ),
    );

    await user.click(screen.getByTestId("enable-WHATSAPP"));
    const form = screen.getByTestId("enable-form-WHATSAPP");
    await user.click(within(form).getByRole("button", { name: "Enable…" }));

    await waitFor(() =>
      expect(api.enableClientModule).toHaveBeenCalledWith("c1", "WHATSAPP", {
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

    expect(screen.queryByTestId("enable-WHATSAPP")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
  });

  it("keeps a retired module on the card for a client that still holds it, and a hand-sold one", () => {
    const held: api.ModuleSubscription[] = [
      ...modules,
      { ...(modules[0] as api.ModuleSubscription), id: "ms2", module: "VIDEO", is_trial: false },
      { ...(modules[0] as api.ModuleSubscription), id: "ms3", module: "LMS", is_trial: false },
    ];
    render(
      wrap(
        <ModulesCard clientId="c1" clientType="MANAGEMENT" modules={held} currency="EGP" onChanged={vi.fn()} />,
        ["academy_billing.manage"],
      ),
    );
    expect(screen.getByTestId("module-row-VIDEO")).toBeInTheDocument();
    expect(screen.getByTestId("module-row-LMS")).toBeInTheDocument();
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

  it("keeps an opt-in feature off until it is switched on, and saves it as `enabled`", async () => {
    const user = userEvent.setup();
    const withOptIn: api.ClientFeatureCatalog = {
      ...catalog,
      modules: {
        MANAGEMENT: {
          capabilities: { ...catalog.modules.MANAGEMENT!.capabilities, accounting: "Accounting" },
          limits: { maxStudents: "Max students" },
          opt_in: ["accounting"],
        },
      },
    };
    render(
      wrap(<FeaturesCard clientId="c1" catalog={withOptIn} modules={[sub]} onChanged={vi.fn()} />, ["academy_billing.manage"]),
    );

    // Nobody switched it on, so it is off — and that is not counted as a decision about the client.
    expect(screen.getByTestId("feature-accounting")).not.toBeChecked();

    await user.click(screen.getByTestId("feature-accounting"));
    await user.click(screen.getByTestId("save-MANAGEMENT"));

    await waitFor(() =>
      expect(api.updateClientModuleFeatures).toHaveBeenCalledWith("c1", "MANAGEMENT", {
        disabled: ["certificates"],
        enabled: ["accounting"],
        limits: { maxStudents: 120 },
      }),
    );
  });
});
