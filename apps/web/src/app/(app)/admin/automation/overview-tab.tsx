"use client";

import {
  AlertTriangle,
  Building2,
  Download,
  Gauge,
  KeyRound,
  RefreshCw,
  Send,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  getAutomationOverview,
  type AutomationOverviewRow,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { StatusPill, isConnectedState } from "./manage-modal";

type Filter = "all" | "connected" | "attention" | "disconnected";
type SortKey = "name" | "status" | "sent" | "failed";

const needsAttention = (r: AutomationOverviewRow): boolean =>
  r.has_token && !isConnectedState(r.wasender_session_status);

const statusRank = (s: string | null): number => {
  switch ((s ?? "").toUpperCase()) {
    case "CONNECTED":
      return 0;
    case "QR":
    case "CONNECTING":
      return 1;
    case "DISCONNECTED":
      return 2;
    case "LOGGED_OUT":
      return 3;
    default:
      return 4;
  }
};

function StatCard({ icon: Icon, label, value, gradient }: { icon: LucideIcon; label: string; value: string; gradient: string }) {
  return (
    <div className="bg-card relative flex items-center gap-3.5 overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm", gradient)}>
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tracking-tight tabular-nums">{value}</p>
        <p className="text-muted-foreground mt-1 truncate text-xs font-medium">{label}</p>
      </div>
    </div>
  );
}

/** Read-only on/off state (R4) — the toggles themselves live on the client's WhatsApp tab. */
function OnOffPill({ on }: { on: boolean }) {
  const t = useTranslations("adminAutomation");
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
        on
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      {on ? t("pillOn") : t("pillOff")}
    </span>
  );
}

