"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** The longest trial the API accepts, in minutes. */
export const MAX_TRIAL_MINUTES = 600;

/** A length the API will take: whole minutes, 1 to {@link MAX_TRIAL_MINUTES}. */
export function isTrialDuration(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_TRIAL_MINUTES;
}

const chip = (on: boolean) =>
  cn(
    "rounded-xl border py-2 text-xs font-semibold transition-colors",
    on
      ? "border-primary bg-primary/10 text-primary ring-primary/20 ring-2"
      : "border-input text-muted-foreground hover:bg-muted/40",
  );

/**
 * How long the trial runs: the usual lengths as chips, plus "another length" for whatever the
 * academy actually runs (a 20 or a 40-minute trial). A length that is not a chip (typed, or already
 * on the trial being moved) sits in the box rather than as a stray chip.
 *
 * Reports 0 while the box holds something that is not a length, so the form can refuse to book it
 * ({@link isTrialDuration}) instead of quietly keeping the last chip.
 */
export function TrialDurationPicker({
  value,
  onChange,
  options,
  label,
  testIdPrefix = "trial-duration",
}: {
  value: number;
  onChange: (minutes: number) => void;
  options: number[];
  label: string;
  testIdPrefix?: string;
}) {
  const t = useTranslations("trials");
  const [custom, setCustom] = useState(() => !options.includes(value));
  const [text, setText] = useState(() => (options.includes(value) ? "" : String(value)));

  function pick(minutes: number) {
    setCustom(false);
    setText("");
    onChange(minutes);
  }

  function type(raw: string) {
    setText(raw);
    const minutes = Number(raw);
    onChange(raw.trim() !== "" && isTrialDuration(minutes) ? minutes : 0);
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {options.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => pick(d)}
            aria-pressed={!custom && value === d}
            className={chip(!custom && value === d)}
            data-testid={`${testIdPrefix}-${d}`}
          >
            {t("table.minutes", { count: d })}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustom(true);
            type(text);
          }}
          aria-pressed={custom}
          className={chip(custom)}
          data-testid={`${testIdPrefix}-custom`}
        >
          {t("add.customDuration")}
        </button>
      </div>
      {custom && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_TRIAL_MINUTES}
            step={1}
            autoFocus
            value={text}
            onChange={(e) => type(e.target.value)}
            placeholder={t("add.customPlaceholder")}
            aria-label={t("add.customMinutes")}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-28 rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
            data-testid={`${testIdPrefix}-minutes`}
          />
          <span className="text-muted-foreground text-xs">{t("add.customMinutes")}</span>
        </div>
      )}
    </div>
  );
}
