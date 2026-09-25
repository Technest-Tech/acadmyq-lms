"use client";

import { Download } from "lucide-react";

/**
 * Save-as-PDF affordance for the public receipt. Triggers the browser's native
 * print-to-PDF (no extra dependency, pixel-perfect with the page's print styles).
 * Hidden from the printout itself via print:hidden.
 */
export function DownloadPdfButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-medium text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 print:hidden"
    >
      <Download className="size-4" aria-hidden />
      <span className="hidden sm:inline">
        <span className="ltr:inline rtl:hidden">Download PDF</span>
        <span className="rtl:inline ltr:hidden">تنزيل PDF</span>
      </span>
      <span className="sm:hidden">PDF</span>
    </button>
  );
}
