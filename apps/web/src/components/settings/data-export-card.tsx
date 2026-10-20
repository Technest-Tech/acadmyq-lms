"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { downloadAcademyWorkbook } from "@/lib/academy-workbook";
import { ApiError, type ExportDataset, type ExportSheet, getExportDatasets, getExportSheet } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Today in the reader's clock as YYYY-MM-DD and "YYYY-MM-DD HH:MM". */
function stamp(): { day: string; time: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { day, time: `${day} ${p(d.getHours())}:${p(d.getMinutes())}` };
}

/**
 * Settings → Account & data → Export data. The admin ticks the sheets they want (everything that
 * holds rows is ticked by default) and gets ONE styled Excel workbook — a summary sheet plus a
 * sheet per dataset. Sheets are fetched one at a time so a big academy shows progress.
 */
export function DataExportCard() {
  const t = useTranslations("settings.dataExport");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const { session } = useAuth();
  const [datasets, setDatasets] = useState<ExportDataset[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneFlag, setDoneFlag] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getExportDatasets();
      setDatasets(res.datasets);
      setChosen(new Set(res.datasets.filter((d) => d.count > 0).map((d) => d.key)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(key: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function download() {
    if (!datasets || chosen.size === 0 || progress) return;
    const keys = datasets.filter((d) => chosen.has(d.key)).map((d) => d.key);
    setError(null);
    setDoneFlag(false);
    setProgress({ done: 0, total: keys.length });
    try {
      const sheets: ExportSheet[] = [];
      for (const key of keys) {
        sheets.push(await getExportSheet(key));
        setProgress({ done: sheets.length, total: keys.length });
      }
      const academyName = session?.academy?.displayName ?? t("academyFallback");
      const { day, time } = stamp();
      const slug = academyName.replace(/[\\/:*?"<>|]+/g, " ").trim().replace(/\s+/g, "-") || "academy";
      await downloadAcademyWorkbook({
        fileName: `${slug}-${t("fileSuffix")}-${day}`,
        sheets,
        locale,
        copy: {
          title: t("workbookTitle", { name: academyName }),
          exportedOn: t("exportedOn", { time }),
          summarySheet: t("summarySheet"),
          sheetHeader: t("sheetHeader"),
          rowsHeader: t("rowsHeader"),
        },
      });
      setDoneFlag(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  const allKeys = datasets?.map((d) => d.key) ?? [];
  const allChosen = allKeys.length > 0 && allKeys.every((k) => chosen.has(k));

  return (
    <SectionCard
      icon={FileSpreadsheet}
      title={t("cardTitle")}
      description={t("cardDesc")}
      iconClassName="bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/25"
      testId="data-export-card"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {datasets === null ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{t("pick")}</p>
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => setChosen(allChosen ? new Set() : new Set(allKeys))}
            >
              {allChosen ? t("selectNone") : t("selectAll")}
            </button>
          </div>

          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {datasets.map((d) => {
              const on = chosen.has(d.key);
              return (
                <li key={d.key}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors",
                      on ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50",
                      d.count === 0 && !on && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-primary size-4 shrink-0"
                      checked={on}
                      onChange={() => toggle(d.key)}
                      data-testid={`export-${d.key}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {locale === "ar" ? d.title.ar : d.title.en}
                    </span>
                    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                      {d.count.toLocaleString(locale === "ar" ? "ar-EG" : "en-US")}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs leading-relaxed">{t("hint")}</p>
            <div className="flex items-center justify-end gap-3">
              {doneFlag && <span className="text-xs font-medium text-emerald-600">{t("done")}</span>}
              <Button
                type="button"
                disabled={chosen.size === 0 || progress !== null}
                onClick={() => void download()}
                data-testid="export-download"
              >
                <Download aria-hidden />
                {progress
                  ? t("preparing", { done: progress.done, total: progress.total })
                  : t("download", { count: chosen.size })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
