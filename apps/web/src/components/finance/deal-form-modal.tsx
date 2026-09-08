"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  FINANCE_CURRENCIES,
  FINANCE_DEAL_STATUSES,
  FINANCE_INTERVALS,
  FINANCE_METHODS,
  FINANCE_SERVICES,
  createFinanceDeal,
  listFinanceClientOptions,
  updateFinanceDeal,
  type FinanceClientOption,
  type FinanceDealInput,
  type FinanceDealPatch,
  type FinanceDealPayload,
  type FinanceDealRow,
  type FinanceDealStatus,
  type FinanceInterval,
  type FinanceKind,
  type FinanceMethod,
  type FinanceService,
} from "@/lib/api";
import { Field, Segmented, inputClass, textareaClass } from "./finance-fields";
import {
  DEAL_TONE,
  errorMessage,
  fromMinor,
  money,
  todayIso,
  toMinor,
} from "./finance-format";
import {
  InstallmentsEditor,
  draftsToInput,
  planTotal,
  type InstallmentDraft,
} from "./installments-editor";

/** "deal" = the full form; "income" = a sale paid on the spot (one-time, paid-now forced on). */
export type DealFormPreset = "deal" | "income";

/**
 * Create a deal, or edit one's own facts.
 *
 * On create the form does the whole job in one dialog: pick or invent the client, name what was
 * sold, choose one-time vs subscription, and either type the total (billed on the start date),
 * lay out an installment plan, or set a per-cycle price — then optionally record the money that
 * already arrived. On edit the money-shaped parts are gone on purpose: the schedule has its own
 * editor and payments their own dialog, so an "edit" can never silently rewrite what was paid.
 */
