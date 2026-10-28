"use client";

import { Layers, Plus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { isPackagePaid, PackageCard } from "@/components/packages/package-card";
import { usePackageActions } from "@/components/packages/use-package-actions";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { listLessonPackages, type LessonPackageRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";

/**
 * The student's packages, on their own profile — the same {@link PackageCard} the packages page
 * shows, with the same buttons and the same forms behind them ({@link usePackageActions}).
 *
 * It used to be a read-only balance with links out to /packages, so the profile could answer
 * "how many hours are left" and nothing else: not the price, the lessons taught, whether this
 * block's bill is paid, whether it renews. Sharing the card is what keeps the two from drifting.
 *
 * Shown as cards: the open block, and finished blocks that still owe something. Settled ones fold
 * into a short history line each.
 */
export function StudentPackagePanel({
  studentId,
  onChanged,
}: {
  studentId: string;
  onChanged?: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const { can } = useAuth();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC", []);
  const [rows, setRows] = useState<LessonPackageRow[] | null>(null);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const load = useCallback(() => {
    void listLessonPackages({ student_id: studentId })
      .then((r) => setRows(r.packages))
      .catch(() => setRows([]));
  }, [studentId]);

  useEffect(load, [load]);

  const { actionProps, openNew, modals } = usePackageActions({
    onChanged: () => {
      load();
      onChanged?.();
    },
    onAlert: (variant, message) => setAlert({ variant, message }),
    studentsWithHistory: new Set((rows ?? []).some((r) => r.status !== "ACTIVE") ? [studentId] : []),
  });

  if (rows === null) return null;

  const active = rows.find((r) => r.status === "ACTIVE") ?? null;
  const owing = rows.filter((r) => r.status !== "ACTIVE" && !isPackagePaid(r));
  const settled = rows.filter((r) => r.status !== "ACTIVE" && isPackagePaid(r)).slice(0, 5);
  const cards = [...(active ? [active] : []), ...owing];

  return (
    <div className="bg-card space-y-3.5 rounded-2xl border p-4" data-testid="student-packages">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/10 ring-primary/20 flex size-9 items-center justify-center rounded-xl ring-1">
            <Layers className="text-primary size-4" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold">{t("panel.title")}</p>
            <p className="text-muted-foreground text-xs">{t("panel.subtitle")}</p>
          </div>
        </div>
        <Link href="/packages" className="text-primary text-xs font-semibold hover:underline">
          {t("panel.manage")}
        </Link>
      </div>

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {active === null && (
        <div className="rounded-xl border border-dashed p-4 text-center">
          <p className="text-muted-foreground text-xs">{t("panel.noActive")}</p>
          {can("package.manage") && (
            <Button
              type="button"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => openNew(studentId)}
              data-testid="open-package-for-student"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("panel.openOne")}
            </Button>
          )}
        </div>
      )}

      {cards.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {cards.map((row) => (
            <PackageCard key={row.id} timezone={timezone} {...actionProps(row)} />
          ))}
        </div>
      )}

      {settled.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wide">
            {t("panel.history")}
          </p>
          <ul className="text-muted-foreground space-y-1 text-xs">
            {settled.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  #{row.sequence_no} {row.label} · {formatHours(row.minutes_consumed, locale)}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatMoney({ amount: row.price_minor, currency: row.currency }, locale)} · {t("panel.settled")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {modals}
    </div>
  );
}
