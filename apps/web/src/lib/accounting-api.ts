/**
 * Accounting (docs/groups/01-ACCOUNTING.md) — the API client for receipts, the payer account the
 * Collect screen works from, and a group's collection sheet.
 *
 * Kept out of `api.ts` like `groups-api.ts`: a module of its own behind its own switch
 * (`accounting`, opt-in per client). A receipt is money that changed hands; its allocations say
 * which invoice lines it paid, and whatever it did not cover is the payer's credit.
 */
import { apiFetch, fetchPrivateFileUrl } from "@/lib/api";

export type ReceiptMethod = "CASH" | "INSTAPAY" | "WALLET" | "BANK_TRANSFER" | "CARD" | "OTHER";
export const RECEIPT_METHODS: ReceiptMethod[] = ["CASH", "INSTAPAY", "WALLET", "BANK_TRANSFER", "CARD", "OTHER"];

export type PayerKind = "GUARDIAN" | "STUDENT" | "NAME";

export interface Payer {
  kind: PayerKind;
  id: string | null;
  name: string | null;
  phone: string | null;
}

/** Where a payer stands in one currency. `balance_minor` < 0 = they hold credit. */
export interface PayerBalance {
  currency: string;
  due_minor: number;
  credit_minor: number;
  balance_minor: number;
}

export interface OpenLine {
  id: string;
  invoice_id: string;
  description: string;
  student_id: string | null;
  student_name: string | null;
  group_id: string | null;
  group_name: string | null;
  group_charge: string | null;
  date: string | null;
  /** YYYY-MM — the invoice's month. */
  period: string;
  amount_minor: number;
  paid_minor: number;
  remaining_minor: number;
  currency: string;
  invoice_status: string;
}

export interface PayerAccount {
  payer: Payer;
  accounting: boolean;
  lines: OpenLine[];
  balance: PayerBalance[];
  recent_receipts: {
    id: string;
    number: string;
    received_on: string;
    amount_minor: number;
    currency: string;
    method: ReceiptMethod;
    voided: boolean;
  }[];
}

export interface ReceiptRow {
  id: string;
  number: string;
  received_on: string;
  created_at: string;
  payer_name: string | null;
  payer_kind: PayerKind;
  guardian_id: string | null;
  student_id: string | null;
  amount_minor: number;
  allocated_minor: number;
  currency: string;
  method: ReceiptMethod;
  reference: string | null;
  source: "MANUAL" | "GATEWAY" | "MIGRATED";
  received_by_name: string | null;
  voided: boolean;
  void_reason: string | null;
  groups: string[];
}

export interface ReceiptAllocation {
  line_id: string;
  invoice_id: string;
  description: string;
  student_name: string | null;
  group_name: string | null;
  period: string;
  line_amount_minor: number;
  amount_minor: number;
}

export interface ReceiptDetail extends ReceiptRow {
  note: string | null;
  has_proof: boolean;
  payer: Payer;
  public_url: string;
  unallocated_minor: number;
  voided_at: string | null;
  voided_by_name: string | null;
  allocations: ReceiptAllocation[];
  balance_after: PayerBalance[];
  can_void: boolean;
}

export interface ReceiptTotals {
  currency: string;
  count: number;
  amount_minor: number;
  by_method: Partial<Record<ReceiptMethod, number>>;
}

export interface ReceiptRegister {
  from: string;
  to: string;
  receipts: ReceiptRow[];
  totals: ReceiptTotals[];
  collectors: { id: string; name: string }[];
  meta: { page: number; per_page: number; total: number };
  can_void: boolean;
}

export interface ReceiptFilters {
  from?: string;
  to?: string;
  method?: ReceiptMethod | "";
  collector_id?: string;
  group_id?: string;
  guardian_id?: string;
  student_id?: string;
  q?: string;
  status?: "active" | "void" | "all";
  page?: number;
  per_page?: number;
}

