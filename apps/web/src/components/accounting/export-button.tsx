"use client";

import { Download, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { todayLocal } from "@/components/accounting/accounting-ui";
import { Button } from "@/components/ui/button";
import { downloadAccountingSheet, type SheetColumn } from "@/lib/accounting-export";

/**
 * Download what a list shows as Excel. `rows` may be a function when the screen holds one page and the
 * sheet needs them all. Nothing to export: nothing to press.
 */
export function ExportButton<T>({
  name,
  sheetName,
  columns,
  rows,
  count,
}: {
  /** File name without the date, e.g. "arrears". */
  name: string;
  sheetName: string;
  columns: SheetColumn<T>[];
  rows: T[] | (() => Promise<T[]>);
  /** How many rows there are; 0 hides the button. Defaults to the array's length. */
  count?: number;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if ((count ?? (Array.isArray(rows) ? rows.length : 1)) === 0) return null;

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      const all = Array.isArray(rows) ? rows : await rows();
      await downloadAccountingSheet({ fileName: `${name}-${todayLocal()}`, sheetName, columns, rows: all, rightToLeft: locale === "ar" });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {failed && (
        <span className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {t("exportFailed")}
        </span>
      )}
      <Button type="button" variant="secondary" className="gap-1.5" onClick={() => void run()} disabled={busy} data-testid={`export-${name}`}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
        {t("exportExcel")}
      </Button>
    </span>
  );
}
