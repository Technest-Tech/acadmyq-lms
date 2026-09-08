"use client";

import {
  Banknote,
  Building2,
  CircleDollarSign,
  Info,
  Landmark,
  Save,
  Smartphone,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Field, inputClass, selectClass, textareaClass } from "@/components/courses/form-bits";
import { PageHeader, Panel, SectionTitle } from "@/components/courses/lms-ui";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getLmsPaymentMethods,
  saveLmsPaymentMethods,
  setLmsCurrency,
  type LmsPaymentMethod,
  type PaymentMethodType,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Where the client's money lands (docs/lms/10 §2, brief §6) — the InstaPay handle, the wallet number,
 * the bank account, and the instructions the checkout screen prints above the upload box.
 *
 * All four methods are always on screen, switched off rather than absent: a client should be able to
 * SEE that bank transfer is supported without discovering it through an "add method" wizard. The API
 * refuses to switch on a method with no account number, so a live method always has somewhere to
 * send the money.
 */

const METHOD_META: Record<
  PaymentMethodType,
  { Icon: typeof Wallet; color: string; needsBank: boolean; needsNumber: boolean }
> = {
  INSTAPAY: { Icon: Smartphone, color: "violet", needsBank: false, needsNumber: true },
  VODAFONE_CASH: { Icon: Wallet, color: "rose", needsBank: false, needsNumber: true },
  BANK_TRANSFER: { Icon: Landmark, color: "blue", needsBank: true, needsNumber: true },
  OTHER: { Icon: Banknote, color: "slate", needsBank: false, needsNumber: false },
};

/** The currencies these clients actually sell in. Free text would only invite typos. */
const CURRENCIES = ["EGP", "SAR", "AED", "USD", "EUR", "GBP", "KWD", "QAR", "JOD"];

export function PaymentsManager() {
  const t = useTranslations("courses");
  const { can } = useAuth();
  const canManage = can("payment_method.manage");
  const canSetCurrency = can("payment_settings.manage");

  const [methods, setMethods] = useState<LmsPaymentMethod[]>([]);
  const [currency, setCurrency] = useState("EGP");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const showAlert = (variant: "success" | "error", message: string) => {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 3500);
  };

  useEffect(() => {
    getLmsPaymentMethods()
      .then((r) => {
        setMethods(r.methods);
        setCurrency(r.currency);
      })
      .catch(() => showAlert("error", t("alerts.failed")))
      .finally(() => setLoading(false));
  }, [t]);

  function patch(type: PaymentMethodType, changes: Partial<LmsPaymentMethod>) {
    setMethods((ms) => ms.map((m) => (m.type === type ? { ...m, ...changes } : m)));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await saveLmsPaymentMethods(methods);
      setMethods(r.methods);
      setDirty(false);
      showAlert("success", t("payments.saved"));
    } catch (e) {
      // The API's own message is the useful one here ("add the account number first"), not a generic
      // failure line — it names exactly which rule the client tripped.
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function changeCurrency(next: string) {
    const previous = currency;
    setCurrency(next);
    try {
      await setLmsCurrency(next);
      showAlert("success", t("payments.currencySaved"));
    } catch (e) {
      setCurrency(previous);
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    }
  }

  const activeCount = methods.filter((m) => m.is_active).length;

  return (
    <div className="space-y-5">
      <PageHeader
        Icon={Wallet}
        color="emerald"
        title={t("payments.title")}
        subtitle={t("payments.subtitle")}
        actions={
          canManage ? (
            <Button onClick={save} disabled={saving || !dirty || loading}>
              <Save className="size-4" />
              {saving ? t("payments.saving") : t("payments.save")}
            </Button>
          ) : undefined
        }
      />

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {!loading && activeCount === 0 && (
        <AlertBanner variant="info" message={t("payments.noneActiveWarning")} />
      )}

      <Panel Icon={CircleDollarSign} color="amber" title={t("payments.currency")}>
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t("payments.currencyLabel")} hint={t("payments.currencyHint")}>
            <select
              value={currency}
              disabled={!canSetCurrency}
              onChange={(e) => void changeCurrency(e.target.value)}
              className={cn(selectClass, "w-40")}
            >
              {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Panel>

      <SectionTitle
        Icon={Building2}
        color="emerald"
        title={t("payments.accounts")}
        desc={t("payments.accountsHint")}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {methods.map((m) => (
          <MethodCard
            key={m.type}
            method={m}
            disabled={!canManage}
            onChange={(changes) => patch(m.type, changes)}
          />
        ))}
      </div>

      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("payments.gatewayLater")}
      </p>
    </div>
  );
}

function MethodCard({
  method,
  disabled,
  onChange,
}: {
  method: LmsPaymentMethod;
  disabled: boolean;
  onChange: (changes: Partial<LmsPaymentMethod>) => void;
}) {
  const t = useTranslations("courses");
  const meta = METHOD_META[method.type];
  const { Icon } = meta;

  return (
    <div
      className={cn(
        "bg-card space-y-3 rounded-2xl p-5 shadow-sm ring-1 transition-colors",
        method.is_active ? "ring-primary/30" : "ring-foreground/[0.06]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="bg-muted flex size-10 items-center justify-center rounded-xl">
            <Icon className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-bold">{t(`sales.method.${method.type}`)}</h3>
            <p className="text-muted-foreground text-xs">{t(`payments.hint.${method.type}`)}</p>
          </div>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={method.is_active}
            disabled={disabled}
            onChange={(e) => onChange({ is_active: e.target.checked })}
            className="accent-primary size-4"
          />
          <span className="text-xs font-medium">{t("payments.active")}</span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {meta.needsNumber && (
          <Field label={t(`payments.number.${method.type}`)}>
            <input
              dir="ltr"
              value={method.account_number ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ account_number: e.target.value })}
              className={inputClass}
              placeholder={t(`payments.numberPlaceholder.${method.type}`)}
            />
          </Field>
        )}
        <Field label={t("payments.accountName")} hint={t("payments.accountNameHint")}>
          <input
            value={method.account_name ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ account_name: e.target.value })}
            className={inputClass}
          />
        </Field>
        {meta.needsBank && (
          <Field label={t("payments.bankName")}>
            <input
              value={method.bank_name ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ bank_name: e.target.value })}
              className={inputClass}
            />
          </Field>
        )}
        <Field label={t("payments.label")} optional={t("payments.optional")}>
          <input
            value={method.label ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ label: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t("payments.instructions")} hint={t("payments.instructionsHint")}>
        <textarea
          rows={3}
          value={method.instructions ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ instructions: e.target.value })}
          className={textareaClass}
        />
      </Field>
    </div>
  );
}
