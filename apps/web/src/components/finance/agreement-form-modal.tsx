"use client";

import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  HardDrive,
  Server,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  ACCOUNT_PLANS,
  createAccount,
  FINANCE_CURRENCIES,
  FINANCE_METHODS,
  setAccountAgreement,
  setClientAgreement,
  type AccountPayload,
  type AgreementInput,
  type FinanceClientRow,
  type FinanceMethod,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { discountPct, INTERVAL_MONTHS, PLAN_INTERVAL } from "./account-format";
import { Field, inputClass } from "./finance-fields";
import {
  addMonths,
  errorMessage,
  formatDay,
  fromMinor,
  money,
  todayIso,
  toMinor,
} from "./finance-format";
import {
  draftsToInput,
  InstallmentsEditor,
  newDraft,
  planTotal,
  type InstallmentDraft,
} from "./installments-editor";

type Plan = (typeof ACCOUNT_PLANS)[number];

/** Who the agreement is for: a platform client, an account already in the book, or a new client off our servers. */
export type AgreementTarget =
  | {
      kind: "academy";
      academyId: string;
      name: string;
      /** Still on a free trial — saving can start the paid period now. */
      inTrial?: boolean;
      trialEnd?: string | null;
      /** What its modules were sold at, to start from. */
      suggested?: { amount_minor: number; currency: string; interval: "MONTHLY" | "YEARLY" } | null;
      current?: FinanceClientRow | null;
    }
  | { kind: "account"; clientId: string; name: string; current?: FinanceClientRow | null }
  | { kind: "new" };

const PLAN_ICON: Record<Plan, ComponentType<{ className?: string }>> = {
  MONTHLY: CalendarDays,
  QUARTERLY: CalendarRange,
  SEMI_ANNUAL: CalendarRange,
  YEARLY: CalendarClock,
  ONE_TIME_SUPPORT: Server,
  OUTRIGHT: HardDrive,
};

/** Round a minor amount to whole currency units — a discount should not leave piastres behind. */
function roundUnits(minor: number): number {
  return Math.round(minor / 100) * 100;
}

/**
 * Set how a client pays — the one form for every kind of agreement (Ahmed, 2026-11-08):
 *
 *   monthly · every 3 months · every 6 months · yearly (typed as the monthly price and a discount,
 *   so the saving is on record) · one payment for the system + yearly support and server · the
 *   whole system bought outright (on the client's servers, yearly support optional).
 *
 * A one-time price may be split into installments. "Paid now" records money received on the spot.
 * The preview lists the next payments exactly as the book will expect them, so what the owner
 * confirms is what the reminders will chase. Changing an existing agreement ends the old recurring
 * line on the new line's first date; what was already due stays owed (the API guarantees it).
 */