export interface RecordReceiptInput {
  guardian_id?: string | null;
  student_id?: string | null;
  invoice_id?: string | null;
  amount_minor: number;
  currency?: string;
  method: ReceiptMethod;
  reference?: string;
  note?: string;
  received_on?: string;
  proof?: File | null;
  /** Pay these first, in this order. */
  line_ids?: string[];
  /** Spend what is left on their other unpaid charges (default true); false keeps it as credit. */
  apply_rest?: boolean;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function getReceipts(filters: ReceiptFilters = {}): Promise<ReceiptRegister> {
  return apiFetch(`/api/receipts${query({ ...filters })}`);
}

export function getReceipt(id: string): Promise<{ receipt: ReceiptDetail }> {
  return apiFetch(`/api/receipts/${id}`);
}

export function recordReceipt(input: RecordReceiptInput): Promise<{ receipt: ReceiptDetail }> {
  const body = new FormData();
  if (input.guardian_id) body.set("guardian_id", input.guardian_id);
  if (input.student_id) body.set("student_id", input.student_id);
  if (input.invoice_id) body.set("invoice_id", input.invoice_id);
  body.set("amount_minor", String(input.amount_minor));
  if (input.currency) body.set("currency", input.currency);
  body.set("method", input.method);
  if (input.reference?.trim()) body.set("reference", input.reference.trim());
  if (input.note?.trim()) body.set("note", input.note.trim());
  if (input.received_on) body.set("received_on", input.received_on);
  if (input.proof) body.set("proof", input.proof);
  for (const id of input.line_ids ?? []) body.append("line_ids[]", id);
  if (input.apply_rest === false) body.set("apply_rest", "0");
  return apiFetch(`/api/receipts`, { method: "POST", body });
}

export function voidReceipt(id: string, reason: string): Promise<{ receipt: ReceiptDetail }> {
  return apiFetch(`/api/receipts/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function sendReceipt(id: string): Promise<{ phone: string; message: string; url: string; transport: string; sent: boolean }> {
  return apiFetch(`/api/receipts/${id}/send`, { method: "POST" });
}

/** The receipt's uploaded proof (a transfer screenshot) as an object URL to open. */
export function fetchReceiptProof(id: string): Promise<string> {
  return fetchPrivateFileUrl(`/api/receipts/${id}/proof`);
}

export function getPayerAccount(payer: { guardian_id?: string | null; student_id?: string | null; invoice_id?: string | null }): Promise<PayerAccount> {
  return apiFetch(`/api/payer-account${query(payer)}`);
}

// ── A group's collection sheet ───────────────────────────────────────────────

export type AccountState = "PAID" | "PARTIAL" | "UNPAID" | "FREE" | "NO_CHARGE";

export interface GroupAccountRow {
  student_id: string;
  student_name: string;
  member_status: string;
  joined_on: string | null;
  left_on: string | null;
  is_trial: boolean;
  payer: Payer;
  currency: string;
  due_minor: number;
  paid_minor: number;
  remaining_minor: number;
  /** Still owed from EARLIER months of this group. */
  arrears_minor: number;
  state: AccountState;
  /** Pay first: their next month is held, since this date, until what they owe here is paid. */
  awaiting_payment_since?: string | null;
  charges: { line_id: string; description: string; charge: string; period: string; amount_minor: number; paid_minor: number }[];
  /** What Collect pre-ticks: this month's unpaid lines, then older ones. */
  open_line_ids: string[];
  last_receipt: { id: string; number: string; received_on: string; method: ReceiptMethod } | null;
}

export interface GroupAccountTotals {
  currency: string;
  expected_minor: number;
  collected_minor: number;
  remaining_minor: number;
  arrears_minor: number;
  /** Cash basis: what receipts dated in the month paid on this group, for any month. */
  received_in_month_minor: number;
  paid: number;
  partial: number;
  unpaid: number;
  /** collected ÷ expected, 0–1; null when nothing was expected. */
  rate: number | null;
  teacher_cost_minor: number | null;
  net_minor: number | null;
}

export interface GroupAccounts {
  month: string;
  group: { id: string; name: string; billing_mode: string; price_minor: number | null; currency: string | null };
  rows: GroupAccountRow[];
  totals: GroupAccountTotals[];
  sees_teacher_cost: boolean;
  can_collect: boolean;
}

export function getGroupAccounts(groupId: string, month?: string): Promise<GroupAccounts> {
  return apiFetch(`/api/groups/${groupId}/accounts${query({ month })}`);
}

// ── The public receipt ───────────────────────────────────────────────────────

export interface PublicReceipt {
  number: string;
  academy_name: string;
  payer_name: string | null;
  amount_minor: number;
  currency: string;
  method: ReceiptMethod;
  reference: string | null;
  received_on: string;
  received_by: string | null;
  voided: boolean;
  allocations: { description: string; student_name: string | null; amount_minor: number }[];
}

// ── The Accounting section's pages ───────────────────────────────────────────

export type AgeBucket = "d0_30" | "d31_60" | "d61_90" | "d90_plus";
export const AGE_BUCKETS: AgeBucket[] = ["d0_30", "d31_60", "d61_90", "d90_plus"];

export interface Collector {
  id: string | null;
  name: string | null;
  source: string;
  amount_minor: number;
  count: number;
}

export interface AccountingOverview {
  month: string;
  today: string;
  collected: {
    currency: string;
    amount_minor: number;
    count: number;
    today_minor: number;
    by_method: Partial<Record<ReceiptMethod, number>>;
    by_collector: Collector[];
    by_day: { date: string; amount_minor: number }[];
  }[];
  billed: { currency: string; billed_minor: number; paid_minor: number; rate: number | null }[];
  owed: ({ currency: string; due_minor: number; overdue_minor: number; payers: number } & Record<AgeBucket, number>)[];
  credit: { currency: string; credit_minor: number }[];
  top_debtors: ArrearsPayer[];
  recent_receipts: { id: string; number: string; received_on: string; payer_name: string | null; amount_minor: number; currency: string; method: ReceiptMethod; voided: boolean }[];
}

export interface GroupMoney {
  currency: string;
  expected_minor: number;
  collected_minor: number;
  remaining_minor: number;
  arrears_minor: number;
  received_in_month_minor: number;
  teacher_cost_minor: number | null;
  net_minor: number | null;
  rate: number | null;
  margin: number | null;
}

export interface AccountingGroups {
  month: string;
  groups: {
    id: string;
    name: string;
    level: string | null;
    status: string;
    teacher_name: string | null;
    billing_mode: string;
    price_minor: number | null;
    currency: string | null;
    students: number;
    money: GroupMoney[];
  }[];
  totals: GroupMoney[];
  teachers: (GroupMoney & { teacher_id: string | null; teacher_name: string | null; groups: number })[] | null;
  sees_teacher_cost: boolean;
}

export interface ArrearsPayer {
  kind: PayerKind;
  id: string | null;
  name: string | null;
  phone: string | null;
  students: string[];
  groups: string[];
  balances: ({ currency: string; due_minor: number; overdue_minor: number } & Record<AgeBucket, number>)[];
  oldest_due: string | null;
  open_charges: number;
  last_receipt: { id: string; number: string; received_on: string; amount_minor: number; currency: string } | null;
}

export interface Arrears {
  today: string;
  payers: ArrearsPayer[];
  totals: ({ currency: string; due_minor: number; overdue_minor: number; payers: number } & Record<AgeBucket, number>)[];
  groups: { id: string; name: string }[];
  can_collect: boolean;
  can_remind: boolean;
}

export interface StatementEntry {
  date: string;
  kind: "CHARGE" | "RECEIPT";
  id: string;
  description: string;
  student_name?: string | null;
  group_name?: string | null;
  method?: ReceiptMethod;
  reference?: string | null;
  currency: string;
  debit_minor: number;
  credit_minor: number;
  paid_minor?: number;
  list_amount_minor?: number | null;
  discount_minor?: number;
  discount_label?: string | null;
  invoice_url?: string;
  balance_minor: number;
}

export interface Statement {
  payer: Payer;
  students: string[];
  from: string;
  to: string;
  currencies: { currency: string; opening_minor: number; charges_minor: number; receipts_minor: number; closing_minor: number; entries: StatementEntry[] }[];
  balance: PayerBalance[];
}

export interface DailyCollections {
  from: string;
  to: string;
  days: {
    date: string;
    voided: number;
    currencies: { currency: string; amount_minor: number; count: number; by_method: Partial<Record<ReceiptMethod, number>>; by_collector: Collector[] }[];
  }[];
  totals: { currency: string; amount_minor: number; count: number; by_method: Partial<Record<ReceiptMethod, number>> }[];
  collectors: { id: string; name: string }[];
}

export function getAccountingOverview(month?: string): Promise<AccountingOverview> {
  return apiFetch(`/api/accounting/overview${query({ month })}`);
}

export function getAccountingGroups(month?: string): Promise<AccountingGroups> {
  return apiFetch(`/api/accounting/groups${query({ month })}`);
}

export function getArrears(filters: { group_id?: string; bucket?: AgeBucket | "overdue" | ""; q?: string } = {}): Promise<Arrears> {
  return apiFetch(`/api/accounting/arrears${query(filters)}`);
}

export function remindPayer(payer: { guardian_id?: string | null; student_id?: string | null }): Promise<{ phone: string | null; message: string; transport: string; sent: boolean }> {
  return apiFetch(`/api/accounting/arrears/remind`, { method: "POST", body: JSON.stringify(payer) });
}

export function getStatement(payer: { guardian_id?: string | null; student_id?: string | null }, from?: string, to?: string): Promise<Statement> {
  return apiFetch(`/api/accounting/statement${query({ ...payer, from, to })}`);
}

export function getDailyCollections(filters: { from?: string; to?: string; collector_id?: string } = {}): Promise<DailyCollections> {
  return apiFetch(`/api/accounting/daily${query(filters)}`);
}

// ── The family card ──────────────────────────────────────────────────────────

export interface FamilyCharge {
  id: string;
  invoice_id: string;
  source: "GROUP" | "PRIVATE" | "OTHER";
  group_name: string | null;
  description: string;
  student_id: string | null;
  student_name: string | null;
  date: string;
  period: string;
  amount_minor: number;
  /** Set when a discount was taken: the price before it, how much, and the discount's label(s). */
  list_amount_minor: number | null;
  discount_minor: number;
  discount_label: string | null;
  paid_minor: number;
  remaining_minor: number;
  currency: string;
  payer_kind: "GUARDIAN" | "STUDENT";
  payer_id: string;
}

export type DiscountKind = "PERCENT" | "FIXED";
export type DiscountScope = "ALL" | "GROUP" | "PRIVATE";

/** A standing discount on a family's (or one child's) charges. PERCENT `value` is basis points; FIXED is minor units per charge. */
export interface FamilyDiscount {
  id: string;
  kind: DiscountKind;
  value: number;
  label: string;
  scope: DiscountScope;
  student_id: string | null;
  student_name: string | null;
  class_group_id: string | null;
  group_name: string | null;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
  /** The preset (بنود الخصم) it was made from; null = typed in. */
  preset_id?: string | null;
  by: string | null;
}

/** A discount an admin defines once (بنود الخصم). Values as stored: PERCENT in basis points, FIXED in minor units. */
export interface DiscountPreset {
  id: string;
  name: string;
  kind: DiscountKind;
  value: number;
  notes: string | null;
  is_active: boolean;
  /** Discounts made from it. */
  uses: number;
  by: string | null;
}

export function listDiscountPresets(): Promise<{ presets: DiscountPreset[]; can_manage: boolean }> {
  return apiFetch("/api/accounting/discount-presets");
}

/** `value`: a whole percent for PERCENT, minor units for FIXED — like the family discount form. */
export function createDiscountPreset(input: { name: string; kind: DiscountKind; value: number; notes?: string | null }): Promise<{ preset: DiscountPreset }> {
  return apiFetch("/api/accounting/discount-presets", { method: "POST", body: JSON.stringify(input) });
}

export function updateDiscountPreset(id: string, input: { name?: string; kind?: DiscountKind; value?: number; notes?: string | null; is_active?: boolean }): Promise<{ preset: DiscountPreset }> {
  return apiFetch(`/api/accounting/discount-presets/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export type FamilyEvent =
  | { kind: "RECEIPT"; at: string; date: string; id: string; number: string; amount_minor: number; currency: string; method: ReceiptMethod; by: string | null; voided: boolean; void_reason: string | null }
  | { kind: "REMINDER"; at: string; date: string; id: string; by: string | null }
  | { kind: "BILL_SENT"; at: string; date: string; id: string; period: string; amount_minor: number; currency: string }
  | { kind: "NOTE"; at: string; date: string; id: string; body: string; follow_up_on: string | null; by: string | null; mine: boolean };

/** Renew freely, or wait for the last charge to be paid before the next one opens. */
export type RenewalPolicy = "FREE" | "PAY_FIRST";

export interface FamilyAccount {
  family: { id: string; name: string; phone: string | null; renewal_policy?: RenewalPolicy };
  today: string;
  balance: { currency: string; due_minor: number; credit_minor: number; balance_minor: number; overdue_minor: number }[];
  paid_this_year: { currency: string; amount_minor: number }[];
  last_receipt: { id: string; number: string; received_on: string; amount_minor: number; currency: string } | null;
  next_follow_up: { date: string; body: string } | null;
  children: {
    id: string;
    name: string;
    status: string;
    groups: { id: string; name: string; teacher_name: string | null; billing_mode: string; price_minor: number | null; currency: string | null; joined_on: string }[];
    private: { plan_label: string; price_minor: number; currency: string; price_basis: string; teachers: string[] } | null;
    due: { currency: string; due_minor: number }[];
  }[];
  charges: FamilyCharge[];
  discounts: FamilyDiscount[];
  timeline: FamilyEvent[];
  can_collect: boolean;
  can_remind: boolean;
  can_note: boolean;
}

export function getFamilyAccount(guardianId: string): Promise<FamilyAccount> {
  return apiFetch(`/api/accounting/family/${guardianId}`);
}

export function setFamilyRenewalPolicy(guardianId: string, policy: RenewalPolicy): Promise<{ policy: RenewalPolicy }> {
  return apiFetch(`/api/accounting/family/${guardianId}/renewal-policy`, { method: "PATCH", body: JSON.stringify({ policy }) });
}

/** A student's own switch, their family's, and the one that applies (either saying pay first wins). */
export interface StudentRenewalPolicy {
  policy: RenewalPolicy;
  family_policy: RenewalPolicy | null;
  guardian_id: string | null;
  effective: RenewalPolicy;
}

export function getStudentRenewalPolicy(studentId: string): Promise<StudentRenewalPolicy> {
  return apiFetch(`/api/accounting/students/${studentId}/renewal-policy`);
}

export function setStudentRenewalPolicy(studentId: string, policy: RenewalPolicy): Promise<StudentRenewalPolicy> {
  return apiFetch(`/api/accounting/students/${studentId}/renewal-policy`, { method: "PATCH", body: JSON.stringify({ policy }) });
}

export function addFamilyNote(guardianId: string, body: string, followUpOn?: string | null): Promise<{ id: string }> {
  return apiFetch(`/api/accounting/family/${guardianId}/notes`, { method: "POST", body: JSON.stringify({ body, follow_up_on: followUpOn || null }) });
}

export function deleteFamilyNote(guardianId: string, noteId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/accounting/family/${guardianId}/notes/${noteId}`, { method: "DELETE" });
}

/** PERCENT `value` is a whole percent (1–100) here; FIXED is minor units per charge. */
export function addFamilyDiscount(
  guardianId: string,
  // With `preset_id` the preset brings kind, value and label; without one they are typed in.
  input: { preset_id?: string | null; kind?: DiscountKind; value?: number; label?: string; scope?: DiscountScope; student_id?: string | null; class_group_id?: string | null },
): Promise<{ id: string }> {
  return apiFetch(`/api/accounting/family/${guardianId}/discounts`, { method: "POST", body: JSON.stringify(input) });
}

/** Ends it today; what it already took off stays on those charges. */
export function endFamilyDiscount(guardianId: string, discountId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/accounting/family/${guardianId}/discounts/${discountId}`, { method: "DELETE" });
}

// ── The treasury ─────────────────────────────────────────────────────────────

export type AccountKind = "CASH" | "BANK" | "WALLET" | "INSTAPAY" | "CARD" | "OTHER";
export const ACCOUNT_KINDS: AccountKind[] = ["CASH", "BANK", "INSTAPAY", "WALLET", "CARD", "OTHER"];

export interface CashAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  opening_balance_minor: number;
  opening_on: string;
  is_active: boolean;
  balance_minor: number;
  today_in_minor: number;
  today_out_minor: number;
  last_closing: { day: string; difference_minor: number } | null;
  closed_today: boolean;
}

export interface ExpenseCategory {
  id: string;
  key: string | null;
  name: string;
  is_active: boolean;
}

export interface InOut {
  currencies: { currency: string; in_minor: number; out_minor: number; net_minor: number }[];
}

export interface TreasuryState {
  today: string;
  accounts: CashAccount[];
  methods: { method: ReceiptMethod; currency: string; cash_account_id: string }[];
  unmapped_methods: { method: ReceiptMethod; currency: string }[];
  month: InOut;
  categories: ExpenseCategory[];
  can_manage: boolean;
  can_close: boolean;
  sees_salaries: boolean;
}

export interface LedgerEntry {
  kind: "RECEIPT" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "CLOSING";
  id: string;
  date: string;
  label: string | null;
  party?: string | null;
  /** RECEIPT: the family (or student) the money came from, to open from the ledger. */
  guardian_id?: string | null;
  student_id?: string | null;
  method?: ReceiptMethod;
  category?: string;
  description?: string | null;
  expected_minor?: number;
  counted_minor?: number;
  in_minor: number;
  out_minor: number;
  balance_minor: number;
}

export interface AccountLedger {
  account: { id: string; name: string; kind: AccountKind; currency: string; opening_on: string };
  from: string;
  to: string;
  opening_minor: number;
  entries: LedgerEntry[];
  closing_minor: number;
}

export function getTreasury(): Promise<TreasuryState> {
  return apiFetch(`/api/treasury`);
}

export function createCashAccount(input: { name: string; kind: AccountKind; currency?: string; opening_balance_minor?: number; opening_on?: string; methods?: ReceiptMethod[] }): Promise<{ id: string }> {
  return apiFetch(`/api/treasury/accounts`, { method: "POST", body: JSON.stringify(input) });
}

export function updateCashAccount(id: string, patch: { name?: string; is_active?: boolean }): Promise<{ ok: boolean }> {
  return apiFetch(`/api/treasury/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function mapMethodToAccount(method: ReceiptMethod, currency: string, cashAccountId: string | null): Promise<{ ok: boolean }> {
  return apiFetch(`/api/treasury/methods`, { method: "PUT", body: JSON.stringify({ method, currency, cash_account_id: cashAccountId }) });
}

export function getAccountLedger(id: string, from?: string, to?: string): Promise<AccountLedger> {
  return apiFetch(`/api/treasury/accounts/${id}/ledger${query({ from, to })}`);
}

export function createTransfer(input: { from_account_id: string; to_account_id: string; amount_minor: number; transferred_on?: string; note?: string }): Promise<{ id: string }> {
  return apiFetch(`/api/treasury/transfers`, { method: "POST", body: JSON.stringify(input) });
}

export function voidTransfer(id: string, reason: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/treasury/transfers/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function closeDay(input: { cash_account_id: string; counted_minor: number; day?: string; note?: string }): Promise<{ id: string; expected_minor: number; counted_minor: number; difference_minor: number }> {
  return apiFetch(`/api/treasury/closings`, { method: "POST", body: JSON.stringify(input) });
}

export function reopenDay(closingId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/treasury/closings/${closingId}`, { method: "DELETE" });
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export interface Expense {
  id: string;
  number: string;
  spent_on: string;
  category_id: string;
  category: string;
  category_key: string | null;
  amount_minor: number;
  currency: string;
  cash_account_id: string;
  account: string;
  payee: string | null;
  description: string | null;
  has_attachment: boolean;
  payout_id: string | null;
  created_by_name: string | null;
  voided: boolean;
  void_reason: string | null;
}

export interface ExpensesPage {
  from: string;
  to: string;
  expenses: Expense[];
  by_category: { category_id: string; name: string; currency: string; amount_minor: number; count: number }[];
  totals: { currency: string; amount_minor: number; count: number }[];
  categories: ExpenseCategory[];
  accounts: { id: string; name: string; kind: AccountKind; currency: string }[];
  can_manage: boolean;
  sees_salaries: boolean;
}

export interface SalaryDue {
  payout_id: string;
  teacher_id: string;
  teacher_name: string;
  /** How many paid lessons the statement holds. */
  lines: number;
  period: string;
  total_minor: number;
  paid_minor: number;
  remaining_minor: number;
  currency: string;
}

export function getExpenses(filters: { from?: string; to?: string; category_id?: string; cash_account_id?: string; q?: string; status?: "active" | "void" | "all" } = {}): Promise<ExpensesPage> {
  return apiFetch(`/api/expenses${query(filters)}`);
}

export function createExpense(input: { category_id?: string | null; payout_id?: string | null; cash_account_id: string; amount_minor: number; spent_on?: string; payee?: string; description?: string; attachment?: File | null }): Promise<{ id: string; number: string }> {
  const body = new FormData();
  if (input.category_id) body.set("category_id", input.category_id);
  if (input.payout_id) body.set("payout_id", input.payout_id);
  body.set("cash_account_id", input.cash_account_id);
  body.set("amount_minor", String(input.amount_minor));
  if (input.spent_on) body.set("spent_on", input.spent_on);
  if (input.payee?.trim()) body.set("payee", input.payee.trim());
  if (input.description?.trim()) body.set("description", input.description.trim());
  if (input.attachment) body.set("attachment", input.attachment);
  return apiFetch(`/api/expenses`, { method: "POST", body });
}

export function voidExpense(id: string, reason: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/expenses/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function fetchExpenseAttachment(id: string): Promise<string> {
  return fetchPrivateFileUrl(`/api/expenses/${id}/attachment`);
}

export function getSalariesDue(): Promise<{ salaries: SalaryDue[] }> {
  return apiFetch(`/api/expenses/salaries`);
}

export function createExpenseCategory(name: string): Promise<{ id: string }> {
  return apiFetch(`/api/expense-categories`, { method: "POST", body: JSON.stringify({ name }) });
}

export function updateExpenseCategory(id: string, patch: { name?: string; is_active?: boolean }): Promise<{ ok: boolean }> {
  return apiFetch(`/api/expense-categories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getIncomeExpenses(year?: number): Promise<{ year: number; months: ({ month: string } & InOut)[]; categories: { name: string; currency: string; amount_minor: number }[]; sees_salaries: boolean }> {
  return apiFetch(`/api/accounting/income-expenses${query({ year })}`);
}
