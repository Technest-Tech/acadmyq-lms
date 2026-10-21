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
