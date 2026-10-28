"use client";

import {
  ArrowLeft,
  ArrowLeftRight,
  Ban,
  ChevronRight,
  FileImage,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Scale,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  Vault,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ExpenseModal } from "@/components/accounting/accounting-expenses";
import { CloseModal, KIND_ICON, TransferModal } from "@/components/accounting/accounting-treasury";
import { ACCENTS, AccountingTabs, MethodBadge, Tile, dayLabel, toMajorText, toMinor, todayLocal } from "@/components/accounting/accounting-ui";
import { ReceiptDetailModal } from "@/components/accounting/receipt-detail-modal";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import {
  createAdjustment,
  deleteCashAccount,
  fetchExpenseAttachment,
  getAccountLedger,
  getTreasury,
  reopenDay,
  updateCashAccount,
  updateExpenseAmount,
  updateTransferAmount,
  voidAdjustment,
  voidExpense,
  voidTransfer,
  type AccountLedger,
  type CashAccount,
  type LedgerEntry,
  type TreasuryState,
} from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Period = "month" | "lastMonth" | "all" | "custom";
const PERIODS: Period[] = ["month", "lastMonth", "all", "custom"];
type View = "split" | "statement";

const SALARY_KEYS = ["teacher_salaries", "staff_salaries"];

/** The month `offset` months from this one: its first day → its last (this month: → today). */
function monthRange(offset: number): [string, string] {
  const today = todayLocal();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const from = new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
  if (offset === 0) return [from, today];
  return [from, new Date(Date.UTC(y, m + offset, 0)).toISOString().slice(0, 10)];
}

/**
 * One treasury account on its own page (docs/groups/01-ACCOUNTING.md) — what a centre's desk asked
 * for when the card grid read as "not clear at all": the balance it started the period with on top,
 * then money in beside money out, each a list whose total is its header, and every line opens its
 * detail. Transfers, the day's counts and balance adjustments move the balance but are neither, so
 * they sit apart under each side. The same movements in date order, with the running balance, are
 * the statement tab. The account itself is edited (name, opening balance) and deleted from here.
 */
