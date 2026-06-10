"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { AvailabilityWindow } from "@/lib/api";

const inputClass =
  "border-input bg-background rounded-md border px-2 py-1.5 text-sm";

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

  return (
    <div className="space-y-2" data-testid="availability-editor">
      {value.map((w, i) => (
        <div key={i} className="flex items-end gap-2" data-window={i}>
          <label className="space-y-1">
            <span className="text-xs">{t("detail.weekday")}</span>
            <select
              aria-label={t("detail.weekday")}
              className={inputClass}
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
            <span className="text-xs">{t("detail.start")}</span>
            <input
              type="time"
              aria-label={t("detail.start")}
              className={inputClass}
              value={w.start_local}
              disabled={disabled}
              onChange={(e) => update(i, { start_local: e.target.value })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs">{t("detail.end")}</span>
            <input
              type="time"
              aria-label={t("detail.end")}
              className={inputClass}
              value={w.end_local}
              disabled={disabled}
              onChange={(e) => update(i, { end_local: e.target.value })}
            />
          </label>
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t("detail.remove")}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              ✕
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
          onClick={() =>
            onChange([
              ...value,
              { weekday: 1, start_local: "17:00", end_local: "18:00" },
            ])
          }
        >
          {t("detail.addWindow")}
        </Button>
      )}
    </div>
  );
}
