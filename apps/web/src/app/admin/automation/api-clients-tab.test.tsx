import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { AutomationOverviewRow } from "@/lib/api";
import { getAutomationOverview } from "@/lib/api";
import enMessages from "../../../../messages/en.json";
import { ApiClientsTab } from "./api-clients-tab";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getAutomationOverview: vi.fn(),
}));

function row(overrides: Partial<AutomationOverviewRow> = {}): AutomationOverviewRow {
  return {
    academy_id: "a1",
    academy_name: "Noor Academy",
    academy_status: "ACTIVE",
    type1_billing_enabled: false,
    type2_lessons_enabled: false,
    has_token: true,
    wasender_session_status: "connected",
    sent_count: 0,
    failed_count: 0,
    skipped_count: 0,
    api_key_count: 2,
    ...overrides,
  };
}

function renderTab(academies: AutomationOverviewRow[]) {
  vi.mocked(getAutomationOverview).mockResolvedValue({ academies });
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ApiClientsTab />
    </NextIntlClientProvider>,
  );
}

describe("ApiClientsTab (docs/whatsapp-api)", () => {
  it("lists clients with their API-key count", async () => {
    renderTab([row({ academy_name: "Noor Academy", api_key_count: 2 })]);

    const tr = (await screen.findByText("Noor Academy")).closest("tr")!;
    expect(tr).toHaveTextContent("2");
  });

  it("filters to clients that have keys", async () => {
    renderTab([
      row({ academy_id: "a1", academy_name: "Has Keys", api_key_count: 3 }),
      row({ academy_id: "a2", academy_name: "No Keys", api_key_count: 0 }),
    ]);

    await screen.findByText("Has Keys");
    expect(screen.getByText("No Keys")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(enMessages.adminAutomation.apiClients.onlyWithKeys));

    await waitFor(() => expect(screen.queryByText("No Keys")).not.toBeInTheDocument());
    expect(screen.getByText("Has Keys")).toBeInTheDocument();
  });
});
