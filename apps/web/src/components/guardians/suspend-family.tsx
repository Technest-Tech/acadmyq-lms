"use client";

import { Loader2, PauseCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, getGuardianAdvanceDues, suspendGuardian, type AdvanceDue } from "@/lib/api";
import { formatMoney } from "@/lib/money";

/**
 * Suspending a family, asked first (docs/groups/01-ACCOUNTING.md, "A family suspended, and the dues
 * raised ahead"). A centre bills ahead — this month's group charges, a running private
 * subscription's bill — and the children will not have those lessons while the family is away, so
 * each still-unpaid one is listed with a box to let it go. Nothing is ticked for the desk: letting
 * money go is a decision, and what was already paid stays paid either way.
 */
export function SuspendFamilyConfirm({
  guardianId,
  onDone,
  onCancel,
}: {
  guardianId: string;
  onDone: (cancelled: { currency: string; amount_minor: number }[]) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("guardians");
  const locale = useLocale();
  const [dues, setDues] = useState<AdvanceDue[] | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);

  useEffect(() => {
    getGuardianAdvanceDues(guardianId)
      .then((r) => {
        setDues(r.dues);
        setCanCancel(r.can_cancel);
      })
      // The list is a help, not a gate: without it the family can still be suspended.
      .catch(() => setDues([]));
  }, [guardianId]);

  const ticked = (dues ?? []).filter((d) => picked.includes(d.id));
  const totals = Object.entries(
    ticked.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.currency]: (acc[d.currency] ?? 0) + d.remaining_minor }), {}),
  ).map(([currency, amount]) => money(amount, currency));

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await suspendGuardian(guardianId, picked);
      onDone(res.cancelled ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/30 space-y-3 rounded-xl border p-3" data-testid="suspend-confirm">
      {dues === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t("detail.advanceDuesLoading")}
        </p>
      ) : dues.length === 0 || !canCancel ? (
        <p className="text-muted-foreground text-xs">{t("detail.advanceDuesNone")}</p>
      ) : (
        <div className="space-y-2" data-testid="advance-dues">
          <div>
            <p className="text-sm font-medium">{t("detail.advanceDuesTitle")}</p>
            <p className="text-muted-foreground text-xs">{t("detail.advanceDuesHint")}</p>
          </div>
          <ul className="divide-y rounded-lg border bg-background">
            {dues.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0"
                    checked={picked.includes(d.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)))}
                    data-testid={`advance-due-${d.id}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">
                      {d.student_name} — {d.description}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {t(`detail.advanceDueKind.${d.kind}`)}
                      {d.kind === "PACKAGE" && ` · ${t("detail.advanceDuePackageEnds")}`}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums">{money(d.remaining_minor, d.currency)}</span>
                </label>
              </li>
            ))}
          </ul>
          {totals.length > 0 && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="advance-dues-total">
              {t("detail.advanceDuesTicked", { amount: totals.join(" + ") })}
            </p>
          )}
        </div>
      )}
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("detail.suspendBack")}
        </Button>
        <Button type="button" size="sm" className="gap-1.5" onClick={() => void confirm()} disabled={busy || dues === null} data-testid="suspend-confirm-go">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PauseCircle className="size-3.5" aria-hidden />}
          {t("detail.suspendConfirm")}
        </Button>
      </div>
    </div>
  );
}