export function TreasuryAccountScreen({ accountId }: { accountId: string }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [treasury, setTreasury] = useState<TreasuryState | null>(null);
  const [ledger, setLedger] = useState<AccountLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState<[string, string]>(() => monthRange(0));
  const [view, setView] = useState<View>("split");
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<LedgerEntry | null>(null);
  const [modal, setModal] = useState<"expense" | "transfer" | "close" | "adjust" | "edit" | "delete" | null>(null);
  const router = useRouter();
  const [tick, setTick] = useState(0);

  const account = treasury?.accounts.find((a) => a.id === accountId) ?? null;
  const [from, to] = useMemo<[string, string]>(() => {
    if (period === "month") return monthRange(0);
    if (period === "lastMonth") return monthRange(-1);
    if (period === "all") return [account?.opening_on ?? monthRange(0)[0], todayLocal()];
    return custom;
  }, [period, custom, account?.opening_on]);

  useEffect(() => {
    let alive = true;
    getTreasury()
      .then((d) => alive && setTreasury(d))
      .catch((err) => alive && setError(apiErrorMessage(err, t("treasury.loadFailed"))));
    return () => {
      alive = false;
    };
  }, [t, tick]);

  useEffect(() => {
    let alive = true;
    getAccountLedger(accountId, from, to)
      .then((d) => {
        if (!alive) return;
        setLedger(d);
        setError(null);
      })
      .catch((err) => alive && setError(apiErrorMessage(err, t("treasury.loadFailed"))));
    return () => {
      alive = false;
    };
  }, [accountId, from, to, t, tick]);

  const refresh = (msg?: string) => {
    setOpen(null);
    setModal(null);
    if (msg) setNotice(msg);
    setTick((n) => n + 1);
  };

  const currency = ledger?.account.currency ?? account?.currency ?? "EGP";
  const money = (v: number) => formatMoney({ amount: v, currency }, locale);

  const sides = useMemo(() => {
    const entries = ledger?.entries ?? [];
    const sum = (xs: LedgerEntry[], k: "in_minor" | "out_minor") => xs.reduce((n, e) => n + e[k], 0);
    // Newest first: the desk looks for what just happened.
    const receipts = entries.filter((e) => e.kind === "RECEIPT").reverse();
    const expenses = entries.filter((e) => e.kind === "EXPENSE").reverse();
    const counted = (e: LedgerEntry) => e.kind === "CLOSING" || e.kind === "ADJUSTMENT";
    const movesIn = entries.filter((e) => e.kind === "TRANSFER_IN" || (counted(e) && e.in_minor > 0)).reverse();
    const movesOut = entries.filter((e) => e.kind === "TRANSFER_OUT" || (counted(e) && e.out_minor > 0)).reverse();
    return {
      receipts,
      expenses,
      movesIn,
      movesOut,
      collected: sum(receipts, "in_minor"),
      spent: sum(expenses, "out_minor"),
      movesNet: sum(movesIn, "in_minor") - sum(movesOut, "out_minor"),
    };
  }, [ledger]);

  const byCategory = useMemo(() => {
    const m = new Map<string, { name: string; amount: number }>();
    for (const e of sides.expenses) {
      const name = e.category ?? "";
      const c = m.get(name) ?? { name, amount: 0 };
      c.amount += e.out_minor;
      m.set(name, c);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [sides.expenses]);
  const activeCategory = byCategory.some((c) => c.name === category) ? category : null;
  const shownExpenses = activeCategory === null ? sides.expenses : sides.expenses.filter((e) => e.category === activeCategory);

  if (treasury && !account) {
    return (
      <div className="space-y-4">
        <BackLink />
        <AlertBanner variant="error" message={t("treasury.account.notFound")} />
      </div>
    );
  }

  const active = (treasury?.accounts ?? []).filter((a) => a.is_active);
  const Icon = account ? KIND_ICON[account.kind] : Vault;
  const startsAtOpening = ledger !== null && ledger.from === ledger.account.opening_on;
  const actions =
    treasury && account?.is_active ? (
      <div className="flex flex-wrap gap-2">
        {treasury.can_manage && (
          <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal("expense")} data-testid="account-new-expense">
            <Plus className="size-4" aria-hidden />
            {t("expenses.new")}
          </Button>
        )}
        {treasury.can_manage && active.filter((a) => a.currency === account.currency).length >= 2 && (
          <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal("transfer")}>
            <ArrowLeftRight className="size-4" aria-hidden />
            {t("treasury.transfer")}
          </Button>
        )}
        {treasury.can_close && !account.closed_today && (
          <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal("adjust")} data-testid="account-adjust">
            <SlidersHorizontal className="size-4" aria-hidden />
            {t("treasury.account.adjust")}
          </Button>
        )}
        {treasury.can_close && !account.closed_today && (
          <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal("close")}>
            <Lock className="size-4" aria-hidden />
            {t("treasury.closeDay")}
          </Button>
        )}
      </div>
    ) : undefined;

  async function reactivate() {
    try {
      await updateCashAccount(accountId, { is_active: true });
      refresh(t("treasury.account.reactivated"));
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
    }
  }

  return (
    <div className="space-y-5" data-testid="treasury-account">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink />
        {treasury?.can_manage && account && (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setModal("edit")} data-testid="account-edit">
              <Pencil className="size-3.5" aria-hidden />
              {t("treasury.account.edit")}
            </Button>
            {account.is_active ? (
              <Button type="button" size="sm" variant="outline" className="gap-1 text-rose-700 dark:text-rose-300" onClick={() => setModal("delete")} data-testid="account-delete">
                <Trash2 className="size-3.5" aria-hidden />
                {t("treasury.account.delete")}
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => void reactivate()} data-testid="account-reactivate">
                <Power className="size-3.5" aria-hidden />
                {t("treasury.account.reactivate")}
              </Button>
            )}
          </div>
        )}
      </div>
      <PageHero
        icon={Icon}
        title={account?.name ?? ledger?.account.name ?? t("treasury.title")}
        subtitle={account ? `${t(`kind.${account.kind}`)} · ${t("treasury.account.balanceNow", { amount: money(account.balance_minor) })}` : undefined}
        badges={
          account && (account.closed_today || !account.is_active) ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">
              <Lock className="size-3" aria-hidden />
              {account.is_active ? t("treasury.closedToday") : t("treasury.account.inactive")}
            </span>
          ) : undefined
        }
        latticeId="treasury-account-hero"
        actions={actions}
      />

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="bg-card flex flex-col gap-3 rounded-2xl border p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="group">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors", period === p ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
              data-testid={`period-${p}`}
            >
              {t(`treasury.account.period.${p}`)}
            </button>
          ))}
        </div>
        {period === "custom" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-muted-foreground text-xs">
              {t("register.from")}
              <input type="date" className={cn(fieldClass, "mt-1")} value={custom[0]} max={custom[1]} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} />
            </label>
            <label className="text-muted-foreground text-xs">
              {t("register.to")}
              <input type="date" className={cn(fieldClass, "mt-1")} value={custom[1]} min={custom[0]} max={todayLocal()} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} />
            </label>
          </div>
        ) : (
          ledger && (
            <p className="text-muted-foreground text-sm">
              {dayLabel(ledger.from, locale)} — {dayLabel(ledger.to, locale)}
            </p>
          )
        )}
      </div>

      {!ledger && !error && <p className="text-muted-foreground py-8 text-center text-sm">{t("detail.loading")}</p>}

      {ledger && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="account-summary">
            <Tile
              label={startsAtOpening ? t("treasury.account.opening") : t("treasury.account.openingPeriod")}
              value={money(ledger.opening_minor)}
              icon={Vault}
              accent="slate"
              hint={
                startsAtOpening
                  ? t("treasury.account.openingStart", { date: dayLabel(ledger.account.opening_on, locale) })
                  : t("treasury.account.openingCarried", { amount: money(ledger.account.opening_balance_minor), date: dayLabel(ledger.account.opening_on, locale) })
              }
              testId="account-opening"
            />
            <Tile label={t("treasury.account.collected")} value={money(sides.collected)} icon={TrendingUp} accent="emerald" hint={t("register.receiptsCount", { count: sides.receipts.length })} testId="account-collected" />
            <Tile label={t("treasury.account.spent")} value={money(sides.spent)} icon={TrendingDown} accent="rose" hint={t("expenses.count", { count: sides.expenses.length })} testId="account-spent" />
            <Tile
              label={t("treasury.account.closing")}
              value={money(ledger.closing_minor)}
              icon={Scale}
              accent="violet"
              tone={ledger.closing_minor < 0 ? "text-rose-600 dark:text-rose-400" : undefined}
              hint={t("treasury.balanceAt", { date: dayLabel(ledger.to, locale) })}
              testId="account-closing"
            />
          </div>
          {sides.movesNet !== 0 && (
            <p className="text-muted-foreground -mt-2 text-xs">{t("treasury.account.movesNote", { amount: `${sides.movesNet > 0 ? "+" : "−"}${money(Math.abs(sides.movesNet))}` })}</p>
          )}

          <AccountingTabs
            tabs={[
              { key: "split", label: t("treasury.account.views.split"), icon: Scale },
              { key: "statement", label: t("treasury.account.views.statement"), icon: ArrowLeftRight },
            ]}
            value={view}
            onChange={setView}
            testIdPrefix="account-view"
          />

          {view === "split" && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Side
                tone="in"
                icon={TrendingUp}
                title={t("treasury.account.inTitle")}
                total={money(sides.collected)}
                hint={t("register.receiptsCount", { count: sides.receipts.length })}
                empty={t("treasury.account.noIn")}
                rows={sides.receipts}
                moves={sides.movesIn}
                currency={currency}
                onOpen={setOpen}
                testId="account-in"
              />
              <Side
                tone="out"
                icon={TrendingDown}
                title={t("treasury.account.outTitle")}
                total={money(sides.spent)}
                hint={t("expenses.count", { count: sides.expenses.length })}
                empty={t("treasury.account.noOut")}
                rows={shownExpenses}
                moves={sides.movesOut}
                currency={currency}
                onOpen={setOpen}
                testId="account-out"
                chips={
                  byCategory.length > 1 && (
                    <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b px-3 py-2" data-testid="account-categories">
                      <CategoryChip label={t("expenses.allCategories")} active={activeCategory === null} onClick={() => setCategory(null)} />
                      {byCategory.map((c) => (
                        <CategoryChip key={c.name} label={c.name} amount={money(c.amount)} active={activeCategory === c.name} onClick={() => setCategory(c.name)} />
                      ))}
                    </div>
                  )
                }
              />
            </div>
          )}

          {view === "statement" && <Statement ledger={ledger} startsAtOpening={startsAtOpening} onOpen={setOpen} />}
        </>
      )}

      <ReceiptDetailModal receiptId={open?.kind === "RECEIPT" ? open.id : null} onClose={() => setOpen(null)} onChanged={() => setTick((n) => n + 1)} />
      {open && open.kind !== "RECEIPT" && treasury && (
        <EntryDetailModal
          entry={open}
          currency={currency}
          canManage={treasury.can_manage}
          canClose={treasury.can_close}
          seesSalaries={treasury.sees_salaries}
          lastClosingDay={account?.last_closing?.day ?? null}
          onClose={() => setOpen(null)}
          onChanged={refresh}
        />
      )}
      {modal === "expense" && treasury && (
        <ExpenseModal data={{ categories: treasury.categories, accounts: active, can_manage: treasury.can_manage }} accountId={accountId} onClose={() => setModal(null)} onDone={(n) => refresh(t("expenses.recorded", { number: n }))} />
      )}
      {modal === "transfer" && <TransferModal accounts={active} from={accountId} onClose={() => setModal(null)} onDone={() => refresh(t("treasury.transferred"))} />}
      {modal === "close" && account && <CloseModal account={account} onClose={() => setModal(null)} onDone={(m) => refresh(m)} />}
      {modal === "adjust" && account && <AdjustModal account={account} onClose={() => setModal(null)} onDone={(m) => refresh(m)} />}
      {modal === "edit" && account && <EditAccountModal account={account} onClose={() => setModal(null)} onDone={() => refresh(t("treasury.account.saved"))} />}
      {modal === "delete" && account && <DeleteAccountModal account={account} onClose={() => setModal(null)} onDone={() => router.push("/accounting/treasury")} />}
    </div>
  );
}

