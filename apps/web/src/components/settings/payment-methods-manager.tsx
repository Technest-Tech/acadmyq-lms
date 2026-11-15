"use client";

import { Banknote, CreditCard, Landmark, Plus, Smartphone, Wallet, X, Zap, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ApiError, listPaymentSettings, type PaymentMethodKey, type PaymentSetting, savePaymentSetting } from "@/lib/api";
import { cn } from "@/lib/utils";
import { walletProvider } from "@/lib/wallet-provider";

type ManualKey = Exclude<PaymentMethodKey, "XPAY">;
type Config = Record<string, string | string[]>;

interface Draft {
  is_active: boolean;
  config: Config;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  /** Numbers, addresses, links: typed left-to-right whatever the page direction. */
  ltr?: boolean;
  multiline?: boolean;
  /** Spans both columns on a wide screen. */
  wide?: boolean;
}

const MAX_WALLET_NUMBERS = 3;

/** The academy's own methods, in display order — the Egyptian ones first, then abroad, then the catch-all. */
const MANUAL: ReadonlyArray<{ key: ManualKey; icon: LucideIcon; tone: string; fields: FieldDef[] }> = [
  {
    key: "WALLET",
    icon: Smartphone,
    tone: "bg-rose-500/10 text-rose-600",
    fields: [{ key: "holder", label: "walletHolder", wide: true }],
  },
  {
    key: "INSTAPAY",
    icon: Zap,
    tone: "bg-violet-500/10 text-violet-600",
    fields: [
      { key: "address", label: "address", placeholder: "address", ltr: true },
      { key: "link", label: "link", placeholder: "link", ltr: true },
      { key: "holder", label: "instapayName", wide: true },
    ],
  },
  {
    key: "BANK_TRANSFER",
    icon: Landmark,
    tone: "bg-sky-500/10 text-sky-600",
    fields: [
      { key: "bank_name", label: "bankName" },
      { key: "account_holder", label: "accountHolder" },
      { key: "account_number", label: "accountNumber", ltr: true },
      { key: "iban", label: "iban", ltr: true },
      { key: "swift", label: "swift", ltr: true, wide: true },
    ],
  },
  {
    key: "PAYPAL",
    icon: Wallet,
    tone: "bg-blue-500/10 text-blue-700",
    fields: [
      { key: "email", label: "email", placeholder: "email", ltr: true },
      { key: "paypal_me", label: "paypalMe", placeholder: "paypalMe", ltr: true },
    ],
  },
  {
    key: "OTHER",
    icon: Banknote,
    tone: "bg-amber-500/10 text-amber-700",
    fields: [
      { key: "title", label: "title", placeholder: "title", wide: true },
      { key: "details", label: "details", placeholder: "details", multiline: true, wide: true },
    ],
  },
];

/** OTHER's details already are the note; every other method takes one. */
const HAS_NOTE: Record<ManualKey, boolean> = { WALLET: true, INSTAPAY: true, BANK_TRANSFER: true, PAYPAL: true, OTHER: false };

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

const text = (c: Config, key: string): string => {
  const v = c[key];
  return typeof v === "string" ? v.trim() : "";
};
const numbers = (c: Config): string[] => (Array.isArray(c.numbers) ? c.numbers : []);

/** The same rule as the API's: a live method must give the payer somewhere to send the money. */
function usable(key: ManualKey, c: Config): boolean {
  switch (key) {
    case "WALLET":
      return numbers(c).some((n) => n.trim() !== "");
    case "INSTAPAY":
      return text(c, "address") !== "" || text(c, "link") !== "";
    case "BANK_TRANSFER":
      return text(c, "account_number") !== "" || text(c, "iban") !== "";
    case "PAYPAL":
      return text(c, "email") !== "" || text(c, "paypal_me") !== "" || text(c, "client_id") !== "";
    case "OTHER":
      return text(c, "details") !== "";
  }
}

