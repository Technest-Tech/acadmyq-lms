"use client";

import {
  Banknote,
  Briefcase,
  Mail,
  Settings,
  ShieldCheck,
  Smartphone,
  ToggleLeft,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { RoleEditorScreen } from "../roles/screen";
import { StaffDepartmentsScreen } from "../staff-departments/screen";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  getFeatureFlags,
  getPlatformSettings,
  updateFeatureFlag,
  updatePlatformSettings,
  type FeatureFlag,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// The known platform-setting fields surfaced as a form (values are stored as freeform JSON).
const SETTING_FIELDS = [
  "support_email",
  "smtp_host",
  "smtp_port",
  "smtp_username",
  "smtp_from_name",
] as const;

const inputClass =
  "border-input bg-background w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

const cardClass =
  "bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]";

interface PayMethod {
  enabled: boolean;
  display_name: string;
  handle?: string;
  number?: string;
}

const DEFAULT_PAY = {
  INSTAPAY: { enabled: true, display_name: "InstaPay", handle: "" },
  VODAFONE_CASH: { enabled: true, display_name: "Vodafone Cash", number: "" },
} satisfies Record<string, PayMethod>;

function Toggle({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        on ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function PlatformSettingsScreen() {
  const t = useTranslations("platformSettings");
  const { can } = useAuth();

  // R3 (client-first redesign): the rare-touch catalogs — role permissions & staff departments —
  // fold in here as tabs, taking their sidebar slots away (9 flat items).
  const [tab, setTab] = useState<
    "flags" | "general" | "payment" | "roles" | "departments"
  >("flags");
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<{
    INSTAPAY: PayMethod;
    VODAFONE_CASH: PayMethod;
  }>(DEFAULT_PAY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getFeatureFlags()
      .then((r) => setFlags(r.flags))
      .catch(() => setError(t("loadError")));
    getPlatformSettings()
      .then((r) => {
        const next: Record<string, string> = {};
        for (const k of SETTING_FIELDS) {
          const v = r.settings[k];
          next[k] = v === undefined || v === null ? "" : String(v);
        }
        setSettings(next);

        const pm = r.settings.platform_payment_methods as
          | Record<string, PayMethod>
          | undefined;
        if (pm) {
          setPay({
            INSTAPAY: { ...DEFAULT_PAY.INSTAPAY, ...(pm.INSTAPAY ?? {}) },
            VODAFONE_CASH: {
              ...DEFAULT_PAY.VODAFONE_CASH,
              ...(pm.VODAFONE_CASH ?? {}),
            },
          });
        }
      })
      .catch(() => setError(t("loadError")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function toggleFlag(flag: FeatureFlag) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updateFeatureFlag(flag.key, { enabled: !flag.enabled });
      setFlags(
        (fs) =>
          fs?.map((f) =>
            f.key === flag.key ? { ...f, enabled: !f.enabled } : f,
          ) ?? null,
      );
      setNotice(t("saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function persist(payload: Record<string, unknown>, e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updatePlatformSettings(payload);
      setNotice(t("saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const TAB_ICON = {
    flags: ToggleLeft,
    general: Mail,
    payment: Wallet,
    roles: ShieldCheck,
    departments: Briefcase,
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <Settings className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t("subtitle")}
            </p>
          </div>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} />}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b">
        {(["flags", "general", "payment", "roles", "departments"] as const).map((tk) => {
          const Icon = TAB_ICON[tk];
          return (
            <button
              key={tk}
              type="button"
              onClick={() => setTab(tk)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                tab === tk
                  ? "border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
              data-testid={`tab-${tk}`}
            >
              <Icon className="size-4" aria-hidden />
              {t(`tab.${tk}`)}
            </button>
          );
        })}
      </div>

      {/* Feature flags */}
      {tab === "flags" && (
        <section className="space-y-3">
          <p className="text-muted-foreground text-sm">{t("flagsHint")}</p>
          {flags === null ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-16 animate-pulse rounded-xl"
                  aria-hidden
                />
              ))}
            </div>
          ) : flags.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noFlags")}</p>
          ) : (
            <div className="space-y-2">
              {flags.map((f) => (
                <div
                  key={f.key}
                  className="bg-card flex items-center justify-between gap-4 rounded-xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]"
                  data-flag={f.key}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{f.description ?? f.key}</p>
                    <p
                      className="text-muted-foreground font-mono text-xs"
                      dir="ltr"
                    >
                      {f.key}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        f.enabled
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                      )}
                    >
                      {f.enabled ? t("enabled") : t("disabled")}
                    </span>
                    <Toggle
                      on={f.enabled}
                      disabled={busy}
                      onClick={() => void toggleFlag(f)}
                      label={f.key}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* General settings */}
      {tab === "general" && (
        <form
          className="max-w-2xl"
          onSubmit={(e) => void persist(settings, e)}
        >
          <div className={cardClass}>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Mail className="text-muted-foreground size-4" aria-hidden />
              {t("generalHeading")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {SETTING_FIELDS.map((key) => (
                <label key={key} className="block space-y-1.5">
                  <span className="text-sm font-medium">
                    {t(`field.${key}`)}
                  </span>
                  <input
                    aria-label={t(`field.${key}`)}
                    className={inputClass}
                    dir="ltr"
                    value={settings[key] ?? ""}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <Button type="submit" size="sm" disabled={busy} data-testid="save-settings">
                {busy ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Platform receiving methods (academies pay their subscription here) */}
      {tab === "payment" && (
        <form
          className="max-w-2xl"
          onSubmit={(e) => void persist({ platform_payment_methods: pay }, e)}
        >
          <div className={cardClass}>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Banknote className="text-muted-foreground size-4" aria-hidden />
              {t("payment.heading")}
            </h2>
            <p className="text-muted-foreground mb-4 mt-0.5 text-xs">
              {t("payment.hint")}
            </p>

            <div className="space-y-3">
              <MethodCard
                icon={Wallet}
                title={t("payment.instapay")}
                fieldLabel={t("payment.instapayHandle")}
                placeholder="name@instapay"
                enabled={pay.INSTAPAY.enabled}
                value={pay.INSTAPAY.handle ?? ""}
                onToggle={(v) =>
                  setPay((p) => ({
                    ...p,
                    INSTAPAY: { ...p.INSTAPAY, enabled: v },
                  }))
                }
                onChange={(v) =>
                  setPay((p) => ({
                    ...p,
                    INSTAPAY: { ...p.INSTAPAY, handle: v },
                  }))
                }
                inputClass={inputClass}
              />
              <MethodCard
                icon={Smartphone}
                title={t("payment.vodafone")}
                fieldLabel={t("payment.vodafoneNumber")}
                placeholder="+201xxxxxxxxx"
                enabled={pay.VODAFONE_CASH.enabled}
                value={pay.VODAFONE_CASH.number ?? ""}
                onToggle={(v) =>
                  setPay((p) => ({
                    ...p,
                    VODAFONE_CASH: { ...p.VODAFONE_CASH, enabled: v },
                  }))
                }
                onChange={(v) =>
                  setPay((p) => ({
                    ...p,
                    VODAFONE_CASH: { ...p.VODAFONE_CASH, number: v },
                  }))
                }
                inputClass={inputClass}
              />
            </div>

            <div className="mt-5 flex justify-end">
              <Button type="submit" size="sm" disabled={busy} data-testid="save-payment">
                {busy ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Role permissions matrix (moved from /admin/roles — R3) */}
      {tab === "roles" && <RoleEditorScreen />}

      {/* Staff departments catalog (moved from /admin/staff-departments — R3) */}
      {tab === "departments" && <StaffDepartmentsScreen />}
    </div>
  );
}

function MethodCard({
  icon: Icon,
  title,
  fieldLabel,
  placeholder,
  enabled,
  value,
  onToggle,
  onChange,
  inputClass,
}: {
  icon: typeof Wallet;
  title: string;
  fieldLabel: string;
  placeholder: string;
  enabled: boolean;
  value: string;
  onToggle: (v: boolean) => void;
  onChange: (v: string) => void;
  inputClass: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        enabled ? "border-primary/30 bg-primary/[0.03]" : "bg-muted/20",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon className="text-primary size-4" aria-hidden />
          {title}
        </span>
        <Toggle on={enabled} disabled={false} onClick={() => onToggle(!enabled)} label={title} />
      </div>
      <label className="block space-y-1.5">
        <span className="text-muted-foreground text-xs">{fieldLabel}</span>
        <input
          className={inputClass}
          dir="ltr"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
