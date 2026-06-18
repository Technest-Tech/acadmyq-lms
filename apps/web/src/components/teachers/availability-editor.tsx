"use client";

import { CalendarClock, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { AvailabilityWindow } from "@/lib/api";
import { cn } from "@/lib/utils";

const fieldClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/**
 * Edits a teacher's weekly availability windows (Sprint 4 §7) — guidance the Sprint 5
 * scheduler reads. Pure controlled component: it owns no fetch, just the array shape
 * `[{weekday, start_local, end_local}]`.
 */
export function AvailabilityEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: AvailabilityWindow[];
  onChange: (next: AvailabilityWindow[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("teachers");

  function update(i: number, patch: Partial<AvailabilityWindow>) {
    onChange(value.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  }

  /** A window whose end ("01:00") is at or before its start ("22:00") crosses midnight into
   *  the next day. An end of exactly "00:00" means midnight — the end of the start day, not a wrap. */
  function crossesMidnight(w: AvailabilityWindow): boolean {
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const end = toMin(w.end_local);
    return end !== 0 && end <= toMin(w.start_local);
  }

  return (
    <div className="space-y-2" data-testid="availability-editor">
      {value.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          {t("detail.noAvailability")}
        </div>
      )}
      {value.map((w, i) => (
        <div
          key={i}
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/20 px-3 py-2.5"
          data-window={i}
        >
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("detail.weekday")}
            </span>
            <select
              aria-label={t("detail.weekday")}
              className={cn(fieldClass, "block")}
              value={w.weekday}
              disabled={disabled}
              onChange={(e) => update(i, { weekday: Number(e.target.value) })}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {t(`weekday.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("detail.start")}
            </span>
            <input
              type="time"
              aria-label={t("detail.start")}
              className={cn(fieldClass, "block tabular-nums")}
              value={w.start_local}
              disabled={disabled}
              onChange={(e) => update(i, { start_local: e.target.value })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("detail.end")}
            </span>
            <input
              type="time"
              aria-label={t("detail.end")}
              className={cn(fieldClass, "block tabular-nums")}
              value={w.end_local}
              disabled={disabled}
              onChange={(e) => update(i, { end_local: e.target.value })}
            />
          </label>
          {crossesMidnight(w) && (
            <span
              className="mb-1.5 self-end rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
              data-testid="next-day-badge"
            >
              {t("detail.nextDay")}
            </span>
          )}
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ms-auto text-muted-foreground hover:text-destructive"
              aria-label={t("detail.remove")}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="add-window"
          className="gap-1"
          onClick={() =>
            onChange([
              ...value,
              { weekday: 1, start_local: "17:00", end_local: "18:00" },
            ])
          }
        >
          <Plus className="size-3.5" />
          {t("detail.addWindow")}
        </Button>
      )}
    </div>
  );
}
