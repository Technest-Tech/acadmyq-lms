"use client";

import {
  AlertTriangle,
  Building2,
  KeyRound,
  MessageCircle,
  Send,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  getAutomationOverview,
  updateAcademyAutomation,
  type AutomationOverviewRow,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ManageModal, StatusPill, isConnectedState } from "./manage-modal";

function StatCard({
  icon: Icon,
  label,
  value,
  gradient,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  gradient: string;
}) {
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

function Switch({ on, disabled, onClick, label }: { on: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        on ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

type Filter = "all" | "connected" | "attention";

const needsAttention = (r: AutomationOverviewRow): boolean =>
  r.has_token && !isConnectedState(r.wasender_session_status);

export function AutomationOverviewScreen() {
  const t = useTranslations("adminAutomation");
  const locale = useLocale();
  const { can } = useAuth();

  const [rows, setRows] = useState<AutomationOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [manage, setManage] = useState<AutomationOverviewRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await getAutomationOverview()).academies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (can("automation.manage")) void load();
  }, [load, can]);

  const visible = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.academy_name.toLowerCase().includes(q)) return false;
      if (filter === "connected") return isConnectedState(r.wasender_session_status);
      if (filter === "attention") return needsAttention(r);
      return true;
    });
  }, [rows, query, filter]);

  if (!can("automation.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function toggle(r: AutomationOverviewRow, key: "type1_billing_enabled" | "type2_lessons_enabled") {
    setError(null);
    setBusy(true);
    try {
      await updateAcademyAutomation(r.academy_id, { [key]: !r[key] });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const connectedCount = rows?.filter((r) => isConnectedState(r.wasender_session_status)).length ?? 0;
  const attentionCount = rows?.filter(needsAttention).length ?? 0;
  const sends = rows?.reduce((n, r) => n + r.sent_count, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <MessageCircle className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
          </div>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={Building2} label={t("kpi.academies")} value={formatNumber(rows?.length ?? 0, locale)} gradient="bg-gradient-to-br from-slate-500 to-slate-700" />
        <StatCard icon={KeyRound} label={t("kpi.connected")} value={formatNumber(connectedCount, locale)} gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
        <StatCard icon={AlertTriangle} label={t("kpi.needsAttention")} value={formatNumber(attentionCount, locale)} gradient="bg-gradient-to-br from-rose-500 to-orange-600" />
        <StatCard icon={Send} label={t("kpi.sends")} value={formatNumber(sends, locale)} gradient="bg-gradient-to-br from-amber-500 to-orange-600" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="bg-card w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 sm:max-w-xs"
        />
        <div className="flex gap-1">
          {(["all", "connected", "attention"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {f === "all" ? t("filterAll") : f === "connected" ? t("filterConnected") : t("filterAttention")}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <table className="w-full text-sm" data-testid="automation-table">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2.5 text-start">{t("col.academy")}</th>
              <th className="px-3 py-2.5 text-start">{t("col.status")}</th>
              <th className="px-3 py-2.5 text-center">{t("col.type1")}</th>
              <th className="px-3 py-2.5 text-center">{t("col.type2")}</th>
              <th className="px-3 py-2.5 text-end">{t("col.sends")}</th>
              <th className="px-3 py-2.5 text-end">{t("col.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible === null ? (
              Array.from({ length: 4 }).map((_, i) => (
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
                  <td className="px-3 py-2 font-medium">{r.academy_name}</td>
                  <td className="px-3 py-2"><StatusPill state={r.wasender_session_status} /></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-center">
                      <Switch on={r.type1_billing_enabled} disabled={busy || !r.has_token} onClick={() => void toggle(r, "type1_billing_enabled")} label={`type1 ${r.academy_name}`} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-center">
                      <Switch on={r.type2_lessons_enabled} disabled={busy || !r.has_token} onClick={() => void toggle(r, "type2_lessons_enabled")} label={`type2 ${r.academy_name}`} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    <span className="text-emerald-600">{formatNumber(r.sent_count, locale)}</span>
                    {r.failed_count > 0 && <span className="text-rose-600"> · {formatNumber(r.failed_count, locale)}</span>}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <button
                      type="button"
                      onClick={() => setManage(r)}
                      data-testid={`wa-manage-${r.academy_id}`}
                      className="bg-primary/10 text-primary hover:bg-primary/15 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                    >
                      <Settings2 className="size-3.5" aria-hidden />
                      {t("manageBtn")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">{t("tokenHint")}</p>

      {manage && (
        <ManageModal
          academy={manage}
          onClose={() => setManage(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
