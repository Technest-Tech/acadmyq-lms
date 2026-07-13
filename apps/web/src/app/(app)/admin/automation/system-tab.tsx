"use client";

import { Activity, Clock, Gauge, Loader2, Save, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  getGatewayHealth,
  getGatewaySettings,
  updateGatewaySettings,
  type GatewayHealth,
  type GatewaySettings,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

function fmtUptime(sec: number | undefined): string {
  if (!sec || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Field({
  label,
  hint,
  value,
  onChange,
  min,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-xs font-medium">{label}</label>
      <input
        type="number"
        min={min ?? 0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
        className="bg-background w-full rounded-lg border px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
      />
      {hint && <p className="text-muted-foreground mt-1 text-[11px]">{hint}</p>}
    </div>
  );
}

const COUNTS: Array<{ key: keyof NonNullable<GatewayHealth["sessions"]>; labelKey: string; clr: string }> = [
  { key: "total", labelKey: "sTotal", clr: "text-foreground" },
  { key: "connected", labelKey: "sConnected", clr: "text-emerald-600" },
  { key: "connecting", labelKey: "sConnecting", clr: "text-amber-600" },
  { key: "qr", labelKey: "sQr", clr: "text-amber-600" },
  { key: "disconnected", labelKey: "sDisconnected", clr: "text-slate-500" },
  { key: "logged_out", labelKey: "sLoggedOut", clr: "text-rose-600" },
];

export function SystemTab() {
  const t = useTranslations("adminAutomation");
  const locale = useLocale();

  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [form, setForm] = useState<GatewaySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await getGatewayHealth());
    } catch {
      setHealth({ ok: false, up: false });
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await getGatewaySettings();
      if (res.settings) setForm(res.settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("system.loadError"));
    }
  }, [t]);

  useEffect(() => {
    mounted.current = true;
    void loadHealth();
    void loadSettings();
    const iv = setInterval(() => void loadHealth(), 10000);
    return () => {
      mounted.current = false;
      clearInterval(iv);
    };
  }, [loadHealth, loadSettings]);

  function set<K extends keyof GatewaySettings>(key: K, v: number) {
    setForm((f) => (f ? { ...f, [key]: v } : f));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    if (form.maxIntervalMs < form.minIntervalMs || form.warmupMaxIntervalMs < form.warmupMinIntervalMs) {
      setError(t("system.invalidRange"));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateGatewaySettings(form);
      if (res.settings) setForm(res.settings);
      if (!res.ok) throw new Error("save_failed");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("system.saveError"));
    } finally {
      setSaving(false);
    }
  }

  const up = health?.up === true;
  const sessions = health?.sessions;

  return (
    <div className="space-y-5">
      {error && <AlertBanner variant="error" message={error} />}

      {/* Gateway health */}
      <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("flex size-11 items-center justify-center rounded-xl text-white", up ? "bg-gradient-to-br from-emerald-500 to-teal-600" : "bg-gradient-to-br from-rose-500 to-rose-700")}>
              {up ? <Wifi className="size-5.5" aria-hidden /> : <WifiOff className="size-5.5" aria-hidden />}
            </div>
            <div>
              <p className="text-lg font-bold">{up ? t("system.gatewayUp") : t("system.gatewayDown")}</p>
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <Clock className="size-3" aria-hidden />
                {t("system.uptime")}: {health === null ? "…" : fmtUptime(health.uptime)}
              </p>
            </div>
          </div>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1", up ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-rose-100 text-rose-700 ring-rose-600/20")}>
            <span className={cn("size-1.5 rounded-full", up ? "bg-emerald-500" : "bg-rose-500")} />
            {up ? "ONLINE" : "OFFLINE"}
          </span>
        </div>

        {!up && health !== null && <p className="text-muted-foreground mt-3 text-xs">{t("system.gatewayDownHint")}</p>}

        {/* Session counts */}
        <div className="mt-4">
          <p className="text-muted-foreground mb-2 flex items-center gap-1 text-xs font-medium">
            <Activity className="size-3" aria-hidden />
            {t("system.sessionsTitle")}
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {COUNTS.map((c) => (
              <div key={c.key} className="bg-muted/40 rounded-lg p-2.5 text-center">
                <p className={cn("text-xl font-bold tabular-nums", c.clr)}>{sessions ? formatNumber(sessions[c.key], locale) : "—"}</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">{t(`system.${c.labelKey}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Rate limiting */}
      <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="mb-1 flex items-center gap-2">
          <Gauge className="text-primary size-4" aria-hidden />
          <h3 className="text-sm font-semibold">{t("system.rateTitle")}</h3>
        </div>
        <p className="text-muted-foreground mb-4 text-xs">{t("system.rateSubtitle")}</p>

        {form === null ? (
          <div className="bg-muted h-40 animate-pulse rounded-xl" aria-hidden />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("system.minInterval")} value={form.minIntervalMs} onChange={(v) => set("minIntervalMs", v)} />
              <Field label={t("system.maxInterval")} value={form.maxIntervalMs} onChange={(v) => set("maxIntervalMs", v)} />
              <Field label={t("system.dailyCap")} value={form.dailyCap} min={1} onChange={(v) => set("dailyCap", v)} />
            </div>

            <div className="mt-5 rounded-xl border border-dashed p-4">
              <div className="mb-1 flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" aria-hidden />
                <p className="text-sm font-medium">{t("system.warmupTitle")}</p>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">{t("system.warmupHint")}</p>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={t("system.warmupDays")} value={form.warmupDays} onChange={(v) => set("warmupDays", v)} />
                <Field label={t("system.warmupDailyCap")} value={form.warmupDailyCap} min={1} onChange={(v) => set("warmupDailyCap", v)} />
                <Field label={t("system.warmupMinInterval")} value={form.warmupMinIntervalMs} onChange={(v) => set("warmupMinIntervalMs", v)} />
                <Field label={t("system.warmupMaxInterval")} value={form.warmupMaxIntervalMs} onChange={(v) => set("warmupMaxIntervalMs", v)} />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                {saving ? t("system.saving") : t("system.save")}
              </button>
              {saved && <span className="text-sm font-medium text-emerald-600">{t("system.saved")}</span>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
