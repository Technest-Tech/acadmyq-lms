import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { GroupAccounts, PayerAccount, ReceiptDetail } from "@/lib/accounting-api";
import type { GroupDetail } from "@/lib/groups-api";
import { CollectModal } from "./collect-modal";
import { ReceiptDetailModal } from "./receipt-detail-modal";
import { GroupAccountsPanel } from "@/components/groups/group-accounts-panel";
import { MarkPaidModal } from "@/components/invoices/mark-paid-modal";

/**
 * Accounting (docs/groups/01-ACCOUNTING.md): the Collect screen ticks the charges, follows them with
 * the amount, previews exactly what the money pays (and what becomes credit), and records ONE
 * receipt; the group's sheet lists unpaid first and opens Collect on that family's open charges;
 * "mark paid" only becomes Collect for a client on receipts.
 */

const getPayerAccount = vi.fn();
const recordReceipt = vi.fn();
const getGroupAccounts = vi.fn();
const applyTwoMonthOffer = vi.fn();
const getReceipt = vi.fn();
const attachReceiptProof = vi.fn();

vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getPayerAccount: (p: unknown) => getPayerAccount(p),
  applyTwoMonthOffer: (id: unknown, d: unknown) => applyTwoMonthOffer(id, d),
  getReceipt: (id: unknown) => getReceipt(id),
  attachReceiptProof: (id: unknown, f: unknown) => attachReceiptProof(id, f),
  recordReceipt: (i: unknown) => recordReceipt(i),
  getGroupAccounts: (id: unknown, m: unknown) => getGroupAccounts(id, m),
}));

const ar = arMessages.accounting;
const WITH_ACCOUNTING = [
  "invoicing", "payroll", "groups", "accounting",
];

function line(id: string, period: string, amount: number, paid = 0, over: Partial<PayerAccount["lines"][number]> = {}) {
  return {
    id,
    invoice_id: `inv-${period}`,
    description: `English A1 — ${period}`,
    student_id: "s-adam",
    student_name: "Adam",
    group_id: "g1",
    group_name: "English A1",
    group_charge: "MONTHLY",
    date: `${period}-01`,
    period,
    amount_minor: amount,
    paid_minor: paid,
    remaining_minor: amount - paid,
    currency: "EGP",
    invoice_status: "OPEN",
    ...over,
  };
}

function account(lines = [line("l-may", "2026-05", 45000), line("l-jun", "2026-06", 45000, 20000)]): PayerAccount {
  return {
    payer: { kind: "GUARDIAN", id: "gd1", name: "Parent of two", phone: "+201001112223" },
    accounting: true,
    lines,
    balance: [{ currency: "EGP", due_minor: lines.reduce((s, l) => s + l.remaining_minor, 0), credit_minor: 0, balance_minor: 0 }],
    recent_receipts: [],
  };
}

function receipt(over: Partial<ReceiptDetail> = {}): ReceiptDetail {
  return {
    id: "r1",
    number: "R-000007",
    received_on: "2026-06-17",
    created_at: "2026-06-17T09:00:00Z",
    payer_name: "Parent of two",
    payer_kind: "GUARDIAN",
    guardian_id: "gd1",
    student_id: null,
    amount_minor: 70000,
    allocated_minor: 70000,
    currency: "EGP",
    method: "INSTAPAY",
    reference: null,
    source: "MANUAL",
    received_by_name: "Owner",
    voided: false,
    void_reason: null,
    groups: ["English A1"],
    note: null,
    has_proof: false,
    payer: { kind: "GUARDIAN", id: "gd1", name: "Parent of two", phone: "+201001112223" },
    public_url: "https://noor.academiq.test/rc/tok",
    unallocated_minor: 0,
    voided_at: null,
    voided_by_name: null,
    allocations: [],
    balance_after: [{ currency: "EGP", due_minor: 0, credit_minor: 0, balance_minor: 0 }],
    can_void: true,
    ...over,
  };
}

const owner = () =>
  makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "invoice.mark_paid", "group.read"], capabilities: WITH_ACCOUNTING });

beforeEach(() => {
  getPayerAccount.mockReset();
  recordReceipt.mockReset();
  applyTwoMonthOffer.mockReset();
  getGroupAccounts.mockReset();
});

