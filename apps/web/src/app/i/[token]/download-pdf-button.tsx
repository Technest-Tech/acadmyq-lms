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
      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 print:hidden"
    >
      <Download className="size-3.5" aria-hidden />
      <span className="ltr:inline rtl:hidden">Download PDF</span>
      <span className="rtl:inline ltr:hidden">تنزيل PDF</span>
    </button>
  );
}
