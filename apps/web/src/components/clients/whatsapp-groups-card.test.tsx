import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { ClientWhatsappGroupsCard } from "./whatsapp-groups-card";

// WhatsApp group alerts on the client page: linked groups with what each receives and whether each
// alert reached the group; linking picks a group the number is really in; "Send test" follows the
// test alert until WhatsApp confirms delivery.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getWhatsAppGroups: vi.fn(),
  getAvailableWhatsAppGroups: vi.fn(),
  linkWhatsAppGroup: vi.fn(),
  updateWhatsAppGroup: vi.fn(),
  unlinkWhatsAppGroup: vi.fn(),
  testWhatsAppGroup: vi.fn(),
  getWhatsAppGroupAlerts: vi.fn(),
  whatsappStatus: vi.fn(),
}));

import * as api from "@/lib/api";

const catalog: api.WhatsAppGroupCatalog = {
  categories: {
    SUPERVISION: ["SESSION_STARTED", "SESSION_NOT_MARKED", "REPORT_OVERDUE"],
    ACCOUNTING: ["PACKAGE_LOW", "PACKAGE_ENDED", "PAYMENT_RECEIVED"],
  },
  default_settings: { not_marked_after_minutes: 15, report_overdue_hours: 2 },
  setting_bounds: { not_marked_after_minutes: [1, 240], report_overdue_hours: [1, 72] },
  max_attempts: 5,
};

const alert = (over: Partial<api.WhatsAppGroupAlert>): api.WhatsAppGroupAlert => ({
  id: "a1",
  group_id: "g1",
  event_type: "SESSION_NOT_MARKED",
  status: "DELIVERED",
  attempts: 1,
  error: null,
  payload: { teacher: "Mona", student: "Omar" },
  due_at: "2026-09-14T13:00:00+00:00",
  queued_at: "2026-09-14T13:00:05+00:00",
  sent_at: "2026-09-14T13:00:20+00:00",
  delivered_at: "2026-09-14T13:00:25+00:00",
  read_at: null,
  created_at: "2026-09-14T13:00:01+00:00",
  ...over,
});

const supervision: api.WhatsAppGroup = {
  id: "g1",
  jid: "120363111@g.us",
  name: "Supervision team",
  label: "Supervision",
  language: "ar",
  events: ["SESSION_STARTED", "SESSION_NOT_MARKED"],
  settings: { not_marked_after_minutes: 10, report_overdue_hours: 2 },
  is_active: true,
  created_at: "2026-09-01T10:00:00+00:00",
  last_24h: { DELIVERED: 4, FAILED: 1 },
  recent: [alert({}), alert({ id: "a2", event_type: "PAYMENT_RECEIVED", status: "FAILED", attempts: 3, error: "http_409", payload: { amount_minor: 150000, currency: "EGP", payer: "Hassan" } })],
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    {node}
  </NextIntlClientProvider>
);

describe("ClientWhatsappGroupsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWhatsAppGroups).mockResolvedValue({ groups: [supervision], catalog });
    vi.mocked(api.whatsappStatus).mockResolvedValue({ state: "connected" } as api.WhatsAppStatus);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows each group's alerts, timings and whether recent alerts reached it", async () => {
    render(wrap(<ClientWhatsappGroupsCard clientId="c1" />));

    const row = await screen.findByTestId("wa-group-g1");
    expect(within(row).getByText("Supervision team")).toBeInTheDocument();
    expect(within(row).getByText("Attendance not marked (10 min)")).toBeInTheDocument();
    expect(within(row).getByText("Last 24h: 4 sent · 1 failed · 0 waiting")).toBeInTheDocument();
    expect(within(row).getByText("Delivered")).toBeInTheDocument();
    expect(within(row).getByText("Failed ×3")).toBeInTheDocument();
    expect(within(row).getByText(/Mona → Omar/)).toBeInTheDocument();
  });

  it("links one of the number's groups with the supervision preset", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAvailableWhatsAppGroups).mockResolvedValue({
      groups: [
        { id: "120363222@g.us", subject: "Teachers room", size: 12, announce: false, is_admin: false, can_send: true, linked: false },
        { id: "120363333@g.us", subject: "Owners only", size: 3, announce: true, is_admin: false, can_send: false, linked: false },
      ],
    });
    vi.mocked(api.linkWhatsAppGroup).mockResolvedValue({ group: supervision });

    render(wrap(<ClientWhatsappGroupsCard clientId="c1" />));
    await user.click(await screen.findByTestId("wa-group-link"));

    const dialog = await screen.findByRole("dialog");
    // An admins-only group the number cannot post to is not pickable.
    expect(await within(dialog).findByText("Admins only — can't post")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /Owners only/ })).toBeDisabled();

    await user.click(within(dialog).getByRole("radio", { name: /Teachers room/ }));
    await user.click(within(dialog).getByRole("button", { name: "Supervision preset" }));
    expect(within(dialog).getByTestId("wa-event-REPORT_OVERDUE")).toBeChecked();
    expect(within(dialog).getByTestId("wa-event-PAYMENT_RECEIVED")).not.toBeChecked();

    const hours = within(dialog).getByLabelText("hours");
    await user.clear(hours);
    await user.type(hours, "3");
    await user.click(within(dialog).getByTestId("wa-group-save"));

    await waitFor(() =>
      expect(api.linkWhatsAppGroup).toHaveBeenCalledWith("c1", {
        jid: "120363222@g.us",
        label: "Supervision",
        language: "ar",
        events: ["SESSION_STARTED", "SESSION_NOT_MARKED", "REPORT_OVERDUE"],
        settings: { not_marked_after_minutes: 15, report_overdue_hours: 3 },
      }),
    );
  });

  it("follows a test message until WhatsApp confirms it reached the group", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(api.testWhatsAppGroup).mockResolvedValue({
      ok: true,
      error: null,
      alert: alert({ id: "t1", event_type: "TEST", status: "QUEUED", sent_at: null, delivered_at: null }),
    });
    vi.mocked(api.getWhatsAppGroupAlerts).mockResolvedValue({
      alerts: [alert({ id: "t1", event_type: "TEST", status: "DELIVERED" })],
    });

    render(wrap(<ClientWhatsappGroupsCard clientId="c1" />));
    await user.click(within(await screen.findByTestId("wa-group-g1")).getByTestId("wa-group-test"));

    expect(await screen.findByText("Test handed to WhatsApp — waiting for confirmation…")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(await screen.findByText("Delivered — the test reached the group.")).toBeInTheDocument();
    expect(api.getWhatsAppGroupAlerts).toHaveBeenCalledWith("c1", "g1", 10);
  });
});