export function OverviewTab() {
  const t = useTranslations("adminAutomation");
  const locale = useLocale();

  const [rows, setRows] = useState<AutomationOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number>(() => Date.now());
  const [tick, setTick] = useState<number>(() => Date.now());
  const autoRef = useRef(autoRefresh);
  autoRef.current = autoRefresh;

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await getAutomationOverview()).academies);
      setLoadedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh + "updated Xs ago" ticker.
  useEffect(() => {
    const refresh = setInterval(() => {
      if (autoRef.current) void load();
    }, 10000);
    const ticker = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(ticker);
    };
  }, [load]);

  const connectedCount = rows?.filter((r) => isConnectedState(r.wasender_session_status)).length ?? 0;
  const attentionCount = rows?.filter(needsAttention).length ?? 0;
  const totalSent = rows?.reduce((n, r) => n + r.sent_count, 0) ?? 0;
  const totalFailed = rows?.reduce((n, r) => n + r.failed_count, 0) ?? 0;
  const deliveryRate = totalSent + totalFailed > 0 ? Math.round((totalSent / (totalSent + totalFailed)) * 100) : 100;

  const visible = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (q && !r.academy_name.toLowerCase().includes(q)) return false;
      if (filter === "connected") return isConnectedState(r.wasender_session_status);
      if (filter === "attention") return needsAttention(r);
      if (filter === "disconnected") return !isConnectedState(r.wasender_session_status);
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "status") return statusRank(a.wasender_session_status) - statusRank(b.wasender_session_status) || a.academy_name.localeCompare(b.academy_name);
      if (sort === "sent") return b.sent_count - a.sent_count;
      if (sort === "failed") return b.failed_count - a.failed_count;
      return a.academy_name.localeCompare(b.academy_name);
    });
    return sorted;
  }, [rows, query, filter, sort]);

  function exportCsv() {
    if (!rows) return;
    const header = ["Academy", "Status", "Billing", "Reminders", "Sent(30d)", "Failed(30d)"];
    const lines = rows.map((r) => [
      `"${r.academy_name.replace(/"/g, '""')}"`,
      (r.wasender_session_status ?? "NONE").toUpperCase(),
      r.type1_billing_enabled ? "on" : "off",
      r.type2_lessons_enabled ? "on" : "off",
      r.sent_count,
      r.failed_count,
    ].join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "whatsapp-automation.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const secAgo = Math.max(0, Math.floor((tick - loadedAt) / 1000));

  return (
    <div className="space-y-5">
      {error && <AlertBanner variant="error" message={error} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={Building2} label={t("kpi.academies")} value={formatNumber(rows?.length ?? 0, locale)} gradient="bg-gradient-to-br from-slate-500 to-slate-700" />
        <StatCard icon={KeyRound} label={t("kpi.connected")} value={formatNumber(connectedCount, locale)} gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
        <StatCard icon={AlertTriangle} label={t("kpi.needsAttention")} value={formatNumber(attentionCount, locale)} gradient="bg-gradient-to-br from-rose-500 to-orange-600" />
        <StatCard icon={Gauge} label={t("kpi.deliveryRate")} value={`${formatNumber(deliveryRate, locale)}%`} gradient="bg-gradient-to-br from-violet-500 to-purple-600" />
        <StatCard icon={Send} label={t("kpi.sends")} value={formatNumber(totalSent, locale)} gradient="bg-gradient-to-br from-amber-500 to-orange-600" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className="bg-card w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 sm:max-w-xs"
          />
          <div className="flex flex-wrap gap-1">
            {(["all", "connected", "attention", "disconnected"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn("rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors", filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70")}
              >
                {f === "all" ? t("filterAll") : f === "connected" ? t("filterConnected") : f === "attention" ? t("filterAttention") : t("filterDisconnected")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="bg-card rounded-lg border px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
            aria-label={t("toolbar.sort")}
          >
            <option value="name">{t("toolbar.sortName")}</option>
            <option value="status">{t("toolbar.sortStatus")}</option>
            <option value="sent">{t("toolbar.sortSent")}</option>
            <option value="failed">{t("toolbar.sortFailed")}</option>
          </select>
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-primary" />
            {t("toolbar.autoRefresh")}
          </label>
          <button type="button" onClick={() => void load()} className="text-muted-foreground hover:text-foreground rounded-lg border p-2 transition-colors" aria-label={t("toolbar.refresh")}>
            <RefreshCw className="size-3.5" aria-hidden />
          </button>
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors hover:bg-muted">
            <Download className="size-3.5" aria-hidden />
            {t("toolbar.export")}
          </button>
        </div>
      </div>

      <p className="text-muted-foreground -mt-2 text-[11px]">{secAgo < 2 ? t("toolbar.updatedNow") : t("toolbar.updatedAgo", { sec: secAgo })}</p>

      {/* Table — read-only monitoring (R4): the toggles/keys/connection are managed on each
          client's WhatsApp tab; rows link there. One writer per fact. */}
      <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <table className="w-full text-sm" data-testid="automation-table">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2.5 text-start">{t("col.academy")}</th>
              <th className="px-3 py-2.5 text-start">{t("col.status")}</th>
              <th className="px-3 py-2.5 text-center">{t("col.type1")}</th>
              <th className="px-3 py-2.5 text-center">{t("col.type2")}</th>
              <th className="px-3 py-2.5 text-end">{t("col.sends")}</th>
              <th className="px-3 py-2.5 text-end" aria-hidden />
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible === null ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-3 py-3">
                    <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                  </td>
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-10 text-center">{t("none")}</td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.academy_id} data-academy={r.academy_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/admin/clients/${r.academy_id}`} className="hover:text-primary hover:underline">
                      {r.academy_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2"><StatusPill state={r.wasender_session_status} /></td>
                  <td className="px-3 py-2 text-center">
                    <OnOffPill on={r.type1_billing_enabled} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <OnOffPill on={r.type2_lessons_enabled} />
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    <span className="text-emerald-600">{formatNumber(r.sent_count, locale)}</span>
                    {r.failed_count > 0 && <span className="text-rose-600"> · {formatNumber(r.failed_count, locale)}</span>}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Link
                      href={`/admin/clients/${r.academy_id}`}
                      data-testid={`wa-open-${r.academy_id}`}
                      className="text-primary text-xs font-semibold whitespace-nowrap hover:underline"
                    >
                      {t("openClient")}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