/** A link the payer will open must be web: anything with another scheme is refused before the API refuses it. */
function badLink(value: string): boolean {
  if (value === "") return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  return scheme !== undefined && scheme !== "http" && scheme !== "https";
}

/** Only the fields the form owns go back — PayPal's API keys stay as the server holds them. */
function payload(key: ManualKey, c: Config, fields: FieldDef[]): Config {
  const out: Config = {};
  for (const f of fields) out[f.key] = text(c, f.key);
  if (key === "WALLET") out.numbers = numbers(c).map((n) => n.trim()).filter((n) => n !== "");
  if (HAS_NOTE[key]) out.note = text(c, "note");
  return out;
}

function toDraft(row: PaymentSetting | undefined): Draft {
  return {
    is_active: row?.is_active ?? false,
    config: { ...((row?.config ?? {}) as Config) },
    dirty: false,
    saving: false,
    saved: false,
    error: null,
  };
}

/**
 * Settings → Payment methods: the academy picks which ways to pay its payers see on the bill page
 * (`/i/`) and the family page (`/f/`) — wallet numbers and InstaPay for families in Egypt, PayPal and
 * a bank account for families abroad, or anything else in its own words — and fills in the details.
 * Each card saves on its own. Card payment (XPay) is set up by Acadmyq; the academy only switches it.
 */