function BackLink() {
  const t = useTranslations("accounting");
  return (
    <Link href="/accounting/treasury" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium">
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {t("treasury.account.back")}
    </Link>
  );
}

function CategoryChip({ label, amount, active, onClick }: { label: string; amount?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium", active ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "hover:bg-muted")}
    >
      {label}
      {amount && <span className="ms-1.5 font-semibold tabular-nums">{amount}</span>}
    </button>
  );
}

/** One side of the account: its total as the header, then each line — newest first — and the moves apart. */
function Side({
  tone,
  icon: Icon,
  title,
  total,
  hint,
  empty,
  rows,
  moves,
  chips,
  currency,
  onOpen,
  testId,
}: {
  tone: "in" | "out";
  icon: LucideIcon;
  title: string;
  total: string;
  hint: string;
  empty: string;
  rows: LedgerEntry[];
  moves: LedgerEntry[];
  chips?: React.ReactNode;
  currency: string;
  onOpen: (e: LedgerEntry) => void;
  testId: string;
}) {
  const t = useTranslations("accounting");
  const a = ACCENTS[tone === "in" ? "emerald" : "rose"];
  return (
    <section className="bg-card flex flex-col overflow-hidden rounded-2xl border shadow-sm" data-testid={testId}>
      <header className={cn("flex items-start justify-between gap-3 border-b bg-gradient-to-br to-transparent p-4", a.wash)}>
        <div className="flex items-center gap-2.5">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl ring-1", a.chip)}>
            <Icon className="size-4" aria-hidden />
          </span>
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-muted-foreground text-xs">{hint}</p>
          </div>
        </div>
        <p className={cn("text-end text-xl font-bold break-words tabular-nums", tone === "in" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>{total}</p>
      </header>
      {chips}
      {rows.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center text-sm">{empty}</p>
      ) : (
        <ul className="divide-y lg:max-h-[560px] lg:overflow-y-auto">
          {rows.map((e) => (
            <EntryRow key={`${e.kind}-${e.id}`} entry={e} currency={currency} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {moves.length > 0 && (
        <div className="mt-auto border-t">
          <p className="bg-muted/40 text-muted-foreground px-3 py-1.5 text-xs font-semibold">{t("treasury.account.moves")}</p>
          <ul className="divide-y">
            {moves.map((e) => (
              <EntryRow key={`${e.kind}-${e.id}`} entry={e} currency={currency} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function useEntryTitle() {
  const t = useTranslations("accounting");
  return (e: LedgerEntry): string => {
    switch (e.kind) {
      case "RECEIPT":
        return e.party || t("treasury.account.noPayer");
      case "EXPENSE":
        return e.party || e.description || e.category || t(`treasury.entry.${e.kind}`);
      case "TRANSFER_IN":
        return t("treasury.account.transferFrom", { name: e.from_name ?? e.label ?? "" });
      case "TRANSFER_OUT":
        return t("treasury.account.transferTo", { name: e.to_name ?? e.label ?? "" });
      case "CLOSING":
        return e.in_minor > 0 ? t("treasury.account.countOver") : e.out_minor > 0 ? t("treasury.account.countShort") : t("treasury.entry.CLOSING");
      case "ADJUSTMENT":
        return e.in_minor > 0 ? t("treasury.account.adjustUp") : t("treasury.account.adjustDown");
    }
  };
}

function EntryRow({ entry: e, currency, onOpen }: { entry: LedgerEntry; currency: string; onOpen: (e: LedgerEntry) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const title = useEntryTitle();
  const incoming = e.in_minor > 0;
  return (
    <li>
      <button type="button" onClick={() => onOpen(e)} className="hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors" data-testid={`entry-${e.id}`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{title(e)}</p>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{dayLabel(e.date, locale)}</span>
            {(e.kind === "RECEIPT" || e.kind === "EXPENSE") && (
              <span className="font-mono" dir="ltr">
                {e.label}
              </span>
            )}
            {e.kind === "RECEIPT" && e.method && <MethodBadge method={e.method} />}
            {e.kind === "EXPENSE" && e.category && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-800 dark:text-amber-300">{e.category}</span>}
            {e.kind !== "RECEIPT" && e.kind !== "EXPENSE" && <span>{t(`treasury.entry.${e.kind}`)}</span>}
          </p>
        </div>
        <span className={cn("shrink-0 font-semibold tabular-nums", incoming ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
          {formatMoney({ amount: incoming ? e.in_minor : e.out_minor, currency }, locale)}
        </span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0 rtl:rotate-180" aria-hidden />
      </button>
    </li>
  );
}

/** Every movement in date order with the running balance — the account's statement. */
function Statement({ ledger, startsAtOpening, onOpen }: { ledger: AccountLedger; startsAtOpening: boolean; onOpen: (e: LedgerEntry) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const title = useEntryTitle();
  const money = (v: number) => formatMoney({ amount: v, currency: ledger.account.currency }, locale);

  return (
    <div className="bg-card overflow-x-auto rounded-xl border shadow-sm">
      <table className="w-full min-w-[620px] text-sm" data-testid="account-statement">
        <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
          <tr>
            <th className="p-2.5 text-start">{t("statement.col.date")}</th>
            <th className="p-2.5 text-start">{t("statement.col.item")}</th>
            <th className="p-2.5 text-end">{t("treasury.in")}</th>
            <th className="p-2.5 text-end">{t("treasury.out")}</th>
            <th className="p-2.5 text-end">{t("statement.col.balance")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          <tr className="bg-muted/30">
            <td className="p-2.5 whitespace-nowrap">{dayLabel(ledger.from, locale)}</td>
            <td className="p-2.5 font-medium">{startsAtOpening ? t("treasury.account.opening") : t("treasury.account.openingPeriod")}</td>
            <td />
            <td />
            <td className="p-2.5 text-end font-semibold tabular-nums">{money(ledger.opening_minor)}</td>
          </tr>
          {ledger.entries.length === 0 && (
            <tr>
              <td colSpan={5} className="text-muted-foreground p-6 text-center">
                {t("treasury.noMovements")}
              </td>
            </tr>
          )}
          {ledger.entries.map((e) => (
            <tr key={`${e.kind}-${e.id}`} className={cn(e.kind === "CLOSING" && "bg-sky-500/5", e.kind === "ADJUSTMENT" && "bg-amber-500/5")}>
              <td className="p-2.5 whitespace-nowrap">{dayLabel(e.date, locale)}</td>
              <td className="p-2.5">
                <button type="button" onClick={() => onOpen(e)} className="text-start font-medium hover:underline">
                  {title(e)}
                </button>
                <span className="text-muted-foreground block text-xs break-words">
                  {e.kind === "CLOSING"
                    ? t("treasury.closingLine", { expected: money(e.expected_minor ?? 0), counted: money(e.counted_minor ?? 0) })
                    : e.kind === "RECEIPT" || e.kind === "EXPENSE"
                      ? [e.label, e.kind === "RECEIPT" ? (e.method ? t(`method.${e.method}`) : null) : e.category].filter(Boolean).join(" · ")
                      : e.description}
                </span>
              </td>
              <td className="p-2.5 text-end text-emerald-700 tabular-nums dark:text-emerald-300">{e.in_minor > 0 ? money(e.in_minor) : ""}</td>
              <td className="p-2.5 text-end text-rose-700 tabular-nums dark:text-rose-300">{e.out_minor > 0 ? money(e.out_minor) : ""}</td>
              <td className="p-2.5 text-end font-semibold tabular-nums">{money(e.balance_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An expense, a transfer, a day's count or an adjustment, opened from the account. Correcting an
 * amount or voiding (an expense or a transfer: `expense.manage`; an adjustment: `cashbox.close`), or
 * reopening the last counted day, happens right here — no second modal on top of this one.
 */
function EntryDetailModal({
  entry: e,
  currency,
  canManage,
  canClose,
  seesSalaries,
  lastClosingDay,
  onClose,
  onChanged,
}: {
  entry: LedgerEntry;
  currency: string;
  canManage: boolean;
  canClose: boolean;
  seesSalaries: boolean;
  lastClosingDay: string | null;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [mode, setMode] = useState<"edit" | "act" | null>(null);
  const [amount, setAmount] = useState(toMajorText(e.in_minor || e.out_minor));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (v: number) => formatMoney({ amount: v, currency }, locale);
  const transfer = e.kind === "TRANSFER_IN" || e.kind === "TRANSFER_OUT";
  const closing = e.kind === "CLOSING";
  const adjustment = e.kind === "ADJUSTMENT";
  const diff = e.in_minor - e.out_minor;
  const salaryHidden = e.kind === "EXPENSE" && !seesSalaries && SALARY_KEYS.includes(e.category_key ?? "");
  const editable = canManage && ((e.kind === "EXPENSE" && !salaryHidden) || transfer);
  const action: { label: string; warning: string; needsReason: boolean } | null =
    e.kind === "EXPENSE" && canManage
      ? { label: t("treasury.account.voidExpense"), warning: t("expenses.voidWarning"), needsReason: true }
      : transfer && canManage
        ? { label: t("treasury.account.voidTransfer"), warning: t("treasury.account.voidTransferWarning"), needsReason: true }
        : adjustment && canClose
          ? { label: t("treasury.account.voidAdjustment"), warning: t("treasury.account.voidAdjustmentWarning"), needsReason: true }
          : closing && canClose && e.date === lastClosingDay
            ? { label: t("treasury.account.reopen"), warning: t("treasury.account.reopenHint"), needsReason: false }
            : null;

  const title =
    e.kind === "EXPENSE"
      ? t("treasury.account.expenseTitle", { number: e.label ?? "" })
      : closing
        ? t("treasury.account.closingTitle", { date: dayLabel(e.date, locale) })
        : t(`treasury.entry.${e.kind}`);

  const rows: [string, React.ReactNode][] = [[t("statement.col.date"), dayLabel(e.date, locale)]];
  if (e.kind === "EXPENSE") {
    rows.push([t("expenses.category"), e.category]);
    if (e.party) rows.push([t("expenses.payee"), e.party]);
    if (e.description) rows.push([t("expenses.description"), e.description]);
  }
  if (transfer) {
    rows.push([t("treasury.from"), e.from_name], [t("treasury.to"), e.to_name]);
    if (e.description) rows.push([t("collect.note"), e.description]);
  }
  if (closing) {
    rows.push([t("treasury.expected"), money(e.expected_minor ?? 0)], [t("treasury.counted"), money(e.counted_minor ?? 0)]);
    if (e.description) rows.push([t("collect.note"), e.description]);
  }
  if (adjustment) {
    rows.push([t("treasury.expected"), money(e.expected_minor ?? 0)], [t("treasury.account.actual"), money(e.actual_minor ?? 0)]);
    if (e.description) rows.push([t("treasury.account.reason"), e.description]);
  }
  if (e.by) rows.push([t("treasury.account.by"), e.by]);

  async function openAttachment() {
    const tab = window.open("", "_blank");
    try {
      const url = await fetchExpenseAttachment(e.id);
      if (tab) tab.location.href = url;
    } catch (err) {
      tab?.close();
      setError(apiErrorMessage(err, t("detail.proofFailed")));
    }
  }

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged(done);
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
      setBusy(false);
    }
  }

  const save = () =>
    run(() => (e.kind === "EXPENSE" ? updateExpenseAmount(e.id, toMinor(amount)) : updateTransferAmount(e.id, toMinor(amount))), t("treasury.account.amountSaved"));

  const act = () =>
    e.kind === "EXPENSE"
      ? run(() => voidExpense(e.id, reason.trim()), t("expenses.voided"))
      : transfer
        ? run(() => voidTransfer(e.id, reason.trim()), t("treasury.account.transferVoided"))
        : adjustment
          ? run(() => voidAdjustment(e.id, reason.trim()), t("treasury.account.adjustmentVoided"))
          : run(() => reopenDay(e.id), t("treasury.account.reopened"));

  const back = () => {
    setMode(null);
    setError(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={mode ? back : onClose} disabled={busy}>
            {mode ? t("expenses.back") : t("treasury.account.close")}
          </Button>
          {mode === null && editable && (
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => setMode("edit")} data-testid="entry-edit">
              <Pencil className="size-4" aria-hidden />
              {t("treasury.account.editAmount")}
            </Button>
          )}
          {mode === null && action && (
            <Button type="button" variant="outline" className="gap-1.5 text-rose-700 dark:text-rose-300" onClick={() => setMode("act")} data-testid="entry-act">
              {closing ? <RotateCcw className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />}
              {action.label}
            </Button>
          )}
          {mode === "edit" && (
            <Button type="button" onClick={() => void save()} disabled={busy || toMinor(amount) <= 0} data-testid="entry-edit-save">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("treasury.save")}
            </Button>
          )}
          {mode === "act" && action && (
            <Button type="button" variant="destructive" onClick={() => void act()} disabled={busy || (action.needsReason && reason.trim().length < 3)} data-testid="entry-act-confirm">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {action.needsReason ? t("detail.voidConfirm") : action.label}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4" data-testid="entry-detail">
        <div className="text-center">
          <p className={cn("text-3xl font-bold break-words tabular-nums", diff >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
            {(closing || adjustment) && diff !== 0 && (diff > 0 ? "+" : "−")}
            {money(Math.abs(diff))}
          </p>
          {(closing || adjustment) && <p className="text-muted-foreground mt-1 text-xs">{diff === 0 ? t("treasury.matches") : t("treasury.account.difference")}</p>}
        </div>
        <dl className="divide-y rounded-xl border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 px-3 py-2">
              <dt className="text-muted-foreground shrink-0">{k}</dt>
              <dd className="text-end font-medium break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {salaryHidden && <p className="text-muted-foreground text-xs">{t("treasury.account.salaryHidden")}</p>}
        {e.kind === "EXPENSE" && e.has_attachment && (
          <Button type="button" variant="outline" className="w-full gap-1.5" onClick={() => void openAttachment()}>
            <FileImage className="size-4" aria-hidden />
            {t("expenses.attachment")}
          </Button>
        )}
        {mode === "edit" && (
          <div className="space-y-2 rounded-xl border p-3">
            <label className="block text-sm font-medium">
              {t("treasury.account.newAmount", { currency })}
              <input
                className={cn(fieldClass, "mt-1.5 text-lg font-semibold")}
                inputMode="decimal"
                dir="ltr"
                value={amount}
                onChange={(ev) => setAmount(ev.target.value)}
                autoFocus
                data-testid="entry-amount"
              />
            </label>
            <p className="text-muted-foreground text-xs">{t("treasury.account.editAmountHint")}</p>
          </div>
        )}
        {mode === "act" && action && (
          <div className="space-y-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
            {action.needsReason && (
              <input className={fieldClass} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={t("treasury.account.voidReasonHint")} autoFocus data-testid="entry-reason" />
            )}
            <p className="text-muted-foreground text-xs">{action.warning}</p>
          </div>
        )}
        {error && <AlertBanner variant="error" message={error} />}
      </div>
    </Modal>
  );
}

/**
 * Set the balance to what the account really holds. The difference from the books is recorded with
 * its reason as an adjustment — like a day's count, except the day stays open.
 */
function AdjustModal({ account, onClose, onDone }: { account: CashAccount; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [actual, setActual] = useState(toMajorText(account.balance_minor));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diff = toMinor(actual) - account.balance_minor;
  const money = (v: number) => formatMoney({ amount: v, currency: account.currency }, locale);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await createAdjustment({ cash_account_id: account.id, actual_minor: toMinor(actual), reason: reason.trim() });
      onDone(t("treasury.account.adjusted", { amount: `${res.amount_minor > 0 ? "+" : "−"}${money(Math.abs(res.amount_minor))}` }));
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("treasury.account.adjustTitle", { name: account.name })}
      description={t("treasury.account.adjustHint")}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button type="submit" form="adjust-form" disabled={busy || actual.trim() === "" || diff === 0 || reason.trim().length < 3} data-testid="adjust-confirm">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("treasury.account.adjustDo")}
          </Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={(ev) => void submit(ev)} className="space-y-4" data-testid="adjust-form">
        <div className="bg-muted/40 flex items-center justify-between rounded-xl border p-3 text-sm">
          <span className="text-muted-foreground">{t("treasury.expected")}</span>
          <span className="font-bold tabular-nums">{money(account.balance_minor)}</span>
        </div>
        <label className="block text-sm font-medium">
          {t("treasury.account.actual")}
          <input className={cn(fieldClass, "mt-1.5 text-lg font-semibold")} inputMode="decimal" dir="ltr" value={actual} onChange={(ev) => setActual(ev.target.value)} data-testid="adjust-actual" />
        </label>
        <div
          className={cn(
            "rounded-xl border p-3 text-sm font-semibold",
            diff === 0 ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : diff < 0 ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300" : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          )}
          data-testid="adjust-diff"
        >
          {diff === 0 ? t("treasury.matches") : diff < 0 ? t("treasury.shortBy", { amount: money(-diff) }) : t("treasury.overBy", { amount: money(diff) })}
        </div>
        <label className="block text-sm font-medium">
          {t("treasury.account.reason")}
          <input className={cn(fieldClass, "mt-1.5")} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={t("treasury.account.reasonHint")} maxLength={500} data-testid="adjust-reason" />
        </label>
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}

/** Rename the account, or correct its opening balance — the latter only until a day is counted. */
function EditAccountModal({ account, onClose, onDone }: { account: CashAccount; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("accounting");
  const [name, setName] = useState(account.name);
  const [opening, setOpening] = useState(toMajorText(account.opening_balance_minor));
  const [openingOn, setOpeningOn] = useState(account.opening_on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = account.last_closing !== null;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const patch: Parameters<typeof updateCashAccount>[1] = {};
    if (name.trim() !== account.name) patch.name = name.trim();
    if (!locked && toMinor(opening || "0") !== account.opening_balance_minor) patch.opening_balance_minor = toMinor(opening || "0");
    if (!locked && openingOn !== account.opening_on) patch.opening_on = openingOn;
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    setError(null);
    try {
      await updateCashAccount(account.id, patch);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("treasury.account.editTitle", { name: account.name })}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button type="submit" form="edit-account-form" disabled={busy || name.trim() === ""} data-testid="edit-account-save">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("treasury.save")}
          </Button>
        </>
      }
    >
      <form id="edit-account-form" onSubmit={(ev) => void submit(ev)} className="space-y-4" data-testid="edit-account-form">
        <label className="block text-sm font-medium">
          {t("treasury.accountName")}
          <input className={cn(fieldClass, "mt-1.5")} value={name} onChange={(ev) => setName(ev.target.value)} maxLength={80} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t("treasury.opening")} ({account.currency})
            <input className={cn(fieldClass, "mt-1.5")} inputMode="decimal" dir="ltr" value={opening} disabled={locked} onChange={(ev) => setOpening(ev.target.value)} data-testid="edit-account-opening" />
          </label>
          <label className="block text-sm font-medium">
            {t("treasury.openingOn")}
            <input type="date" className={cn(fieldClass, "mt-1.5")} value={openingOn} max={todayLocal()} disabled={locked} onChange={(ev) => ev.target.value && setOpeningOn(ev.target.value)} />
          </label>
        </div>
        <p className="text-muted-foreground text-xs">{locked ? t("treasury.account.openingLocked") : t("treasury.openingHint")}</p>
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}

/**
 * Delete the account. One that never held anything goes for good; one with history is stopped
 * instead (hidden, its records kept) — and only once it is empty.
 */
function DeleteAccountModal({ account, onClose, onDone }: { account: CashAccount; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = account.has_history && account.balance_minor !== 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await deleteCashAccount(account.id);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("treasury.account.deleteTitle", { name: account.name })}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          {!blocked && (
            <Button type="button" variant="destructive" onClick={() => void submit()} disabled={busy} data-testid="delete-account-confirm">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {account.has_history ? t("treasury.account.stopDo") : t("treasury.account.deleteDo")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm" data-testid="delete-account">
        <p>
          {blocked
            ? t("treasury.account.emptyFirst", { amount: formatMoney({ amount: account.balance_minor, currency: account.currency }, locale) })
            : account.has_history
              ? t("treasury.account.stopInstead")
              : t("treasury.account.deleteForGood")}
        </p>
        {error && <AlertBanner variant="error" message={error} />}
      </div>
    </Modal>
  );
}
