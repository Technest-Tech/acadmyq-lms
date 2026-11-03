"use client";

import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { RemovalDues } from "@/lib/api";
import { formatMoney } from "@/lib/money";

/**
 * In a delete confirmation: what the deletion lets go. A centre's unpaid charges leave with the child
 * or family, and that is money, so it is said before the button rather than found out after. Renders
 * nothing when there is nothing to let go, which is always the case outside a centre.
 */
export function RemovalDuesNote({ load }: { load: () => Promise<RemovalDues> }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [dues, setDues] = useState<RemovalDues["dues"]>([]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (!cancelled) setDues(r.dues);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Loaded once per dialog; `load` is an inline closure over a fixed id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dues.length === 0) return null;

  return (
    <p
      className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
      data-testid="removal-dues"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {t("removalDues", {
          amount: dues.map((d) => formatMoney({ amount: d.amount_minor, currency: d.currency }, locale)).join(" + "),
        })}
      </span>
    </p>
  );
}
