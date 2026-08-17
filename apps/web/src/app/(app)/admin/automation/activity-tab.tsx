"use client";

import { RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { ApiError, getWhatsappActivity, type WhatsAppActivityRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type Filter = "all" | "SENT" | "FAILED" | "SKIPPED";

const STATUS_CLR: Record<string, string> = {
  SENT: "text-emerald-600 dark:text-emerald-400",
  FAILED: "text-rose-600 dark:text-rose-400",
  SKIPPED: "text-muted-foreground",
  QUEUED: "text-amber-600 dark:text-amber-400",
};

export function ActivityTab() {
  const t = useTranslations("adminAutomation");
  const locale = useLocale();

  const [rows, setRows] = useState<WhatsAppActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRef = useRef(autoRefresh);
  autoRef.current = autoRefresh;

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await getWhatsappActivity(100)).activity);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("activity.loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const iv = setInterval(() => {
      if (autoRef.current) void load();
    }, 10000);
    return () => clearInterval(iv);
  }, [load]);

  const fmtTime = (s: string) => new Date(s).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  const visible = rows?.filter((r) => filter === "all" || r.status === filter) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("activity.title")}</h2>
          <p className="text-muted-foreground text-xs">{t("activity.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(["all", "SENT", "FAILED", "SKIPPED"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn("rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors", filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70")}
              >
                {f === "all" ? t("activity.all") : f === "SENT" ? t("activity.sent") : f === "FAILED" ? t("activity.failed") : t("activity.skipped")}
              </button>
            ))}
          </div>
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-primary" />
            {t("toolbar.autoRefresh")}
          </label>
          <button type="button" onClick={() => void load()} className="text-muted-foreground hover:text-foreground rounded-lg border p-2 transition-colors" aria-label={t("toolbar.refresh")}>
            <RefreshCw className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      <div className="bg-card overflow-x-auto rounded-xl shadow-sm ring-1 ring-foreground/[0.06]">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2.5 text-start">{t("activity.colAcademy")}</th>
              <th className="px-3 py-2.5 text-start">{t("activity.colType")}</th>
              <th className="px-3 py-2.5 text-start">{t("activity.colRecipient")}</th>
              <th className="px-3 py-2.5 text-start">{t("activity.colTransport")}</th>
              <th className="px-3 py-2.5 text-start">{t("activity.colStatus")}</th>
              <th className="px-3 py-2.5 text-end">{t("activity.colTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible === null ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-3 py-3"><div className="bg-muted h-5 animate-pulse rounded" aria-hidden /></td>
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-10 text-center">{t("activity.empty")}</td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium">{r.academy_name}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">{r.automation_type}</td>
                  <td className="px-3 py-2 text-xs" dir="ltr">{r.recipient_phone ?? "—"}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">{r.transport}</td>
                  <td className="px-3 py-2">
                    <span className={cn("text-xs font-medium", STATUS_CLR[r.status] ?? "text-muted-foreground")}>{r.status}</span>
                    {r.error && <span className="text-muted-foreground ms-1 text-[11px]">({r.error})</span>}
                  </td>
                  <td className="px-3 py-2 text-end text-xs tabular-nums">{fmtTime(r.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
