"use client";

import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  CircleEllipsis,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  Plus,
  Scale,
  Smartphone,
  TriangleAlert,
  Vault,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MethodBadge, Panel, Tile, dayLabel, toMajorText, toMinor, todayLocal } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import {
  ACCOUNT_KINDS,
  RECEIPT_METHODS,
  closeDay,
  createCashAccount,
  createTransfer,
  getTreasury,
  mapMethodToAccount,
  type AccountKind,
  type CashAccount,
  type ReceiptMethod,
  type TreasuryState,
} from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<AccountKind, LucideIcon> = {
  CASH: Banknote,
  BANK: Landmark,
  INSTAPAY: Zap,
  WALLET: Smartphone,
  CARD: CreditCard,
  OTHER: CircleEllipsis,
};

export const KIND_TONE: Record<AccountKind, string> = {
  CASH: "from-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300",
  BANK: "from-sky-500/[0.12] text-sky-700 dark:text-sky-300",
  INSTAPAY: "from-orange-500/[0.12] text-orange-700 dark:text-orange-300",
  WALLET: "from-teal-500/[0.12] text-teal-700 dark:text-teal-300",
  CARD: "from-pink-500/[0.12] text-pink-700 dark:text-pink-300",
  OTHER: "from-slate-400/[0.12] text-slate-600 dark:text-slate-300",
};

const inputClass = fieldClass;

/**
 * The treasury (الخزينة, docs/groups/01-ACCOUNTING.md): every place the academy's money sits — the
 * cash drawer, InstaPay, the bank… — with its balance now and what moved today. Money comes in by
 * receipts (each method lands in its account), goes out by expenses, moves between accounts by
 * transfers, and a cash account is counted and closed at the end of the day.
 */