describe("Collect", () => {
  it("ticks every unpaid charge, follows them with the amount, and shows what the money pays", async () => {
    getPayerAccount.mockResolvedValue(account());
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} />));

    const amount = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    // 450 for May + the 250 left on June.
    await waitFor(() => expect(amount.value).toBe("700"));

    const preview = screen.getByTestId("collect-preview");
    expect(within(preview).getByText("English A1 — 2026-05")).toBeTruthy();
    expect(within(preview).getByText("English A1 — 2026-06")).toBeTruthy();

    // Unticking June drops the amount to May's 450.
    await userEvent.click(screen.getByTestId("collect-line-l-jun"));
    await waitFor(() => expect(amount.value).toBe("450"));
  });

  it("takes the two-month offer on one subject only: the server's two months less the discount typed, the other subject stays", async () => {
    // A June joiner: June pro-rated to 300, July a full 450 — the server's quote, never 2 × 300.
    const quote = { list_minor: 75000, family_discount_minor: 0, family_label: null, amount_minor: 75000 };
    getPayerAccount.mockResolvedValue(
      account([line("l-eng", "2026-06", 30000, 0, { two_month: quote }), line("l-math", "2026-06", 40000, 0, { group_id: "g2", group_name: "Maths", description: "Maths — 2026-06" })]),
    );
    recordReceipt.mockResolvedValue({ receipt: receipt({ amount_minor: 105000 }) });
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} />));

    const amount = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    await waitFor(() => expect(amount.value).toBe("700"));
    await userEvent.click(screen.getByTestId("collect-offer-l-eng"));
    // The two months as quoted (750) + Maths (400); then the offer's discount comes off.
    await waitFor(() => expect(amount.value).toBe("1150"));
    await userEvent.type(screen.getByTestId("collect-offer-discount-l-eng"), "100");
    await waitFor(() => expect(amount.value).toBe("1050"));
    await userEvent.click(screen.getByTestId("collect-submit"));
    await waitFor(() => expect(recordReceipt).toHaveBeenCalledTimes(1));
    expect(recordReceipt.mock.calls[0]![0]).toMatchObject({ amount_minor: 105000, two_month_offers: [{ line_id: "l-eng", discount_minor: 10000 }] });
  });

  it("offers the two-month deal only where the server priced it (not on a charge already covering two months, nor one whose next month is raised)", async () => {
    getPayerAccount.mockResolvedValue(account([line("l-two", "2026-06", 80000, 0, { group_months: 2 }), line("l-old", "2026-05", 45000, 0, { two_month: null })]));
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} />));
    await screen.findByTestId("collect-amount");
    expect(screen.queryByTestId("collect-offer-l-two")).toBeNull();
    expect(screen.queryByTestId("collect-offer-l-old")).toBeNull();
  });

  it("turns a subject already paid this month into two months from the family's credit, then reloads the account", async () => {
    const quote = { list_minor: 90000, family_discount_minor: 9000, family_label: "خصم اخوات", amount_minor: 81000 };
    getPayerAccount.mockResolvedValue({
      ...account([]),
      offer_lines: [{ id: "l-paid", description: "Maths — month 1", student_name: "Adam", group_name: "Maths", amount_minor: 40500, currency: "EGP", two_month: quote }],
      balance: [{ currency: "EGP", due_minor: 0, credit_minor: 93600, balance_minor: -93600 }],
    });
    applyTwoMonthOffer.mockResolvedValue({ line_id: "l-paid", amount_minor: 81000, balance: [] });
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} />));

    await userEvent.click(await screen.findByTestId("collect-credit-offer-l-paid"));
    expect(screen.getByTestId("collect-credit-offers").textContent).toContain("خصم اخوات");
    await userEvent.type(screen.getByTestId("collect-credit-offer-discount-l-paid"), "10");
    await userEvent.click(screen.getByTestId("collect-credit-offer-apply-l-paid"));
    await waitFor(() => expect(applyTwoMonthOffer).toHaveBeenCalledWith("l-paid", 1000));
    await waitFor(() => expect(getPayerAccount).toHaveBeenCalledTimes(2));
    expect(recordReceipt).not.toHaveBeenCalled();
  });

  it("offers only the academy's payment methods, starting on the first when it takes no cash (Lingo 2026-11-15)", async () => {
    getPayerAccount.mockResolvedValue({ ...account([line("l-jun", "2026-06", 45000)]), methods: ["INSTAPAY", "WALLET", "BANK_TRANSFER"] });
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} />));
    await screen.findByTestId("collect-amount");
    expect(screen.queryByTestId("collect-method-CASH")).toBeNull();
    expect(screen.getByTestId("collect-method-INSTAPAY")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("collect-method-WALLET")).toBeTruthy();
  });

  it("records a transfer before the parent sends the screenshot, once the desk says so", async () => {
    getPayerAccount.mockResolvedValue(account([line("l-jun", "2026-06", 45000)]));
    recordReceipt.mockResolvedValue({ receipt: receipt({ amount_minor: 45000 }) });
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} />));
    await screen.findByTestId("collect-amount");
    await userEvent.click(screen.getByTestId("collect-method-INSTAPAY"));
    expect(screen.getByTestId("collect-submit")).toBeDisabled();
    await userEvent.click(screen.getByTestId("collect-proof-later"));
    expect(screen.getByTestId("collect-submit")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("collect-submit"));
    await waitFor(() => expect(recordReceipt).toHaveBeenCalledTimes(1));
    expect(recordReceipt.mock.calls[0]![0]).toMatchObject({ method: "INSTAPAY", proof: null, proof_later: true });
  });

  it("keeps what is beyond every charge as credit, and records one receipt for it", async () => {
    getPayerAccount.mockResolvedValue(account([line("l-jun", "2026-06", 45000)]));
    recordReceipt.mockResolvedValue({ receipt: receipt({ amount_minor: 60000, unallocated_minor: 15000 }) });
    const onRecorded = vi.fn();
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} onRecorded={onRecorded} />));

    const amount = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    await waitFor(() => expect(amount.value).toBe("450"));
    await userEvent.clear(amount);
    await userEvent.type(amount, "600");
    // 600 against a 450 charge: the 150 beyond it is kept as credit.
    const tail = ar.collect.becomesCredit.split("{amount}")[1]!.trim();
    expect(within(screen.getByTestId("collect-preview")).getByText((text) => text.includes(tail))).toBeTruthy();

    await userEvent.click(screen.getByTestId("collect-method-INSTAPAY"));
    // Anything but cash needs the transfer's picture before it can be saved.
    expect(screen.getByTestId("collect-submit")).toBeDisabled();
    await userEvent.upload(screen.getByTestId("collect-proof"), new File(["img"], "instapay.png", { type: "image/png" }));
    await userEvent.click(screen.getByTestId("collect-submit"));

    await waitFor(() => expect(recordReceipt).toHaveBeenCalledTimes(1));
    expect(recordReceipt.mock.calls[0]![0]).toMatchObject({
      guardian_id: "gd1",
      amount_minor: 60000,
      currency: "EGP",
      method: "INSTAPAY",
      line_ids: ["l-jun"],
      apply_rest: true,
    });

    // The receipt itself: its number, and the ways to hand it over.
    const done = await screen.findByTestId("collect-done");
    expect(within(done).getByText("R-000007")).toBeTruthy();
    expect(screen.getByTestId("collect-send")).toBeTruthy();
    expect(onRecorded).toHaveBeenCalled();
  });
});

