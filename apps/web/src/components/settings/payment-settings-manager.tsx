"use client";

import {
  BadgeCheck,
  BanknoteIcon,
  CircleDashed,
  CreditCard,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  listPaymentSettings,
  savePaymentSetting,
  type BankTransferConfig,
  type PaymentMethodKey,
  type PaymentSetting,
  type PaypalConfig,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

// ── Active / Inactive badge ───────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  const t = useTranslations("settings.payment");
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        active
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
          : "bg-muted/60 text-muted-foreground",
      )}
    >
      {active ? (
        <BadgeCheck className="size-3.5" aria-hidden />
      ) : (
        <CircleDashed className="size-3.5" aria-hidden />
      )}
      {active ? t("active") : t("inactive")}
    </span>
  );
}

// ── Toggle + save row (shared by each method card) ───────────────────────────

function MethodHeader({
  method,
  isActive,
  busy,
  onToggle,
}: {
  method: PaymentMethodKey;
  isActive: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("settings.payment");
  return (
    <div className="flex items-center justify-between gap-4 pb-4">
      <StatusBadge active={isActive} />
      <Button
        type="button"
        size="sm"
        variant={isActive ? "outline" : "default"}
        className="shrink-0 gap-1.5"
        disabled={busy}
        onClick={onToggle}
        data-testid={`toggle-payment-${method.toLowerCase()}`}
      >
        {isActive ? t("deactivate") : t("activate")}
      </Button>
    </div>
  );
}

// ── Bank Transfer card ────────────────────────────────────────────────────────

function BankTransferCard({
  setting,
  onSaved,
}: {
  setting: PaymentSetting;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.payment");
  const cfg = (setting.config as Partial<BankTransferConfig>) ?? {};

  const [isActive, setIsActive]           = useState(setting.is_active);
  const [accountNumber, setAccountNumber] = useState(cfg.account_number ?? "");
  const [accountHolder, setAccountHolder] = useState(cfg.account_holder ?? "");
  const [bankName, setBankName]           = useState(cfg.bank_name ?? "");
  const [iban, setIban]                   = useState(cfg.iban ?? "");
  const [busy, setBusy]                   = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [savedFlag, setSavedFlag]         = useState(false);

  async function persist(active: boolean) {
    setBusy(true);
    setError(null);
    try {
      await savePaymentSetting("BANK_TRANSFER", {
        is_active: active,
        config: { account_number: accountNumber, account_holder: accountHolder, bank_name: bankName, iban },
      });
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 2000);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  const save = () => void persist(isActive).catch(() => {});

  // Activating/deactivating persists immediately so the public invoice page
  // reflects the change without requiring a separate Save click.
  async function toggleActive() {
    const next = !isActive;
    setIsActive(next);
    try {
      await persist(next);
    } catch {
      setIsActive(!next); // revert on failure
    }
  }

  return (
    <SectionCard
      icon={BanknoteIcon}
      title={t("bankTransfer.title")}
      description={t("bankTransfer.desc")}
      iconClassName="bg-gradient-to-br from-blue-500 to-cyan-500 shadow-blue-500/25"
      testId="payment-bank-transfer"
    >
      <div className="space-y-4">
        {error && (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        )}

        <MethodHeader
          method="BANK_TRANSFER"
          isActive={isActive}
          busy={busy}
          onToggle={() => void toggleActive()}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("bankTransfer.accountNumber")}
            </label>
            <input
              className={cn(inputBase, "px-3.5 py-2.5")}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. 1234567890"
              data-testid="bank-account-number"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("bankTransfer.accountHolder")}
            </label>
            <input
              className={cn(inputBase, "px-3.5 py-2.5")}
              value={accountHolder}
              onChange={(e) => setAccountHolder(e.target.value)}
              placeholder="e.g. Ahmed Al-Omar"
              data-testid="bank-account-holder"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("bankTransfer.bankName")}
            </label>
            <input
              className={cn(inputBase, "px-3.5 py-2.5")}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. Al Rajhi Bank"
              data-testid="bank-name"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("bankTransfer.iban")}
            </label>
            <input
              className={cn(inputBase, "px-3.5 py-2.5")}
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="SA00 0000 0000 0000 0000 0000"
              data-testid="bank-iban"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {savedFlag && (
            <span className="text-xs font-medium text-emerald-600">{t("saved")}</span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={save}
            data-testid="save-bank-transfer"
          >
            {busy ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ── PayPal card ───────────────────────────────────────────────────────────────

interface FullPaypalConfig extends PaypalConfig {
  client_id: string;
  client_secret: string;
}

function PaypalCard({
  setting,
  onSaved,
}: {
  setting: PaymentSetting;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.payment");
  const cfg = (setting.config as Partial<FullPaypalConfig>) ?? {};

  const [isActive, setIsActive]         = useState(setting.is_active);
  const [email, setEmail]               = useState(cfg.email ?? "");
  const [clientId, setClientId]         = useState(cfg.client_id ?? "");
  const [clientSecret, setClientSecret] = useState(cfg.client_secret ?? "");
  const [mode, setMode]                 = useState<"sandbox" | "live">(cfg.mode ?? "live");
  const [showSecret, setShowSecret]     = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [savedFlag, setSavedFlag]       = useState(false);

  const hasApiKeys = clientId.trim() !== "" && clientSecret.trim() !== "";

  async function persist(active: boolean) {
    setBusy(true);
    setError(null);
    try {
      await savePaymentSetting("PAYPAL", {
        is_active: active,
        config: { email, client_id: clientId, client_secret: clientSecret, mode },
      });
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 2000);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  const save = () => void persist(isActive).catch(() => {});

  // Activating/deactivating persists immediately so the public invoice page
  // reflects the change without requiring a separate Save click.
  async function toggleActive() {
    const next = !isActive;
    setIsActive(next);
    try {
      await persist(next);
    } catch {
      setIsActive(!next); // revert on failure
    }
  }

  return (
    <SectionCard
      icon={Wallet}
      title={t("paypal.title")}
      description={t("paypal.desc")}
      iconClassName="bg-gradient-to-br from-blue-600 to-indigo-600 shadow-blue-600/25"
      testId="payment-paypal"
    >
      <div className="space-y-4">
        {error && (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        )}

        <MethodHeader
          method="PAYPAL"
          isActive={isActive}
          busy={busy}
          onToggle={() => void toggleActive()}
        />

        {/* ── PayPal Email — always shown, first-class option ── */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t("paypal.email")}
          </label>
          <input
            type="email"
            className={cn(inputBase, "px-3.5 py-2.5")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@paypal.com"
            data-testid="paypal-email"
          />
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            {t("paypal.emailHint")}
          </p>
        </div>

        {/* ── API Integration — optional, enables real checkout buttons ── */}
        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <div>
            <p className="text-xs font-semibold text-foreground">{t("paypal.apiKeys")}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("paypal.apiKeysHint")}</p>
          </div>

          <div className="grid gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("paypal.clientId")}
              </label>
              <input
                className={cn(inputBase, "px-3.5 py-2.5 font-mono text-xs")}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="AaBbCcDd…"
                data-testid="paypal-client-id"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("paypal.clientSecret")}
              </label>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  className={cn(inputBase, "px-3.5 py-2.5 font-mono text-xs pe-14")}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="••••••••••••"
                  data-testid="paypal-client-secret"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute inset-y-0 end-3 flex items-center text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  aria-label={showSecret ? t("paypal.hideSecret") : t("paypal.showSecret")}
                >
                  {showSecret ? t("paypal.hideSecret") : t("paypal.showSecret")}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/70">{t("paypal.secretHint")}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("paypal.mode")}
              </label>
              <select
                className={cn(inputBase, "w-auto px-3.5 py-2.5")}
                value={mode}
                onChange={(e) => setMode(e.target.value as "sandbox" | "live")}
                data-testid="paypal-mode"
              >
                <option value="live">{t("paypal.modeLive")}</option>
                <option value="sandbox">{t("paypal.modeSandbox")}</option>
              </select>
            </div>
          </div>

          {/* Status badge for API key state */}
          {hasApiKeys ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {t("paypal.keysConfigured")}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/60">{t("paypal.keysOptional")}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {savedFlag && (
            <span className="text-xs font-medium text-emerald-600">{t("saved")}</span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={save}
            data-testid="save-paypal"
          >
            {busy ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ── XPay card (read-only) ────────────────────────────────────────────────────

/**
 * Unlike the two cards above, this one has no controls. XPay is the academy's own merchant account
 * but WE hold the keys: Academiq provisions them from the Super Admin panel and the API refuses any
 * academy-side write to the XPAY channel. So the card's whole job is to answer one question —
 * "is card payment live on my invoices?" — and point elsewhere for changes.
 */
function XPayCard({ setting }: { setting: PaymentSetting }) {
  const t = useTranslations("settings.payment");
  const active = setting.is_active;

  return (
    <SectionCard
      icon={CreditCard}
      title={t("xpay.title")}
      description={t("xpay.desc")}
      iconClassName="bg-gradient-to-br from-violet-500 to-purple-600 shadow-violet-500/25"
      testId="payment-xpay"
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-5",
          active
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
            : "border-dashed border-muted-foreground/25 bg-muted/20",
        )}
      >
        <CreditCard
          className={cn(
            "size-5 shrink-0",
            active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50",
          )}
          aria-hidden
        />
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm font-semibold",
              active ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground",
            )}
          >
            {active ? t("xpay.active") : t("xpay.inactive")}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">{t("xpay.managed")}</p>
        </div>
      </div>
    </SectionCard>
  );
}

// ── Root manager ─────────────────────────────────────────────────────────────

/** Manage the academy's payment channel configuration from the Settings → Payment tab. */
export function PaymentSettingsManager() {
  const [settings, setSettings] = useState<PaymentSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listPaymentSettings();
      setSettings(res.payment_settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSettings([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (settings === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  const bankSetting  = settings.find((s) => s.method === "BANK_TRANSFER") ?? { method: "BANK_TRANSFER" as const, is_active: false, config: {} };
  const paypalSetting = settings.find((s) => s.method === "PAYPAL")        ?? { method: "PAYPAL" as const, is_active: false, config: {} };
  const xpaySetting   = settings.find((s) => s.method === "XPAY")          ?? { method: "XPAY" as const, is_active: false, config: {} };

  return (
    <div className="space-y-4">
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}
      <BankTransferCard setting={bankSetting} onSaved={refresh} />
      <PaypalCard setting={paypalSetting} onSaved={refresh} />
      <XPayCard setting={xpaySetting} />
    </div>
  );
}