export function AccountingTreasuryScreen({ hero = true }: { hero?: boolean }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [data, setData] = useState<TreasuryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "account" } | { kind: "transfer"; from?: string } | { kind: "close"; account: CashAccount } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getTreasury());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const active = (data?.accounts ?? []).filter((a) => a.is_active);
  const stopped = (data?.accounts ?? []).filter((a) => !a.is_active);
  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of active) out[a.currency] = (out[a.currency] ?? 0) + a.balance_minor;
    return Object.entries(out);
  }, [active]);

  const done = (msg?: string) => {
    setModal(null);
    if (msg) setNotice(msg);
    void load();
  };

  // Inside the Treasury hub (`hero` off) the actions sit in a row of their own under the tabs.
  const actions =
    data?.can_manage && active.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {active.length >= 2 && (
          <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal({ kind: "transfer" })}>
            <ArrowLeftRight className="size-4" aria-hidden />
            {t("treasury.transfer")}
          </Button>
        )}
        <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setModal({ kind: "account" })} data-testid="treasury-add-account">
          <Plus className="size-4" aria-hidden />
          {t("treasury.addAccount")}
        </Button>
      </div>
    ) : undefined;

  return (
    <div className="space-y-5" data-testid="accounting-treasury">
      {hero ? (
        <PageHero icon={Vault} title={t("treasury.title")} subtitle={t("treasury.subtitle")} latticeId="accounting-treasury-hero" actions={actions} />
      ) : (
        actions && <div className="flex justify-end">{actions}</div>
      )}

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}

      {data && active.length === 0 && (
        <div className="bg-card space-y-3 rounded-2xl border p-6 text-center shadow-sm" data-testid="treasury-empty">
          <span className="bg-primary/12 text-primary ring-primary/25 mx-auto flex size-12 items-center justify-center rounded-2xl ring-1">
            <Vault className="size-6" aria-hidden />
          </span>
          <p className="font-semibold">{t("treasury.setupTitle")}</p>
          <p className="text-muted-foreground mx-auto max-w-lg text-sm">{t("treasury.setupHint")}</p>
          {data.can_manage && (
            <Button type="button" className="gap-1.5" onClick={() => setModal({ kind: "account" })}>
              <Plus className="size-4" aria-hidden />
              {t("treasury.addAccount")}
            </Button>
          )}
        </div>
      )}

      {data && active.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {totals.map(([c, v]) => (
              <Tile key={`all-${c}`} label={t("treasury.totalNow")} value={money(v, c)} icon={Vault} accent="emerald" hint={t("treasury.totalHint")} />
            ))}
            {data.month.currencies.map((m) => (
              <Tile key={`in-${m.currency}`} label={t("treasury.monthIn")} value={money(m.in_minor, m.currency)} icon={Banknote} accent="sky" />
            ))}
            {data.month.currencies.map((m) => (
              <Tile key={`out-${m.currency}`} label={t("treasury.monthOut")} value={money(m.out_minor, m.currency)} icon={Scale} accent="amber" />
            ))}
            {data.month.currencies.map((m) => (
              <Tile
                key={`net-${m.currency}`}
                label={t("treasury.monthNet")}
                value={money(m.net_minor, m.currency)}
                icon={Scale}
                accent={m.net_minor < 0 ? "rose" : "violet"}
                tone={m.net_minor < 0 ? "text-rose-600 dark:text-rose-400" : undefined}
              />
            ))}
          </div>

          {data.unmapped_methods.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <span>
                {t("treasury.unmapped", { methods: data.unmapped_methods.map((m) => `${t(`method.${m.method}`)} (${m.currency})`).join("، ") })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="treasury-accounts">
            {active.map((a) => {
              const Icon = KIND_ICON[a.kind];
              return (
                <div key={a.id} className={cn("bg-card overflow-hidden rounded-2xl border bg-gradient-to-br to-transparent shadow-sm", KIND_TONE[a.kind].split(" ")[0])} data-testid={`account-${a.id}`}>
                  {/* The card is the way in: the account's own page, money in beside money out. */}
                  <Link href={`/accounting/treasury/${a.id}`} className="hover:bg-muted/30 block p-4 transition-colors" data-testid={`open-${a.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className={cn("bg-card flex size-10 items-center justify-center rounded-xl border shadow-sm", KIND_TONE[a.kind].split(" ").slice(1).join(" "))}>
                          <Icon className="size-5" aria-hidden />
                        </span>
                        <div>
                          <p className="font-semibold">{a.name}</p>
                          <p className="text-muted-foreground text-xs">{t(`kind.${a.kind}`)}</p>
                        </div>
                      </div>
                      {a.closed_today && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <Lock className="size-3" aria-hidden />
                          {t("treasury.closedToday")}
                        </span>
                      )}
                    </div>
                    <p className={cn("mt-4 text-3xl font-bold break-words tabular-nums", a.balance_minor < 0 && "text-rose-600 dark:text-rose-400")}>{money(a.balance_minor, a.currency)}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-emerald-700 dark:text-emerald-300">▲ {t("treasury.todayIn", { amount: money(a.today_in_minor, a.currency) })}</span>
                      <span className="text-rose-700 dark:text-rose-300">▼ {t("treasury.todayOut", { amount: money(a.today_out_minor, a.currency) })}</span>
                    </div>
                    {a.last_closing && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("treasury.lastClosing", { date: dayLabel(a.last_closing.day, locale) })}
                        {a.last_closing.difference_minor !== 0 && (
                          <span className={cn("ms-1 font-semibold", a.last_closing.difference_minor < 0 ? "text-rose-600" : "text-emerald-600")}>
                            ({a.last_closing.difference_minor < 0 ? t("treasury.short") : t("treasury.over")} {money(Math.abs(a.last_closing.difference_minor), a.currency)})
                          </span>
                        )}
                      </p>
                    )}
                  </Link>
                  <div className="bg-muted/40 flex flex-wrap gap-1.5 border-t px-3 py-2">
                    <Link href={`/accounting/treasury/${a.id}`} className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "gap-1")}>
                      <BookOpen className="size-3.5" aria-hidden />
                      {t("treasury.details")}
                    </Link>
                    {data.can_close && !a.closed_today && (
                      <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setModal({ kind: "close", account: a })} data-testid={`close-${a.id}`}>
                        <Lock className="size-3.5" aria-hidden />
                        {t("treasury.closeDay")}
                      </Button>
                    )}
                    {data.can_manage && active.length >= 2 && (
                      <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setModal({ kind: "transfer", from: a.id })}>
                        <ArrowLeftRight className="size-3.5" aria-hidden />
                        {t("treasury.transfer")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Panel title={t("treasury.mapping")} icon={ArrowLeftRight} accent="sky">
            <p className="text-muted-foreground mb-3 text-sm">{t("treasury.mappingHint")}</p>
            <MethodMapping data={data} onChanged={() => void load()} />
          </Panel>
        </>
      )}

      {/* A deleted account that had history is only stopped: its page (and the way back) stays here. */}
      {stopped.length > 0 && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm" data-testid="treasury-stopped">
          <span>{t("treasury.stopped")}</span>
          {stopped.map((a) => (
            <Link key={a.id} href={`/accounting/treasury/${a.id}`} className="bg-muted/40 hover:bg-muted rounded-full border px-2.5 py-1 text-xs font-medium">
              {a.name}
            </Link>
          ))}
        </div>
      )}

      {modal?.kind === "account" && <AccountModal onClose={() => setModal(null)} onDone={() => done(t("treasury.accountAdded"))} existing={data?.methods ?? []} />}
      {modal?.kind === "transfer" && data && <TransferModal accounts={active} from={modal.from} onClose={() => setModal(null)} onDone={() => done(t("treasury.transferred"))} />}
      {modal?.kind === "close" && <CloseModal account={modal.account} onClose={() => setModal(null)} onDone={(m) => done(m)} />}
    </div>
  );
}

/** Which account each payment method's money lands in. */
function MethodMapping({ data, onChanged }: { data: TreasuryState; onChanged: () => void }) {
  const t = useTranslations("accounting");
  const [error, setError] = useState<string | null>(null);
  const currencies = [...new Set(data.accounts.filter((a) => a.is_active).map((a) => a.currency))];

  async function change(method: ReceiptMethod, currency: string, id: string) {
    setError(null);
    try {
      await mapMethodToAccount(method, currency, id || null);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.mapFailed")));
    }
  }

  return (
    <div className="space-y-2">
      {error && <AlertBanner variant="error" message={error} />}
      {currencies.map((c) => (
        <div key={c} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {RECEIPT_METHODS.map((m) => {
            const current = data.methods.find((x) => x.method === m && x.currency === c)?.cash_account_id ?? "";
            return (
              <label key={`${m}-${c}`} className="bg-muted/30 flex items-center justify-between gap-2 rounded-xl border p-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <MethodBadge method={m} />
                  {currencies.length > 1 && <span className="text-muted-foreground text-xs">{c}</span>}
                </span>
                <select
                  className={cn(inputClass, "h-9 w-40")}
                  value={current}
                  disabled={!data.can_manage}
                  onChange={(e) => void change(m, c, e.target.value)}
                  data-testid={`map-${m}-${c}`}
                >
                  <option value="">{t("treasury.noAccount")}</option>
                  {data.accounts
                    .filter((a) => a.is_active && a.currency === c)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function AccountModal({ onClose, onDone, existing }: { onClose: () => void; onDone: () => void; existing: { method: ReceiptMethod; currency: string }[] }) {
  const t = useTranslations("accounting");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("CASH");
  const [currency, setCurrency] = useState("EGP");
  const [opening, setOpening] = useState("");
  const [openingOn, setOpeningOn] = useState(todayLocal());
  const [methods, setMethods] = useState<ReceiptMethod[]>(["CASH"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A sensible default: the methods a kind of account usually takes.
  useEffect(() => {
    const byKind: Record<AccountKind, ReceiptMethod[]> = { CASH: ["CASH"], BANK: ["BANK_TRANSFER"], INSTAPAY: ["INSTAPAY"], WALLET: ["WALLET"], CARD: ["CARD"], OTHER: [] };
    setMethods(byKind[kind].filter((m) => !existing.some((e) => e.method === m && e.currency === currency)));
  }, [kind, currency, existing]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createCashAccount({ name: name.trim(), kind, currency: currency.trim().toUpperCase(), opening_balance_minor: toMinor(opening || "0"), opening_on: openingOn, methods });
      onDone();
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
      title={t("treasury.addAccount")}
      description={t("treasury.addAccountHint")}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button type="submit" form="account-form" disabled={busy || name.trim() === ""}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("treasury.save")}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="account-form">
        <label className="block text-sm font-medium">
          {t("treasury.accountName")}
          <input className={cn(inputClass, "mt-1.5")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("treasury.accountNameHint")} maxLength={80} autoFocus />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t("treasury.kind")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ACCOUNT_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium", kind === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                  <Icon className="size-4" aria-hidden />
                  {t(`kind.${k}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            {t("treasury.opening")}
            <input className={cn(inputClass, "mt-1.5")} inputMode="decimal" dir="ltr" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
          </label>
          <label className="block text-sm font-medium">
            {t("treasury.openingOn")}
            <input type="date" className={cn(inputClass, "mt-1.5")} value={openingOn} max={todayLocal()} onChange={(e) => setOpeningOn(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            {t("collect.currency")}
            <input className={cn(inputClass, "mt-1.5")} dir="ltr" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </label>
        </div>
        <p className="text-muted-foreground text-xs">{t("treasury.openingHint")}</p>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t("treasury.takes")}</legend>
          <div className="flex flex-wrap gap-2">
            {RECEIPT_METHODS.map((m) => (
              <label key={m} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", methods.includes(m) && "border-primary bg-primary/10")}>
                <input type="checkbox" className="accent-primary size-3.5" checked={methods.includes(m)} onChange={(e) => setMethods((s) => (e.target.checked ? [...s, m] : s.filter((x) => x !== m)))} />
                {t(`method.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}

export function TransferModal({ accounts, from, onClose, onDone }: { accounts: CashAccount[]; from?: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [fromId, setFromId] = useState(from ?? accounts[0]?.id ?? "");
  const source = accounts.find((a) => a.id === fromId);
  const targets = accounts.filter((a) => a.id !== fromId && a.currency === source?.currency);
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targets.some((a) => a.id === toId)) setToId(targets[0]?.id ?? "");
  }, [targets, toId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ from_account_id: fromId, to_account_id: toId, amount_minor: toMinor(amount), note });
      onDone();
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
      title={t("treasury.transfer")}
      description={t("treasury.transferHint")}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button type="submit" form="transfer-form" disabled={busy || !toId || toMinor(amount) <= 0}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("treasury.transferDo")}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t("treasury.from")}
            <select className={cn(inputClass, "mt-1.5")} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {formatMoney({ amount: a.balance_minor, currency: a.currency }, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t("treasury.to")}
            <select className={cn(inputClass, "mt-1.5")} value={toId} onChange={(e) => setToId(e.target.value)}>
              {targets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">
          {t("collect.amount", { currency: source?.currency ?? "" })}
          <input className={cn(inputClass, "mt-1.5 text-lg font-semibold")} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
        <label className="block text-sm font-medium">
          {t("collect.note")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
          <input className={cn(inputClass, "mt-1.5")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("treasury.transferNoteHint")} />
        </label>
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}

export function CloseModal({ account, onClose, onDone }: { account: CashAccount; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [counted, setCounted] = useState(toMajorText(Math.max(0, account.balance_minor)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diff = toMinor(counted) - account.balance_minor;
  const money = (v: number) => formatMoney({ amount: v, currency: account.currency }, locale);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await closeDay({ cash_account_id: account.id, counted_minor: toMinor(counted), note });
      onDone(res.difference_minor === 0 ? t("treasury.closedExact") : t("treasury.closedDiff", { diff: money(res.difference_minor) }));
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
      title={t("treasury.closeTitle", { name: account.name })}
      description={t("treasury.closeHint")}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button type="submit" form="close-form" disabled={busy || counted.trim() === ""} data-testid="close-confirm">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("treasury.closeDo")}
          </Button>
        </>
      }
    >
      <form id="close-form" onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="close-form">
        <div className="bg-muted/40 flex items-center justify-between rounded-xl border p-3 text-sm">
          <span className="text-muted-foreground">{t("treasury.expected")}</span>
          <span className="font-bold tabular-nums">{money(account.balance_minor)}</span>
        </div>
        <label className="block text-sm font-medium">
          {t("treasury.counted")}
          <input className={cn(inputClass, "mt-1.5 text-lg font-semibold")} inputMode="decimal" dir="ltr" value={counted} onChange={(e) => setCounted(e.target.value)} data-testid="close-counted" />
        </label>
        <div
          className={cn(
            "rounded-xl border p-3 text-sm font-semibold",
            diff === 0 ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : diff < 0 ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300" : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          )}
          data-testid="close-diff"
        >
          {diff === 0 ? t("treasury.matches") : diff < 0 ? t("treasury.shortBy", { amount: money(-diff) }) : t("treasury.overBy", { amount: money(diff) })}
        </div>
        <label className="block text-sm font-medium">
          {t("collect.note")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
          <input className={cn(inputClass, "mt-1.5")} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="text-muted-foreground text-xs">{t("treasury.closeLock")}</p>
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}
