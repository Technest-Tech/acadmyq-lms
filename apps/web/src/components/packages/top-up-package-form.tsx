"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { lessonCountOf } from "@/components/packages/lesson-count-fields";
import { lessonBalance, majorText, pricePerLesson } from "@/components/packages/lesson-price-fields";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, topUpLessonPackage, type LessonPackageRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/**
 * A centre sells more lessons on a block still running: a subject holds one open block, so buying
 * ahead with the same teacher lands here. The price starts at what a lesson of this block costs, and
 * the added money goes on the block's own bill. The server does the arithmetic.
 */
export function TopUpPackageForm({
  row,
  onSaved,
  onCancel,
}: {
  /** A running block sold in lessons (`lesson_minutes` is set). */
  row: LessonPackageRow;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const lessonMinutes = row.lesson_minutes ?? 0;
  const balance = lessonBalance(row, lessonMinutes);
  const [lessons, setLessons] = useState("");
  const [unitPrice, setUnitPrice] = useState(() => majorText(pricePerLesson(row, lessonMinutes)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = lessonCountOf(lessons);
  const unitMinor = Math.round(Number.parseFloat((unitPrice || "").replace(",", ".")) * 100);
  const valid = count !== null && Number.isFinite(unitMinor) && unitMinor >= 0;
  const money = (amount: number) => formatMoney({ amount, currency: row.currency }, locale);
  const lessonsText = (n: number) => t("card.lessonsCount", { count: n });

  async function save() {
    if (count === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await topUpLessonPackage(row.id, { lessons: count, lesson_price_minor: unitMinor });
      onSaved(
        res.invoice_id === null
          ? t("topUp.savedNoBill", { lessons: lessonsText(count) })
          : t("topUp.saved", { lessons: lessonsText(count), amount: money(res.due_minor ?? res.added_minor) }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="package-top-up">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <p className="bg-muted/40 text-muted-foreground rounded-xl px-3 py-2.5 text-xs">
        <span className="text-foreground block font-semibold">{row.label}</span>
        {t("topUp.balance", { left: balance.left, total: lessonsText(balance.sold) })}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="pkg-top-up-lessons" className="text-sm font-medium">
            {t("topUp.lessons")}
          </label>
          <input
            id="pkg-top-up-lessons"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={lessons}
            onChange={(e) => setLessons(e.target.value)}
            className={inputBase}
            data-testid="pkg-top-up-lessons"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pkg-top-up-price" className="text-sm font-medium">
            {t("topUp.price", { minutes: lessonMinutes })}
          </label>
          <input
            id="pkg-top-up-price"
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            className={inputBase}
            data-testid="pkg-top-up-price"
          />
        </div>
      </div>

      {valid && count !== null && (
        <p className="bg-primary/[0.07] text-primary rounded-xl px-3 py-2.5 text-center text-sm font-semibold" data-testid="pkg-top-up-readout">
          {t("topUp.readout", { total: lessonsText(balance.sold + count), amount: money(count * unitMinor) })}
        </p>
      )}

      {row.auto_renew && (
        <p className="text-muted-foreground text-xs" data-testid="pkg-top-up-renewal">
          {t("topUp.renewalNote", { total: lessonsText(balance.sold) })}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("actions.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy || !valid} data-testid="save-package-top-up" className="gap-1.5">
          {busy && <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />}
          {t("topUp.save")}
        </Button>
      </div>
    </div>
  );
}