describe("Group accounts", () => {
  const group = { id: "g1", name: "English A1", timezone: "Africa/Cairo", pricing: { currency: "EGP" } } as unknown as GroupDetail;

  function sheet(): GroupAccounts {
    const base = {
      member_status: "ACTIVE", joined_on: "2026-05-01", left_on: null, is_trial: false, currency: "EGP", charges: [], last_receipt: null,
    };
    return {
      month: "2026-06",
      group: { id: "g1", name: "English A1", billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP" },
      rows: [
        { ...base, student_id: "s-c", student_name: "Celine", payer: { kind: "GUARDIAN", id: "gd2", name: "Celine’s mother", phone: null }, due_minor: 45000, paid_minor: 0, remaining_minor: 45000, arrears_minor: 45000, state: "UNPAID", open_line_ids: ["c-may", "c-jun"] },
        { ...base, student_id: "s-a", student_name: "Adam", payer: { kind: "GUARDIAN", id: "gd1", name: "Parent of two", phone: null }, due_minor: 45000, paid_minor: 45000, remaining_minor: 0, arrears_minor: 0, state: "PAID", open_line_ids: [],
          last_receipt: { id: "r1", number: "R-000001", received_on: "2026-06-17", method: "CASH" } },
      ],
      totals: [{ currency: "EGP", expected_minor: 90000, collected_minor: 45000, remaining_minor: 45000, arrears_minor: 45000, received_in_month_minor: 45000, paid: 1, partial: 0, unpaid: 1, rate: 0.5, teacher_cost_minor: null, net_minor: null }],
      sees_teacher_cost: false,
      can_collect: true,
    };
  }

  it("shows the collection rate, lists unpaid first, and collects with that family's open charges ticked", async () => {
    getGroupAccounts.mockResolvedValue(sheet());
    getPayerAccount.mockResolvedValue(account([line("c-may", "2026-05", 45000), line("c-jun", "2026-06", 45000)]));
    render(withAuth(owner(), <GroupAccountsPanel group={group} />));

    const table = await screen.findByTestId("accounts-table");
    expect(screen.getByText("50%")).toBeTruthy();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Celine")).toBeTruthy();
    expect(within(rows[1]!).getByText("R-000001")).toBeTruthy();
    // Nothing to collect from a paid row.
    expect(screen.queryByTestId("collect-s-a")).toBeNull();

    // The filter narrows to the paid ones.
    await userEvent.click(screen.getByTestId("accounts-filter-PAID"));
    expect(within(screen.getByTestId("accounts-table")).queryByText("Celine")).toBeNull();
    await userEvent.click(screen.getByTestId("accounts-filter-ALL"));

    await userEvent.click(screen.getByTestId("collect-s-c"));
    await waitFor(() => expect(getPayerAccount).toHaveBeenCalledWith({ guardian_id: "gd2", student_id: null, invoice_id: undefined }));
    const field = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("900"));
  });
});

