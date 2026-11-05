import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import type { ReceiptDetail } from "@/lib/accounting-api";
import { makeSession, withAuth } from "@/test/auth";
import { ReceiptDetailModal } from "./receipt-detail-modal";

/**
 * Correcting a receipt (Lingo 2026-11-05): "cash" that came by InstaPay, the wrong day. Method, day,
 * reference and note change in place; the amount never does; a new non-cash method wants its picture.
 */
const api = { getReceipt: vi.fn(), amendReceipt: vi.fn() };
vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getReceipt: (...a: unknown[]) => api.getReceipt(...a),
  amendReceipt: (...a: unknown[]) => api.amendReceipt(...a),
}));

function receipt(over: Partial<ReceiptDetail> = {}): ReceiptDetail {
  return {
    id: "r1", number: "R-000007", received_on: "2026-11-05", created_at: "2026-11-05T10:00:00Z",
    payer_name: null, payer_kind: "GUARDIAN", guardian_id: "g1", student_id: null,
    amount_minor: 60000, allocated_minor: 60000, currency: "EGP", method: "CASH", reference: null, source: "MANUAL",
    received_by_name: "Desk", voided: false, void_reason: null, groups: [],
    note: null, has_proof: false, payer: { name: "Umm Adam", phone: null } as ReceiptDetail["payer"],
    public_url: "https://x/r/abc", unallocated_minor: 0, voided_at: null, voided_by_name: null,
    allocations: [], balance_after: [], can_void: true, can_amend: true,
    ...over,
  };
}

const owner = () => makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "receipt.void"], capabilities: ["accounting"] });
const ar = arMessages.accounting;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
});

describe("ReceiptDetailModal — correcting a receipt", () => {
  it("moves a cash receipt to InstaPay with its picture and a new day, and says so", async () => {
    const user = userEvent.setup();
    api.getReceipt.mockResolvedValue({ receipt: receipt() });
    api.amendReceipt.mockResolvedValue({ receipt: receipt({ method: "INSTAPAY", received_on: "2026-11-04", has_proof: true }) });
    render(withAuth(owner(), <ReceiptDetailModal receiptId="r1" onClose={() => {}} />));

    await user.click(await screen.findByTestId("receipt-amend"));
    await user.selectOptions(screen.getByTestId("amend-method"), "INSTAPAY");
    // A new non-cash method without a picture on file cannot be saved yet.
    expect(screen.getByTestId("amend-save")).toBeDisabled();
    const file = new File(["x"], "p.png", { type: "image/png" });
    await user.upload(screen.getByTestId("amend-proof"), file);
    await user.clear(screen.getByTestId("amend-date"));
    await user.type(screen.getByTestId("amend-date"), "2026-11-04");
    await user.type(screen.getByTestId("amend-reference"), "IP-9");
    await user.click(screen.getByTestId("amend-save"));

    await waitFor(() =>
      expect(api.amendReceipt).toHaveBeenCalledWith("r1", { method: "INSTAPAY", received_on: "2026-11-04", reference: "IP-9", note: "", proof: file }),
    );
    expect(await screen.findByText(ar.amend.saved)).toBeTruthy();
    expect(screen.queryByTestId("amend-receipt")).toBeNull();
  });

  it("keeps a card receipt's method and day: only the words change", async () => {
    const user = userEvent.setup();
    api.getReceipt.mockResolvedValue({ receipt: receipt({ source: "GATEWAY", method: "CARD" }) });
    render(withAuth(owner(), <ReceiptDetailModal receiptId="r1" onClose={() => {}} />));
    await user.click(await screen.findByTestId("receipt-amend"));
    expect(screen.getByTestId("amend-method")).toBeDisabled();
    expect(screen.getByTestId("amend-date")).toBeDisabled();
    expect(screen.getByText(ar.amend.historyHint)).toBeTruthy();
  });

  it("shows no edit button when the receipt cannot be amended", async () => {
    api.getReceipt.mockResolvedValue({ receipt: receipt({ can_amend: false, can_void: false }) });
    render(withAuth(owner(), <ReceiptDetailModal receiptId="r1" onClose={() => {}} />));
    expect(await screen.findByTestId("receipt-detail")).toBeTruthy();
    expect(screen.queryByTestId("receipt-amend")).toBeNull();
  });
});
