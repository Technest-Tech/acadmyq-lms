import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import type { InvoiceRow } from "@/app/(app)/invoices/screen";
import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions";
import { makeSession, withAuth } from "@/test/auth";

const apiFetch = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const t = arMessages.invoices;

function row(over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1",
    kind: "MANUAL",
    payer_name: "زائر",
    payer_type: "STUDENT",
    period_month: 6,
    period_year: 2026,
    status: "OPEN",
    total_minor: 5000,
    amount_paid_minor: 0,
    currency: "EGP",
    public_token: "tok",
    created_at: "2026-06-11T10:00:00Z",
    guardian_name: null,
    children: [],
    needs_follow_up: false,
    can_delete: true,
    ...over,
  };
}

function renderActions(r: InvoiceRow, permissions: string[], onChanged = vi.fn()) {
  render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions }),
      <InvoiceRowActions row={r} onView={() => {}} onChanged={onChanged} />,
    ),
  );
  return onChanged;
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: t.actions }));
}

describe("InvoiceRowActions — delete a custom bill", () => {
  beforeEach(() => apiFetch.mockReset());

  it("deletes an unpaid custom bill after confirming, then refreshes the list", async () => {
    apiFetch.mockResolvedValue({ deleted: true });
    const onChanged = renderActions(row(), ["invoice.read", "invoice.create"]);

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: t.deleteInvoice }));
    expect(await screen.findByText(t.deleteHint)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("delete-invoice-confirm"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/invoices/inv-1", { method: "DELETE" });
  });

  it("shows why the API refused and keeps the bill", async () => {
    const { ApiError } = await import("@/lib/api");
    // Only the delete is refused — the auth shell reads through the same client.
    apiFetch.mockImplementation((_url: string, init?: { method?: string }) =>
      init?.method === "DELETE"
        ? Promise.reject(new ApiError(422, "Money was received on this bill. Void the receipt first, then delete it."))
        : Promise.resolve({}),
    );
    const onChanged = renderActions(row(), ["invoice.read", "invoice.create"]);

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: t.deleteInvoice }));
    await userEvent.click(await screen.findByTestId("delete-invoice-confirm"));

    expect(await screen.findByText(t.deleteRefused)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("offers no delete on a bill that cannot be deleted, or to someone who cannot raise bills", async () => {
    renderActions(row({ can_delete: false }), ["invoice.read", "invoice.create"]);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t.deleteInvoice })).not.toBeInTheDocument();
  });

  it("hides delete from a reader without invoice.create", async () => {
    renderActions(row(), ["invoice.read"]);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t.deleteInvoice })).not.toBeInTheDocument();
  });
});
