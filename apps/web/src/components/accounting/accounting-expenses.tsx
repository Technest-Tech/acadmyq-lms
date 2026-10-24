"use client";

import { Ban, FileImage, GraduationCap, Loader2, Plus, ReceiptText, Search, Settings2, TrendingDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, Tile, dayLabel, toMajorText, toMinor, todayLocal } from "@/components/accounting/accounting-ui";
import { getPayout, type PayoutDetailResponse } from "@/lib/api";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import {
  createExpense,
  createExpenseCategory,
  fetchExpenseAttachment,
  getExpenses,
  getSalariesDue,
  updateExpenseCategory,
  voidExpense,
  type Expense,
  type ExpensesPage,
  type SalaryDue,
} from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const monthStart = () => `${todayLocal().slice(0, 8)}01`;

/**
 * Money out (المصروفات, docs/groups/01-ACCOUNTING.md): every expense, numbered (E-000001), from the
 * account it was paid from, by category — rent, salaries, books, printing, ads… — with what the
 * period spent per category. A teacher's salary is paid from here against their finalized pay
 * statement, never beyond it. A wrong entry is voided with a reason, never deleted.
 */
export function AccountingExpensesScreen({ hero = true }: { hero?: boolean }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayLocal);
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState<"active" | "void" | "all">("active");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [data, setData] = useState<ExpensesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | "salary" | "categories" | { void: Expense } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    try {
      setData(await getExpenses({ from, to, category_id: category || undefined, cash_account_id: account || undefined, q: term || undefined, status }));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("expenses.loadFailed")));
    }
  }, [from, to, category, account, term, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const noAccounts = data !== null && data.accounts.length === 0;
  const done = (msg: string) => {
    setModal(null);
    setNotice(msg);
    void load();
  };

  async function openAttachment(id: string) {
    const tab = window.open("", "_blank");
    try {
      const url = await fetchExpenseAttachment(id);
      if (tab) tab.location.href = url;
    } catch (err) {
      tab?.close();
      setNotice(apiErrorMessage(err, t("detail.proofFailed")));
    }
  }

  const actions =
    data?.can_manage && !noAccounts ? (
      <div className="flex flex-wrap gap-2">
        {data.sees_salaries && (
          <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal("salary")} data-testid="expense-salary">
            <GraduationCap className="size-4" aria-hidden />
            {t("expenses.paySalary")}
          </Button>
        )}
        <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal("new")} data-testid="expense-new">
          <Plus className="size-4" aria-hidden />
          {t("expenses.new")}
        </Button>
      </div>
    ) : undefined;

  return (
    <div className="space-y-5" data-testid="accounting-expenses">
      {hero ? (
        <PageHero icon={TrendingDown} title={t("expenses.title")} subtitle={t("expenses.subtitle")} latticeId="accounting-expenses-hero" actions={actions} />
      ) : (
        actions && <div className="flex justify-end">{actions}</div>
      )}

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {noAccounts && <AlertBanner variant="info" message={t("expenses.needAccount")} />}

      <div className="bg-card grid grid-cols-1 gap-2 rounded-2xl border p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-muted-foreground text-xs">
          {t("register.from")}
          <input type="date" className={cn(fieldClass, "mt-1")} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.to")}
          <input type="date" className={cn(fieldClass, "mt-1")} value={to} min={from} max={todayLocal()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label className="text-muted-foreground text-xs">
          {t("expenses.category")}
          <select className={cn(fieldClass, "mt-1")} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("expenses.allCategories")}</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted-foreground text-xs">
          {t("expenses.account")}
          <select className={cn(fieldClass, "mt-1")} value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">{t("expenses.allAccounts")}</option>
            {(data?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.status")}
          <select className={cn(fieldClass, "mt-1")} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">{t("register.statusActive")}</option>
            <option value="void">{t("register.statusVoid")}</option>
            <option value="all">{t("register.statusAll")}</option>
          </select>
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.search")}
          <span className="relative mt-1 block">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("expenses.searchHint")} />
          </span>
        </label>
      </div>

      {data && data.totals.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {data.totals.map((tot) => (
            <Tile key={tot.currency} label={t("expenses.total")} value={money(tot.amount_minor, tot.currency)} icon={TrendingDown} accent="amber" hint={t("expenses.count", { count: tot.count })} />
          ))}
          <Panel
            title={t("expenses.byCategory")}
            icon={ReceiptText}
            accent="amber"
            className="lg:col-span-2"
            action={
              data.can_manage ? (
                <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => setModal("categories")}>
                  <Settings2 className="size-3.5" aria-hidden />
                  {t("expenses.manageCategories")}
                </Button>
              ) : undefined
            }
          >
            <ul className="space-y-2">
              {data.by_category.map((c) => {
                const total = data.totals.find((x) => x.currency === c.currency)?.amount_minor ?? 1;
                const share = Math.round((c.amount_minor / total) * 100);
                return (
                  <li key={`${c.category_id}-${c.currency}`} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {money(c.amount_minor, c.currency)} <span className="text-muted-foreground text-xs font-normal">{share}%</span>
                      </span>
                    </div>
                    <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      {data && data.expenses.length === 0 && <p className="text-muted-foreground bg-card/60 rounded-2xl border border-dashed p-10 text-center text-sm">{t("expenses.empty")}</p>}

      {data && data.expenses.length > 0 && (
        <div className="bg-card overflow-x-auto rounded-xl border shadow-sm">
          <table className="w-full min-w-[720px] text-sm" data-testid="expenses-table">
            <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
              <tr>
                <th className="p-3 text-start">{t("expenses.col.number")}</th>
                <th className="p-3 text-start">{t("statement.col.date")}</th>
                <th className="p-3 text-start">{t("expenses.col.item")}</th>
                <th className="p-3 text-start">{t("expenses.account")}</th>
                <th className="p-3 text-end">{t("register.col.amount")}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.expenses.map((e) => (
                <tr key={e.id} className={cn(e.voided && "opacity-60")}>
                  <td className="p-3">
                    <span className="font-mono text-xs font-semibold" dir="ltr">
                      {e.number}
                    </span>
                    {e.voided && <span className="ms-2 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">{t("register.void")}</span>}
                  </td>
                  <td className="p-3 whitespace-nowrap">{dayLabel(e.spent_on, locale)}</td>
                  <td className="p-3">
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">{e.category}</span>
                    <p className="mt-1 break-words">{[e.payee, e.description].filter(Boolean).join(" — ") || "—"}</p>
                    {e.voided && e.void_reason && <p className="text-xs text-rose-700 dark:text-rose-300">{e.void_reason}</p>}
                  </td>
                  <td className="text-muted-foreground p-3 text-xs">{e.account}</td>
                  <td className={cn("p-3 text-end font-semibold tabular-nums", e.voided && "line-through")}>{money(e.amount_minor, e.currency)}</td>
                  <td className="p-3 text-end">
                    <div className="flex justify-end gap-1">
                      {e.has_attachment && (
                        <Button type="button" size="icon-sm" variant="ghost" onClick={() => void openAttachment(e.id)} aria-label={t("expenses.attachment")}>
                          <FileImage className="size-4" aria-hidden />
                        </Button>
                      )}
                      {data.can_manage && !e.voided && (
                        <Button type="button" size="icon-sm" variant="ghost" onClick={() => setModal({ void: e })} aria-label={t("detail.void")}>
                          <Ban className="size-4 text-rose-600" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === "new" && data && <ExpenseModal data={data} onClose={() => setModal(null)} onDone={(n) => done(t("expenses.recorded", { number: n }))} />}
      {modal === "salary" && data && <SalaryModal data={data} onClose={() => setModal(null)} onDone={(n) => done(t("expenses.recorded", { number: n }))} />}
      {modal === "categories" && data && <CategoriesModal data={data} onClose={() => setModal(null)} onChanged={() => void load()} />}
      {modal && typeof modal === "object" && "void" in modal && (
        <VoidModal expense={modal.void} onClose={() => setModal(null)} onDone={() => done(t("expenses.voided"))} />
      )}
    </div>
  );
}

const NEW_CATEGORY = "__new__";

function ExpenseModal({ data, onClose, onDone }: { data: ExpensesPage; onClose: () => void; onDone: (number: string) => void }) {
  const t = useTranslations("accounting");
  const categories = data.categories.filter((c) => c.is_active && c.key !== "teacher_salaries");
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  // "+ New category…" right in the list: the desk names it here and the expense lands under it.
  const [newCategory, setNewCategory] = useState("");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(todayLocal());
  const [payee, setPayee] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = data.accounts.find((a) => a.id === accountId)?.currency ?? "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let categoryId = category;
      if (category === NEW_CATEGORY) {
        categoryId = (await createExpenseCategory(newCategory.trim())).id;
      }
      const res = await createExpense({ category_id: categoryId, cash_account_id: accountId, amount_minor: toMinor(amount), spent_on: on, payee, description, attachment: file });
      onDone(res.number);
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("expenses.new")}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button
            type="submit"
            form="expense-form"
            disabled={busy || toMinor(amount) <= 0 || !category || !accountId || (category === NEW_CATEGORY && newCategory.trim() === "")}
            data-testid="expense-save"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("expenses.save")}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="expense-form">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t("expenses.category")}
            <select className={cn(fieldClass, "mt-1.5")} value={category} onChange={(e) => setCategory(e.target.value)} data-testid="expense-category">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {data.can_manage && <option value={NEW_CATEGORY}>{t("expenses.addCategoryInline")}</option>}
            </select>
            {category === NEW_CATEGORY && (
              <input
                className={cn(fieldClass, "mt-1.5")}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t("expenses.newCategoryName")}
                maxLength={80}
                autoFocus
                data-testid="expense-new-category"
              />
            )}
          </label>
          <label className="block text-sm font-medium">
            {t("expenses.paidFrom")}
            <select className={cn(fieldClass, "mt-1.5")} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t("collect.amount", { currency })}
            <input className={cn(fieldClass, "mt-1.5 text-lg font-semibold")} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" data-testid="expense-amount" />
          </label>
          <label className="block text-sm font-medium">
            {t("statement.col.date")}
            <input type="date" className={cn(fieldClass, "mt-1.5")} value={on} max={todayLocal()} onChange={(e) => setOn(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          {t("expenses.payee")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
          <input className={cn(fieldClass, "mt-1.5")} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={t("expenses.payeeHint")} />
        </label>
        <label className="block text-sm font-medium">
          {t("expenses.description")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
          <input className={cn(fieldClass, "mt-1.5")} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          {t("expenses.attachment")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={cn(fieldClass, "mt-1.5 py-1.5")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}

function SalaryModal({ data, onClose, onDone }: { data: ExpensesPage; onClose: () => void; onDone: (number: string) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [rows, setRows] = useState<SalaryDue[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<SalaryDue | null>(null);
  // The statement behind the figure: what the teacher taught and what moved the total, so the desk
  // pays a statement it has read, not a number.
  const [detail, setDetail] = useState<PayoutDetailResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSalariesDue()
      .then((r) => setRows(r.salaries.filter((s) => s.remaining_minor > 0)))
      .catch((err) => setError(apiErrorMessage(err, t("expenses.loadFailed"))));
  }, [t]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((s) => !needle || s.teacher_name.toLowerCase().includes(needle) || s.period.includes(needle));
  }, [rows, q]);

  const accounts = data.accounts.filter((a) => !picked || a.currency === picked.currency);
  useEffect(() => {
    if (picked) {
      setAmount(toMajorText(picked.remaining_minor));
      setAccountId(accounts[0]?.id ?? "");
      setDetail(null);
      let alive = true;
      getPayout(picked.payout_id)
        .then((d) => alive && setDetail(d))
        .catch(() => alive && setDetail(null));
      return () => {
        alive = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createExpense({ payout_id: picked.payout_id, cash_account_id: accountId, amount_minor: toMinor(amount) });
      onDone(res.number);
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  const money = (v: number, c: string) => formatMoney({ amount: v, currency: c }, locale);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("expenses.paySalary")}
      description={t("expenses.paySalaryHint")}
      size="lg"
      footer={
        picked ? (
          <>
            <Button type="button" variant="outline" onClick={() => setPicked(null)} disabled={busy}>
              {t("expenses.back")}
            </Button>
            <Button type="submit" form="salary-form" disabled={busy || toMinor(amount) <= 0 || !accountId}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("expenses.payNow")}
            </Button>
          </>
        ) : undefined
      }
    >
      {error && <AlertBanner variant="error" message={error} />}
      {!picked && rows === null && !error && <p className="text-muted-foreground py-8 text-center text-sm">{t("detail.loading")}</p>}
      {!picked && rows !== null && rows.length === 0 && <p className="text-muted-foreground py-8 text-center text-sm">{t("expenses.noSalaries")}</p>}
      {!picked && rows !== null && rows.length > 0 && (
        <div className="space-y-3">
          <span className="relative block">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("expenses.searchTeacher")} autoFocus data-testid="salary-search" />
          </span>
          {shown.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("expenses.noTeacherMatch")}</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border" data-testid="salary-list">
              {shown.map((s) => (
                <li key={s.payout_id}>
                  <button type="button" onClick={() => setPicked(s)} className="hover:bg-muted/50 flex w-full items-center justify-between gap-3 p-3 text-start" data-testid={`salary-${s.payout_id}`}>
                    <span>
                      <span className="block font-medium">{s.teacher_name}</span>
                      <span className="text-muted-foreground text-xs">
                        {s.period} · {t("expenses.linesCount", { count: s.lines })}
                        {s.paid_minor > 0 && ` · ${t("expenses.alreadyPaid", { amount: money(s.paid_minor, s.currency) })}`}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums">{money(s.remaining_minor, s.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {picked && (
        <form id="salary-form" onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="bg-muted/40 rounded-xl border p-3 text-sm">
            <p className="font-semibold">{picked.teacher_name}</p>
            <p className="text-muted-foreground text-xs">{t("expenses.salaryLine", { period: picked.period, total: money(picked.total_minor, picked.currency), left: money(picked.remaining_minor, picked.currency) })}</p>
            {detail && (
              <p className="text-muted-foreground mt-1 text-xs" data-testid="salary-summary">
                {t("expenses.statementSummary", {
                  lines: detail.lineItems.length,
                  sessions: money(detail.payout.sessions_minor, picked.currency),
                  rewards: money(detail.payout.rewards_minor, picked.currency),
                  deductions: money(detail.payout.deductions_minor, picked.currency),
                })}
              </p>
            )}
          </div>
          {detail && detail.lineItems.length > 0 && (
            <details className="rounded-xl border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t("expenses.statementLines")}</summary>
              <ul className="max-h-48 divide-y overflow-y-auto border-t text-xs" data-testid="salary-lines">
                {detail.lineItems.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0 truncate">
                      {[l.session_date, l.group_name ?? l.student_name, l.description].filter(Boolean).join(" · ")}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(l.amount_minor, l.currency)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {t("collect.amount", { currency: picked.currency })}
              <input className={cn(fieldClass, "mt-1.5 text-lg font-semibold")} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="block text-sm font-medium">
              {t("expenses.paidFrom")}
              <select className={cn(fieldClass, "mt-1.5")} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </form>
      )}
    </Modal>
  );
}

function CategoriesModal({ data, onClose, onChanged }: { data: ExpensesPage; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("accounting");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createExpenseCategory(name.trim());
      setName("");
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
    }
  }

  async function toggle(id: string, isActive: boolean) {
    try {
      await updateExpenseCategory(id, { is_active: isActive });
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
    }
  }

  return (
    <Modal open onClose={onClose} title={t("expenses.manageCategories")} size="md">
      <div className="space-y-3">
        {error && <AlertBanner variant="error" message={error} />}
        <form onSubmit={(e) => void add(e)} className="flex gap-2">
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("expenses.newCategory")} maxLength={80} />
          <Button type="submit" disabled={!name.trim()}>
            <Plus className="size-4" aria-hidden />
          </Button>
        </form>
        <ul className="divide-y rounded-xl border">
          {data.categories.map((c) => (
            <li key={c.id} className={cn("flex items-center justify-between gap-2 p-2.5 text-sm", !c.is_active && "opacity-50")}>
              <span>{c.name}</span>
              {c.key !== "teacher_salaries" && (
                <Button type="button" size="xs" variant="ghost" onClick={() => void toggle(c.id, !c.is_active)}>
                  {c.is_active ? t("expenses.hideCategory") : t("expenses.showCategory")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function VoidModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("accounting");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    try {
      await voidExpense(expense.id, reason.trim());
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, t("detail.voidFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("expenses.voidTitle", { number: expense.number })}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void submit()} disabled={busy || reason.trim().length < 3}>
            {t("detail.voidConfirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("detail.voidReasonHint")} autoFocus />
        <p className="text-muted-foreground text-xs">{t("expenses.voidWarning")}</p>
        {error && <AlertBanner variant="error" message={error} />}
      </div>
    </Modal>
  );
}