export function AgreementFormModal({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: AgreementTarget | null;
  onClose: () => void;
  onSaved: (payload: AccountPayload) => void;
}) {
  const t = useTranslations("accounts.agreement");
  const tf = useTranslations("finance");
  const locale = useLocale();
  const toast = useToast();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [plan, setPlan] = useState<Plan>("MONTHLY");
  const [currency, setCurrency] = useState("EGP");
  const [monthly, setMonthly] = useState("");
  const [discount, setDiscount] = useState("");
  const [firstDue, setFirstDue] = useState(todayIso());
  const [oneTimeTotal, setOneTimeTotal] = useState("");
  const [rows, setRows] = useState<InstallmentDraft[]>([]);
  const [support, setSupport] = useState("");
  const [supportOn, setSupportOn] = useState(true);
  const [supportDue, setSupportDue] = useState(addMonths(todayIso(), 12));
  const [paidNow, setPaidNow] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [paidMethod, setPaidMethod] = useState<FinanceMethod>("INSTAPAY");
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the target's facts each time the dialog OPENS — never on a parent re-render, which
  // would wipe what is being typed (callers build the target inline).
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });
  useEffect(() => {
    const target = targetRef.current;
    if (!open || !target) return;
    const current = target.kind === "new" ? null : (target.current ?? null);
    const suggested = target.kind === "academy" ? target.suggested : null;
    const today = todayIso();
    const start =
      target.kind === "academy" && target.inTrial && target.trialEnd
        ? target.trialEnd.slice(0, 10)
        : current?.next_due_on && current.next_due_on > today
          ? current.next_due_on
          : today;

    let nextPlan: Plan = "MONTHLY";
    let perMonth = "";
    let pct = "";
    if (current?.plan && current.plan !== "CUSTOM") {
      nextPlan = current.plan;
    } else if (suggested?.interval === "YEARLY") {
      nextPlan = "YEARLY";
    }
    if (current?.rec_amount_minor && current.rec_interval) {
      const months = INTERVAL_MONTHS[current.rec_interval];
      const list = current.rec_list_amount_minor ?? current.rec_amount_minor;
      perMonth = fromMinor(Math.round(list / months));
      pct = String(discountPct(current.rec_amount_minor, current.rec_list_amount_minor) ?? "");
    } else if (suggested && suggested.amount_minor > 0) {
      perMonth = fromMinor(
        suggested.interval === "YEARLY" ? Math.round(suggested.amount_minor / 12) : suggested.amount_minor,
      );
    }

    setName("");
    setPhone("");
    setPlan(nextPlan);
    setCurrency(current?.rec_currency ?? suggested?.currency ?? "EGP");
    setMonthly(perMonth);
    setDiscount(pct === "0" ? "" : pct);
    setFirstDue(start);
    setOneTimeTotal("");
    setRows([]);
    setSupport("");
    setSupportOn(true);
    setSupportDue(addMonths(today, 12));
    setPaidNow(false);
    setPaidAmount("");
    setPaidMethod("INSTAPAY");
    setActivate(true);
    setError(null);
    setSaving(false);
  }, [open]);

  const interval = PLAN_INTERVAL[plan] ?? null;
  const months = interval ? INTERVAL_MONTHS[interval] : 0;
  const hasOneTime = plan === "ONE_TIME_SUPPORT" || plan === "OUTRIGHT";
  const hasSupport = plan === "ONE_TIME_SUPPORT" || (plan === "OUTRIGHT" && supportOn);

  /** The recurring price per cycle (after the discount) and before it. */
  const cycle = useMemo(() => {
    if (!interval) return null;
    const perMonth = toMinor(monthly);
    if (perMonth === null || perMonth <= 0) return null;
    const list = perMonth * months;
    const pct = Math.min(90, Math.max(0, Number(discount) || 0));
    const amount = pct > 0 ? roundUnits(list * (1 - pct / 100)) : list;

    return { amount, list: pct > 0 ? list : null };
  }, [interval, monthly, months, discount]);

  // A one-time total typed without a plan is one installment on the start date.
  const oneTimeInstallments = useMemo(() => {
    if (!hasOneTime) return null;
    if (rows.length > 0) return draftsToInput(rows);
    const total = toMinor(oneTimeTotal);

    return total && total > 0 ? [{ due_on: firstDue, amount_minor: total }] : null;
  }, [hasOneTime, rows, oneTimeTotal, firstDue]);

  const supportMinor = toMinor(support);

  /** The next payments the book will expect, oldest first (at most six). */
  const preview = useMemo(() => {
    const out: { due_on: string; amount: number; label: string }[] = [];
    if (cycle && interval) {
      const anchor = Number(firstDue.slice(8, 10));
      for (let i = 0; i < 4; i++) {
        out.push({
          due_on: addMonths(firstDue, i * months, anchor),
          amount: cycle.amount,
          label: t(`line.${plan}`),
        });
      }
    }
    for (const inst of oneTimeInstallments ?? []) {
      out.push({ due_on: inst.due_on, amount: inst.amount_minor, label: t("line.purchase") });
    }
    if (hasSupport && supportMinor && supportMinor > 0) {
      for (let i = 0; i < 2; i++) {
        out.push({
          due_on: addMonths(supportDue, i * 12),
          amount: supportMinor,
          label: t(plan === "ONE_TIME_SUPPORT" ? "line.hosting" : "line.support"),
        });
      }
    }

    return out.sort((a, b) => a.due_on.localeCompare(b.due_on)).slice(0, 6);
  }, [cycle, interval, firstDue, months, plan, oneTimeInstallments, hasSupport, supportMinor, supportDue, t]);

  if (!target) return null;

  const title =
    target.kind === "new"
      ? t("newTitle")
      : target.current?.plan
        ? t("changeTitle", { name: target.name })
        : t("title", { name: target.name });

  async function save() {
    if (!target) return;
    setError(null);
    if (target.kind === "new" && name.trim() === "") {
      setError(t("errors.name"));
      return;
    }
    const input: AgreementInput = { plan, currency };
    if (interval) {
      if (!cycle) {
        setError(t("errors.price"));
        return;
      }
      input.recurring = {
        amount_minor: cycle.amount,
        list_amount_minor: cycle.list,
        first_due_on: firstDue,
        title: t(`line.${plan}`),
      };
    }
    if (hasOneTime) {
      if (!oneTimeInstallments || oneTimeInstallments.length === 0) {
        setError(t("errors.oneTime"));
        return;
      }
      input.one_time = { title: t("line.purchase"), installments: oneTimeInstallments };
    }
    if (hasSupport) {
      if (!supportMinor || supportMinor <= 0) {
        setError(t("errors.support"));
        return;
      }
      input.recurring = {
        amount_minor: supportMinor,
        first_due_on: supportDue,
        title: t(plan === "ONE_TIME_SUPPORT" ? "line.hosting" : "line.support"),
      };
    }
    if (paidNow) {
      const amount = toMinor(paidAmount);
      if (!amount || amount <= 0) {
        setError(t("errors.paidNow"));
        return;
      }
      input.paid_now = { amount_minor: amount, paid_on: todayIso(), method: paidMethod };
    }
    if (target.kind === "academy" && target.inTrial) input.activate = activate;

    setSaving(true);
    try {
      const payload =
        target.kind === "academy"
          ? await setClientAgreement(target.academyId, input)
          : target.kind === "account"
            ? await setAccountAgreement(target.clientId, input)
            : await createAccount({ name: name.trim(), phone: phone.trim() || null, agreement: input });
      toast.success(t("saved"));
      onSaved(payload);
    } catch (e) {
      setError(errorMessage(e, tf("form.errors.generic")));
    } finally {
      setSaving(false);
    }
  }

  const per = (iv: string) => tf(`intervalShort.${iv}`);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      description={t("hint")}
      closeLabel={tf("actions.close")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving} data-testid="agreement-save">
            {saving ? tf("actions.saving") : t("save")}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {tf("actions.cancel")}
          </Button>
          {error ? (
            <span role="alert" className="text-destructive basis-full text-xs">
              {error}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {target.kind === "new" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("clientName")} htmlFor="agr-name">
              <input id="agr-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
            </Field>
            <Field label={t("clientPhone")} htmlFor="agr-phone" hint={t("clientPhoneHint")}>
              <input id="agr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} dir="ltr" placeholder="+20…" />
            </Field>
          </div>
        )}

        {/* The six agreements */}
        <div>
          <p className="mb-2 text-xs font-semibold">{t("planLabel")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("planLabel")}>
            {ACCOUNT_PLANS.map((p) => {
              const Icon = PLAN_ICON[p];
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={plan === p}
                  onClick={() => setPlan(p)}
                  data-testid={`plan-${p}`}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors",
                    plan === p
                      ? "border-primary bg-primary/5 ring-primary/20 ring-2"
                      : "hover:border-foreground/20 border-border",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <Icon className={cn("size-4", plan === p ? "text-primary" : "text-muted-foreground")} />
                    {t(`plan.${p}`)}
                  </span>
                  <span className="text-muted-foreground text-[11px] leading-snug">{t(`planHint.${p}`)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={tf("form.currency")} htmlFor="agr-currency">
            <select id="agr-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
              {FINANCE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          {interval && (
            <>
              <Field label={interval === "MONTHLY" ? t("pricePerMonth") : t("monthlyPrice")} htmlFor="agr-monthly">
                <input
                  id="agr-monthly"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                  data-testid="agr-monthly"
                />
              </Field>
              {interval !== "MONTHLY" ? (
                <Field label={t("discount")} htmlFor="agr-discount">
                  <input
                    id="agr-discount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={90}
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className={inputClass}
                    dir="ltr"
                    placeholder="0"
                    data-testid="agr-discount"
                  />
                </Field>
              ) : (
                <Field label={t("firstDue")} htmlFor="agr-first">
                  <input id="agr-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={inputClass} dir="ltr" />
                </Field>
              )}
              {interval !== "MONTHLY" && (
                <Field label={t("firstDue")} htmlFor="agr-first" className="sm:col-start-1">
                  <input id="agr-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={inputClass} dir="ltr" />
                </Field>
              )}
              {cycle && (
                <div className="bg-muted/50 flex flex-col justify-center rounded-lg px-3 py-2 sm:col-span-2" data-testid="agr-cycle">
                  <span className="text-sm font-bold tabular-nums">
                    {money(cycle.amount, currency, locale)} / {per(interval)}
                  </span>
                  {cycle.list !== null && (
                    <span className="text-muted-foreground text-xs">
                      {t("instead", {
                        list: money(cycle.list, currency, locale),
                        saved: money(cycle.list - cycle.amount, currency, locale),
                      })}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {hasOneTime && (
          <div className="space-y-3 rounded-xl border p-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("systemPrice")} htmlFor="agr-onetime" hint={t("systemPriceHint")}>
                <input
                  id="agr-onetime"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={oneTimeTotal}
                  onChange={(e) => setOneTimeTotal(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                  data-testid="agr-onetime"
                />
              </Field>
              <Field label={t("purchaseOn")} htmlFor="agr-purchase">
                <input
                  id="agr-purchase"
                  type="date"
                  value={firstDue}
                  onChange={(e) => {
                    setFirstDue(e.target.value);
                    if (e.target.value) setSupportDue(addMonths(e.target.value, 12));
                  }}
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            </div>
            <details className="group">
              <summary className="text-primary cursor-pointer text-xs font-semibold">{t("installments")}</summary>
              <div className="mt-3">
                <InstallmentsEditor
                  rows={rows}
                  onChange={setRows}
                  currency={currency}
                  startedOn={firstDue}
                  totalMinor={toMinor(oneTimeTotal) ?? (rows.length > 0 ? planTotal(rows) : null)}
                />
                {rows.length === 0 && (
                  <Button type="button" size="xs" variant="outline" className="mt-2" onClick={() => setRows([newDraft(firstDue, oneTimeTotal)])}>
                    {tf("form.addInstallment")}
                  </Button>
                )}
              </div>
            </details>

            {plan === "OUTRIGHT" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={supportOn} onChange={(e) => setSupportOn(e.target.checked)} className="accent-primary size-4" />
                {t("withSupport")}
              </label>
            )}
            {hasSupport && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t(plan === "ONE_TIME_SUPPORT" ? "hostingPrice" : "supportPrice")} htmlFor="agr-support">
                  <input
                    id="agr-support"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={support}
                    onChange={(e) => setSupport(e.target.value)}
                    className={inputClass}
                    dir="ltr"
                    data-testid="agr-support"
                  />
                </Field>
                <Field label={t("supportFrom")} htmlFor="agr-support-due">
                  <input id="agr-support-due" type="date" value={supportDue} onChange={(e) => setSupportDue(e.target.value)} className={inputClass} dir="ltr" />
                </Field>
              </div>
            )}
          </div>
        )}

        {/* Money received on the spot */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} className="accent-primary size-4" />
            {t("paidNow")}
          </label>
          {paidNow && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={`${tf("form.paidAmount")} (${currency})`} htmlFor="agr-paid">
                <input
                  id="agr-paid"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
              <Field label={tf("form.method")} htmlFor="agr-paid-method">
                <select id="agr-paid-method" value={paidMethod} onChange={(e) => setPaidMethod(e.target.value as FinanceMethod)} className={inputClass}>
                  {FINANCE_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {tf(`method.${m}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {target.kind === "academy" && target.inTrial && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} className="accent-primary size-4" />
              {t("activate")}
            </label>
          )}
        </div>

        {/* What the book will expect */}
        {preview.length > 0 && (
          <div className="bg-muted/40 rounded-xl p-3" data-testid="agr-preview">
            <p className="mb-2 text-xs font-semibold">{t("preview")}</p>
            <ol className="space-y-1.5">
              {preview.map((p, i) => (
                <li key={`${p.due_on}-${i}`} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground min-w-0">
                    <span className="text-foreground font-medium tabular-nums">{formatDay(p.due_on, locale)}</span> · {p.label}
                  </span>
                  <span className="font-semibold tabular-nums">{money(p.amount, currency, locale)}</span>
                </li>
              ))}
            </ol>
            {target.kind !== "new" && target.current?.plan && <p className="text-muted-foreground mt-2 text-[11px]">{t("changeNote")}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