export function PaymentMethodsManager() {
  const t = useTranslations("settings.payments");
  const lang = useLocale() === "ar" ? "ar" : "en";
  const [drafts, setDrafts] = useState<Record<ManualKey, Draft> | null>(null);
  const [xpay, setXpay] = useState<{ is_active: boolean; configured: boolean; saving: boolean }>({
    is_active: false,
    configured: false,
    saving: false,
  });
  const [paypalAuto, setPaypalAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { payment_settings: rows } = await listPaymentSettings();
      const by = new Map(rows.map((r) => [r.method, r]));
      setDrafts(
        Object.fromEntries(MANUAL.map(({ key }) => [key, toDraft(by.get(key))])) as Record<ManualKey, Draft>,
      );
      const x = by.get("XPAY");
      setXpay({ is_active: x?.is_active ?? false, configured: x?.configured ?? false, saving: false });
      const paypal = (by.get("PAYPAL")?.config ?? {}) as Config;
      setPaypalAuto(text(paypal, "client_id") !== "");
    } catch {
      setError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(key: ManualKey, change: Partial<Pick<Draft, "is_active">> & { config?: Config }) {
    setDrafts((d) =>
      d === null
        ? d
        : {
            ...d,
            [key]: {
              ...d[key],
              ...change,
              config: change.config ?? d[key].config,
              dirty: true,
              saved: false,
              error: null,
            },
          },
    );
  }

  function setField(key: ManualKey, field: string, value: string | string[]) {
    if (!drafts) return;
    patch(key, { config: { ...drafts[key].config, [field]: value } });
  }

  async function save(key: ManualKey, fields: FieldDef[]) {
    if (!drafts) return;
    const draft = drafts[key];
    const fail = (message: string) =>
      setDrafts((d) => (d === null ? d : { ...d, [key]: { ...d[key], saving: false, error: message } }));

    if (draft.is_active && !usable(key, draft.config)) return fail(t(`errors.${key}`));
    if (badLink(text(draft.config, "link")) || badLink(text(draft.config, "paypal_me"))) return fail(t("errors.link"));
    const email = text(draft.config, "email");
    if (key === "PAYPAL" && email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(t("errors.email"));

    setDrafts((d) => (d === null ? d : { ...d, [key]: { ...d[key], saving: true, error: null } }));
    try {
      await savePaymentSetting(key, { is_active: draft.is_active, config: payload(key, draft.config, fields) });
      // Re-read: the API normalises what it stores (https:// on a bare link, cleaned numbers).
      const { payment_settings: rows } = await listPaymentSettings();
      const fresh = toDraft(rows.find((r) => r.method === key));
      setDrafts((d) => (d === null ? d : { ...d, [key]: { ...fresh, saved: true } }));
      setTimeout(
        () => setDrafts((d) => (d === null || !d[key].saved ? d : { ...d, [key]: { ...d[key], saved: false } })),
        2500,
      );
    } catch (err) {
      fail(err instanceof ApiError && err.status === 422 ? err.message : t("failed"));
    }
  }

  async function toggleXpay() {
    if (!xpay.configured || xpay.saving) return;
    const next = !xpay.is_active;
    setXpay((x) => ({ ...x, is_active: next, saving: true }));
    try {
      await savePaymentSetting("XPAY", { is_active: next });
      setXpay((x) => ({ ...x, saving: false }));
    } catch (err) {
      setXpay((x) => ({ ...x, is_active: !next, saving: false }));
      setError(err instanceof ApiError ? err.message : t("failed"));
    }
  }

  const liveCount = drafts === null ? 0 : MANUAL.filter(({ key }) => drafts[key].is_active && !drafts[key].dirty).length;

  return (
    <SectionCard
      icon={Wallet}
      title={t("cardTitle")}
      description={t("cardDesc")}
      iconClassName="bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/25"
      testId="payment-methods-card"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {drafts === null ? (
        !error && (
          <div className="flex items-center justify-center py-8">
            <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        )
      ) : (
        <div className="space-y-3">
          {liveCount === 0 && !xpay.is_active && <AlertBanner variant="info" message={t("noneActive")} />}

          <ul className="space-y-3">
            {MANUAL.map(({ key, icon: Icon, tone, fields }) => {
              const draft = drafts[key];
              const title = t(`methods.${key}.title`);
              return (
                <li
                  key={key}
                  data-testid={`pay-method-${key}`}
                  className={cn(
                    "rounded-xl border p-4 transition-colors",
                    draft.is_active ? "border-primary/30 bg-primary/[0.02]" : "bg-card",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tone)}>
                      <Icon className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{t(`methods.${key}.desc`)}</p>
                      <p
                        className={cn(
                          "mt-1 text-[11px] font-semibold",
                          draft.is_active ? "text-emerald-600" : "text-muted-foreground",
                        )}
                      >
                        {draft.is_active ? t("on") : t("off")}
                      </p>
                    </div>
                    <Switch
                      className="mt-1"
                      checked={draft.is_active}
                      onChange={(e) => patch(key, { is_active: e.target.checked })}
                      disabled={draft.saving}
                      aria-label={title}
                      data-testid={`pay-toggle-${key}`}
                    />
                  </div>

                  {draft.is_active && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {key === "WALLET" && (
                        <WalletNumbers
                          values={numbers(draft.config)}
                          lang={lang}
                          onChange={(next) => setField(key, "numbers", next)}
                        />
                      )}
                      {fields.map((f) => (
                        <label key={f.key} className={cn("block space-y-1", f.wide && "sm:col-span-2")}>
                          <span className="text-xs font-medium">{t(`fields.${f.label}`)}</span>
                          {f.multiline ? (
                            <textarea
                              rows={3}
                              dir="auto"
                              value={typeof draft.config[f.key] === "string" ? (draft.config[f.key] as string) : ""}
                              placeholder={f.placeholder ? t(`placeholders.${f.placeholder}`) : undefined}
                              onChange={(e) => setField(key, f.key, e.target.value)}
                              className={inputBase}
                              data-testid={`pay-${key}-${f.key}`}
                            />
                          ) : (
                            <input
                              type={f.key === "email" ? "email" : "text"}
                              dir={f.ltr ? "ltr" : "auto"}
                              value={typeof draft.config[f.key] === "string" ? (draft.config[f.key] as string) : ""}
                              placeholder={f.placeholder ? t(`placeholders.${f.placeholder}`) : undefined}
                              onChange={(e) => setField(key, f.key, e.target.value)}
                              className={inputBase}
                              data-testid={`pay-${key}-${f.key}`}
                            />
                          )}
                        </label>
                      ))}
                      {HAS_NOTE[key] && (
                        <label className="block space-y-1 sm:col-span-2">
                          <span className="text-xs font-medium">{t("fields.note")}</span>
                          <textarea
                            rows={2}
                            dir="auto"
                            value={typeof draft.config.note === "string" ? draft.config.note : ""}
                            placeholder={t("placeholders.note")}
                            onChange={(e) => setField(key, "note", e.target.value)}
                            className={inputBase}
                            data-testid={`pay-${key}-note`}
                          />
                        </label>
                      )}
                      {key === "PAYPAL" && paypalAuto && (
                        <p className="text-xs font-medium text-emerald-700 sm:col-span-2">{t("paypalAuto")}</p>
                      )}
                    </div>
                  )}

                  {draft.error && (
                    <p role="alert" className="text-destructive mt-3 text-xs font-medium">
                      {draft.error}
                    </p>
                  )}
                  {(draft.dirty || draft.saved) && (
                    <div className="mt-3 flex items-center justify-end gap-3">
                      {draft.saved && <span className="text-xs font-medium text-emerald-600">{t("saved")}</span>}
                      {draft.dirty && (
                        <Button
                          size="sm"
                          onClick={() => void save(key, fields)}
                          disabled={draft.saving}
                          data-testid={`pay-save-${key}`}
                        >
                          {draft.saving ? t("saving") : t("save")}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}

            {/* Card payment: keys are Acadmyq's to set; the academy only shows or hides the button. */}
            <li
              data-testid="pay-method-XPAY"
              className={cn("rounded-xl border p-4", !xpay.configured && "bg-muted/30")}
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
                  <CreditCard className="size-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t("methods.XPAY.title")}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                    {xpay.configured ? t("methods.XPAY.desc") : t("xpayNotSetUp")}
                  </p>
                  {xpay.configured && (
                    <p
                      className={cn(
                        "mt-1 text-[11px] font-semibold",
                        xpay.is_active ? "text-emerald-600" : "text-muted-foreground",
                      )}
                    >
                      {xpay.is_active ? t("on") : t("off")}
                    </p>
                  )}
                </div>
                <Switch
                  className="mt-1"
                  checked={xpay.is_active}
                  onChange={() => void toggleXpay()}
                  disabled={!xpay.configured || xpay.saving}
                  aria-label={t("methods.XPAY.title")}
                  data-testid="pay-toggle-XPAY"
                />
              </div>
            </li>
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

/** Up to three wallet numbers, each labelled with the network it belongs to as it is typed. */
function WalletNumbers({
  values,
  lang,
  onChange,
}: {
  values: string[];
  lang: "ar" | "en";
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("settings.payments");
  const rows = values.length === 0 ? [""] : values;

  return (
    <div className="space-y-2 sm:col-span-2">
      <span className="text-xs font-medium">{t("fields.number")}</span>
      {rows.map((value, i) => {
        const provider = value.trim() === "" ? null : walletProvider(value)[lang];
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="tel"
                dir="ltr"
                inputMode="tel"
                value={value}
                placeholder={t("placeholders.number")}
                onChange={(e) => onChange(rows.map((v, j) => (j === i ? e.target.value : v)))}
                className={cn(inputBase, provider && "pe-28")}
                aria-label={`${t("fields.number")} ${i + 1}`}
                data-testid={`pay-WALLET-number-${i}`}
              />
              {provider && (
                <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] font-medium">
                  {provider}
                </span>
              )}
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex size-8 shrink-0 items-center justify-center rounded-lg"
                aria-label={t("fields.removeNumber")}
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
        );
      })}
      {rows.length < MAX_WALLET_NUMBERS && (
        <button
          type="button"
          onClick={() => onChange([...rows, ""])}
          className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
          data-testid="pay-WALLET-add-number"
        >
          <Plus className="size-3.5" aria-hidden />
          {t("fields.addNumber")}
        </button>
      )}
    </div>
  );
}