describe("Mark paid", () => {
  const props = { open: true, invoiceId: "inv-1", totalMinor: 90000, currency: "EGP", onClose: () => {}, onSuccess: () => {} };

  it("is the classic form for a client without accounting", () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["invoice.mark_paid"] }), <MarkPaidModal {...props} />));
    expect(document.getElementById("mark-paid-form")).not.toBeNull();
    expect(getPayerAccount).not.toHaveBeenCalled();
  });

  it("collects a receipt, the invoice's charges ticked, for a client on receipts", async () => {
    getPayerAccount.mockResolvedValue(account([line("l-other", "2026-05", 10000, 0, { invoice_id: "inv-0" }), line("l-1", "2026-06", 90000, 0, { invoice_id: "inv-1" })]));
    render(withAuth(owner(), <MarkPaidModal {...props} />));

    await waitFor(() => expect(getPayerAccount).toHaveBeenCalledWith({ guardian_id: undefined, student_id: undefined, invoice_id: "inv-1" }));
    const field = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("900"));
    expect((screen.getByTestId("collect-line-l-1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("collect-line-l-other") as HTMLInputElement).checked).toBe(false);
  });
});

describe("A receipt awaiting its screenshot", () => {
  it("says so and lets the collecting hand attach the picture when it arrives (Lingo 2026-11-15)", async () => {
    getReceipt.mockResolvedValue({ receipt: receipt({ method: "INSTAPAY", proof_pending: true, can_attach_proof: true }) });
    attachReceiptProof.mockResolvedValue({ receipt: receipt({ method: "INSTAPAY", proof_pending: false, has_proof: true }) });
    const onChanged = vi.fn();
    render(withAuth(owner(), <ReceiptDetailModal receiptId="r1" onClose={() => {}} onChanged={onChanged} />));

    const box = await screen.findByTestId("receipt-proof-pending");
    expect(box.textContent).toContain(ar.proof.awaiting);
    const file = new File(["x"], "later.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("receipt-proof-file"), file);
    await userEvent.click(screen.getByTestId("receipt-proof-attach"));
    await waitFor(() => expect(attachReceiptProof).toHaveBeenCalledWith("r1", file));
    await waitFor(() => expect(screen.queryByTestId("receipt-proof-pending")).toBeNull());
    expect(onChanged).toHaveBeenCalled();
  });
});
