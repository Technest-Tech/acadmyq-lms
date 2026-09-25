"use client";

import { FileText } from "lucide-react";

/**
 * Download-report affordance. The on-screen bill stays short (a per-child summary, the full lesson
 * list collapsed); the printable report carries the complete per-session breakdown. Triggers the
 * browser's native print-to-PDF, which renders that list via the page's print styles. Hidden from
 * the printout.
 */
export function DownloadReportButton({
  labelEn = "Download full report",
  labelAr = "تنزيل التقرير الكامل",
}: {
  labelEn?: string;
  labelAr?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 print:hidden"
    >
      <FileText className="size-4 text-emerald-600" aria-hidden />
      <span className="ltr:inline rtl:hidden">{labelEn}</span>
      <span className="rtl:inline ltr:hidden">{labelAr}</span>
    </button>
  );
}