export function DealFormModal({
  open,
  onClose,
  onSaved,
  deal = null,
  preset = "deal",
  presetClientId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (payload: FinanceDealPayload) => void;
  deal?: FinanceDealRow | null;
  preset?: DealFormPreset;
  /** Pre-select this client (the clients screen's "New deal for…"). */
  presetClientId?: string;
}) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const toast = useToast();
  const editing = deal !== null;
  const income = !editing && preset === "income";

  const [clients, setClients] = useState<FinanceClientOption[] | null>(null);
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [title, setTitle] = useState("");
  const [service, setService] = useState<FinanceService>("COURSE_SITE");
  const [kind, setKind] = useState<FinanceKind>("ONE_TIME");
  const [cycle, setCycle] = useState<FinanceInterval>("MONTHLY");
  const [currency, setCurrency] = useState<string>("EGP");
  const [startedOn, setStartedOn] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState<InstallmentDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<FinanceDealStatus>("ACTIVE");
  const [paidNow, setPaidNow] = useState(false);
  const [paidOn, setPaidOn] = useState(todayIso());
  const [paidAmount, setPaidAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("INSTAPAY");
  const [reference, setReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the dialog opens — one instance is reused for every deal on a screen.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setPlan([]);
    setPaidNow(preset === "income");
    setPaidOn(todayIso());
    setPaidAmount("");
    setMethod("INSTAPAY");
    setReference("");
    setPaymentNote("");
    setClientName("");
    setClientPhone("");
    setClientEmail("");

    if (deal) {
      setClientMode("existing");
      setClientId(deal.client_id);
      setTitle(deal.title);
      setService(deal.service);
      setKind(deal.kind);
      setCycle(deal.billing_interval ?? "MONTHLY");
      setCurrency(deal.currency);
      setStartedOn(deal.started_on);
      setAmount(fromMinor(deal.amount_minor));
      setNotes(deal.notes ?? "");
      setStatus(deal.status);
    } else {
      setClientMode(presetClientId ? "existing" : "existing");
      setClientId(presetClientId ?? "");
      setTitle("");
      setService("COURSE_SITE");
      setKind("ONE_TIME");
      setCycle("MONTHLY");
      setCurrency("EGP");
      setStartedOn(todayIso());
      setAmount("");
      setNotes("");
      setStatus("ACTIVE");
    }

    let cancelled = false;
    listFinanceClientOptions()
      .then((res) => {
        if (cancelled) return;
        setClients(res.clients);
        if (!deal && !presetClientId && res.clients.length === 0)
          setClientMode("new");
      })
      .catch(() => {
        if (!cancelled) setClients([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, deal, preset, presetClientId]);

  const clientOptions = useMemo(
    () =>
      (clients ?? []).map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.phone ?? undefined,
      })),
    [clients],
  );

  const totalMinor = useMemo(() => toMinor(amount), [amount]);
  const planMinor = useMemo(() => planTotal(plan), [plan]);
  const currencyLocked = editing && (deal?.paid_minor ?? 0) > 0;

  function fail(message: string) {
    setError(message);
    setSaving(false);
  }

  async function submit() {
    setSaving(true);
    setError(null);

    try {
      if (editing && deal) {
        const patch: FinanceDealPatch = {
          title: title.trim(),
          service,
          started_on: startedOn,
          notes: notes.trim() || null,
          status,
        };
        if (!patch.title) return fail(t("form.errors.title"));
        if (clientId && clientId !== deal.client_id) patch.client_id = clientId;
        if (deal.kind === "SUBSCRIPTION") {
          const minor = toMinor(amount);
          if (minor === null) return fail(t("form.errors.amount"));
          patch.billing_interval = cycle;
          patch.amount_minor = minor;
        }
        if (!currencyLocked && currency !== deal.currency)
          patch.currency = currency;

        const payload = await updateFinanceDeal(deal.id, patch);
        toast.success(t("common.saved"));
        onSaved(payload);
        return;
      }

      const input: FinanceDealInput = {
        title: title.trim(),
        service,
        kind,
        currency,
        started_on: startedOn,
        notes: notes.trim() || null,
      };
      if (!input.title) return fail(t("form.errors.title"));

      if (clientMode === "existing") {
        if (!clientId) return fail(t("form.errors.client"));
        input.client_id = clientId;
      } else {
        if (!clientName.trim()) return fail(t("form.errors.client"));
        input.client = {
          name: clientName.trim(),
          phone: clientPhone.trim() || null,
          email: clientEmail.trim() || null,
        };
      }

      let dealTotal = 0;
      if (kind === "SUBSCRIPTION") {
        const minor = toMinor(amount);
        if (minor === null || minor <= 0) return fail(t("form.errors.amount"));
        input.billing_interval = cycle;
        input.amount_minor = minor;
        dealTotal = minor;
      } else if (plan.length > 0) {
        const rows = draftsToInput(plan);
        if (!rows) return fail(t("form.errors.plan"));
        input.installments = rows;
        dealTotal = planMinor;
      } else {
        const minor = toMinor(amount);
        if (minor === null || minor <= 0) return fail(t("form.errors.amount"));
        input.amount_minor = minor;
        dealTotal = minor;
      }

      if (paidNow) {
        // "Record income" with the amount left blank means "all of it".
        const minor = toMinor(paidAmount) ?? (income ? dealTotal : null);
        if (minor === null || minor <= 0) return fail(t("form.errors.payment"));
        input.payment = {
          paid_on: paidOn,
          amount_minor: minor,
          method,
          reference: reference.trim() || null,
          note: paymentNote.trim() || null,
        };
      }

      const payload = await createFinanceDeal(input);
      toast.success(t("common.saved"));
      onSaved(payload);
    } catch (e) {
      fail(errorMessage(e, t("form.errors.generic")));
    } finally {
      setSaving(false);
    }
  }

  const modalTitle = editing
    ? t("form.editTitle")
    : income
      ? t("form.incomeTitle")
      : t("form.newTitle");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={modalTitle}
      description={income ? t("form.incomeHint") : undefined}
      size="lg"
      closeLabel={t("actions.close")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={submit} disabled={saving}>
            {saving
              ? t("actions.saving")
              : editing
                ? t("actions.save")
                : t("actions.create")}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("actions.cancel")}
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
        {/* ── Client ─────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">{t("form.client")}</h3>
            {!editing ? (
              <Segmented
                value={clientMode}
                onChange={setClientMode}
                options={[
                  { value: "existing", label: t("form.existingClient") },
                  { value: "new", label: t("form.newClient") },
                ]}
              />
            ) : null}
          </div>
          {clientMode === "existing" ? (
            <Combobox
              options={clientOptions}
              value={clientId}
              onChange={setClientId}
              placeholder={t("form.pickClient")}
              searchPlaceholder={t("form.searchClient")}
              disabled={clients === null}
              data-testid="finance-deal-client"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label={t("form.clientName")}
                htmlFor="fin-deal-client-name"
              >
                <input
                  id="fin-deal-client-name"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field
                label={t("form.clientPhone")}
                htmlFor="fin-deal-client-phone"
              >
                <input
                  id="fin-deal-client-phone"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                  inputMode="tel"
                />
              </Field>
              <Field
                label={t("form.clientEmail")}
                htmlFor="fin-deal-client-email"
              >
                <input
                  id="fin-deal-client-email"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            </div>
          )}
        </section>

        {/* ── What was sold ──────────────────────────────────────────────── */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("form.title")}
            htmlFor="fin-deal-title"
            className="sm:col-span-2"
          >
            <input
              id="fin-deal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("form.titlePlaceholder")}
              className={inputClass}
            />
          </Field>
          <Field label={t("form.service")} htmlFor="fin-deal-service">
            <select
              id="fin-deal-service"
              value={service}
              onChange={(e) => setService(e.target.value as FinanceService)}
              className={inputClass}
            >
              {FINANCE_SERVICES.map((s) => (
                <option key={s} value={s}>
                  {t(`service.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.kind")}>
            {editing || income ? (
              <div className="flex h-9 items-center">
                <StatusChip
                  tone={kind === "SUBSCRIPTION" ? "accent" : "neutral"}
                >
                  {t(`kind.${kind}`)}
                </StatusChip>
              </div>
            ) : (
              <Segmented
                value={kind}
                onChange={setKind}
                options={[
                  { value: "ONE_TIME", label: t("kind.ONE_TIME") },
                  { value: "SUBSCRIPTION", label: t("kind.SUBSCRIPTION") },
                ]}
              />
            )}
          </Field>
          <Field
            label={t("form.currency")}
            htmlFor="fin-deal-currency"
            hint={currencyLocked ? t("form.currencyLocked") : undefined}
          >
            <select
              id="fin-deal-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={inputClass}
              disabled={currencyLocked}
            >
              {FINANCE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.startedOn")} htmlFor="fin-deal-started">
            <input
              id="fin-deal-started"
              type="date"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </Field>

          {kind === "SUBSCRIPTION" ? (
            <>
              <Field
                label={`${t("form.cyclePrice")} (${currency})`}
                htmlFor="fin-deal-cycle-price"
                hint={editing ? t("form.priceChangeHint") : undefined}
              >
                <input
                  id="fin-deal-cycle-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
              <Field label={t("form.interval")} htmlFor="fin-deal-interval">
                <select
                  id="fin-deal-interval"
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value as FinanceInterval)}
                  className={inputClass}
                >
                  {FINANCE_INTERVALS.map((i) => (
                    <option key={i} value={i}>
                      {t(`interval.${i}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : !editing ? (
            <Field
              label={`${t("form.amount")} (${currency})`}
              htmlFor="fin-deal-amount"
              hint={plan.length === 0 ? t("form.amountHint") : undefined}
              className="sm:col-span-2"
            >
              <input
                id="fin-deal-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClass}
                dir="ltr"
              />
            </Field>
          ) : null}

          {editing ? (
            <Field label={t("form.status")} htmlFor="fin-deal-status">
              <select
                id="fin-deal-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as FinanceDealStatus)}
                className={inputClass}
              >
                {FINANCE_DEAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`dealStatus.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </section>

        {/* ── Installment plan (one-time sales, on create) ───────────────── */}
        {!editing && kind === "ONE_TIME" ? (
          <section className="space-y-2">
            <div>
              <h3 className="text-xs font-semibold">{t("form.plan")}</h3>
              <p className="text-muted-foreground text-xs">
                {t("form.planHint")}
              </p>
            </div>
            <InstallmentsEditor
              rows={plan}
              onChange={setPlan}
              currency={currency}
              startedOn={startedOn}
              totalMinor={totalMinor}
            />
          </section>
        ) : null}

        <Field label={t("form.notes")} htmlFor="fin-deal-notes">
          <textarea
            id="fin-deal-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={textareaClass}
          />
        </Field>

        {/* ── Paid now (on create) ───────────────────────────────────────── */}
        {!editing ? (
          <section className="bg-muted/30 space-y-3 rounded-xl p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={paidNow}
                onChange={(e) => setPaidNow(e.target.checked)}
                disabled={income}
                className="accent-primary size-4"
              />
              {t("form.paidNow")}
              <span className="text-muted-foreground text-xs font-normal">
                — {t("form.paidNowHint")}
              </span>
            </label>
            {paidNow ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`${t("form.paidAmount")} (${currency})`}
                  htmlFor="fin-deal-paid-amount"
                >
                  <input
                    id="fin-deal-paid-amount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder={
                      kind === "ONE_TIME"
                        ? fromMinor(
                            plan.length > 0 ? planMinor : (totalMinor ?? 0),
                          )
                        : fromMinor(totalMinor ?? 0)
                    }
                    className={inputClass}
                    dir="ltr"
                  />
                </Field>
                <Field label={t("form.paidOn")} htmlFor="fin-deal-paid-on">
                  <input
                    id="fin-deal-paid-on"
                    type="date"
                    value={paidOn}
                    onChange={(e) => setPaidOn(e.target.value)}
                    className={inputClass}
                    dir="ltr"
                  />
                </Field>
                <Field label={t("form.method")} htmlFor="fin-deal-method">
                  <select
                    id="fin-deal-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as FinanceMethod)}
                    className={inputClass}
                  >
                    {FINANCE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`method.${m}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("form.reference")} htmlFor="fin-deal-reference">
                  <input
                    id="fin-deal-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t("form.referencePlaceholder")}
                    className={inputClass}
                    dir="ltr"
                  />
                </Field>
                <Field
                  label={t("form.paymentNote")}
                  htmlFor="fin-deal-payment-note"
                  className="sm:col-span-2"
                >
                  <input
                    id="fin-deal-payment-note"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
            ) : null}
          </section>
        ) : null}

        {editing && deal ? (
          <p className="text-muted-foreground text-xs">
            <StatusChip tone={DEAL_TONE[deal.status]} dot className="me-2">
              {t(`dealStatus.${deal.status}`)}
            </StatusChip>
            {money(deal.paid_minor, deal.currency, locale)} /{" "}
            {money(deal.scheduled_minor, deal.currency, locale)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
