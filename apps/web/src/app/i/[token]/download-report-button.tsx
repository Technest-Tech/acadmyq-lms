"use client";

import { FileText } from "lucide-react";

/**
 * Download-report affordance for the "Billed hours" section. Rather than listing every lesson
 * inline (long and noisy for the parent), the on-screen view shows this single button; the full
 * per-session breakdown lives in the printable report. Triggers the browser's native print-to-PDF,
 * which renders the complete session list via the page's print styles. Hidden from the printout.
 */
export function DownloadReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 print:hidden"
    >
      <FileText className="size-4" aria-hidden />
      <span className="ltr:inline rtl:hidden">Download report</span>
      <span className="rtl:inline ltr:hidden">تنزيل التقرير</span>
    </button>
  );
}
