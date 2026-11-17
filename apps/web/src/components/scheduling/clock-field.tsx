"use client";

import { Globe, Home, School } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { academyTimeZone, slotOnClock } from "@/lib/academy-clock";
import {
  clockName,
  countryFlag,
  countryName,
  getClockZones,
  utcLabel,
  type ClockZones,
} from "@/lib/clock-api";
import { formatHm12 } from "@/lib/time";
import { cn } from "@/lib/utils";

/** The slot fields this needs: a day and a time on the timetable's clock. */
export interface ClockSlot {
  weekday: number;
  start_time_local: string;
}

/**
 * Which clock a weekly timetable is tied to: the academy's, or the one the student lives on.
 *
 * Tied to the academy, the lesson keeps its hour for the teacher and moves for a student abroad
 * whenever either country changes its time. Tied to the student's country, it keeps its hour for
 * the student and the academy's hour follows. Switching re-reads the days and times on the new
 * clock (`onChange` gets them), so choosing a clock never moves a lesson by itself.
 *
 * `value` is the zone, or "" for the academy's clock (what the API also takes as "default").
 */
export function ClockField<S extends ClockSlot>({
  value,
  onChange,
  slots,
  studentCountry,
  studentTimezone,
  disabled,
  className,
}: {
  value: string;
  /** The new zone ("" = the academy's) and the slots as they read on it. */
  onChange: (timezone: string, slots: S[]) => void;
  slots: S[];
  /** The student's country and its usual clock, when on file and not the academy's own. */
  studentCountry?: string | null;
  studentTimezone?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("scheduling.clock");
  const tw = useTranslations("scheduling");
  const locale = useLocale();
  const [zones, setZones] = useState<ClockZones | null>(null);

  useEffect(() => {
    let live = true;
    getClockZones()
      .then((z) => live && setZones(z))
      .catch(() => {
        // The picker then offers the academy's clock and the student's usual one only.
      });
    return () => {
      live = false;
    };
  }, []);

  const academyTz = zones?.timezone ?? academyTimeZone();
  // A timetable saved with the academy's own zone name is on the academy's clock.
  const tied = value !== "" && value !== academyTz ? value : "";
  const onStudentClock = tied !== "";

  const options = useMemo(() => {
    const out: { value: string; label: string; sublabel?: string }[] = [];
    const countries = zones?.countries ?? {};
    for (const code of Object.keys(countries)) {
      for (const zone of countries[code] ?? []) {
        if (zone.timezone === academyTz) continue;
        out.push({
          value: zone.timezone,
          label: `${countryFlag(code)} ${clockName(zone.timezone, locale, countries, code)}`.trim(),
          sublabel: utcLabel(zone.timezone),
        });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label, locale));
    // A zone the catalogue does not list (an old timetable) still shows as what it is.
    if (tied && !out.some((o) => o.value === tied)) {
      out.unshift({ value: tied, label: tied.replace(/_/g, " "), sublabel: utcLabel(tied) });
    }
    return out;
  }, [zones, academyTz, locale, tied]);

  function switchTo(next: string) {
    const from = tied || academyTz;
    const to = next || academyTz;
    if (from === to) {
      onChange(next, slots);
      return;
    }
    onChange(
      next,
      slots.map((slot) => {
        const moved = slotOnClock(slot.weekday, slot.start_time_local, from, to);
        return { ...slot, weekday: moved.weekday, start_time_local: moved.time };
      }),
    );
  }

  const tiedName = tied ? clockName(tied, locale, zones?.countries) : "";
  const academyName = clockName(academyTz, locale, zones?.countries, zones?.country);
  const suggested = studentTimezone && studentTimezone !== academyTz ? studentTimezone : null;

  return (
    <div className={cn("space-y-2", className)} data-testid="clock-field">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Globe className="size-3.5" aria-hidden />
        {t("label")}
      </label>

      <div className="grid grid-cols-2 gap-1.5 rounded-xl border bg-background p-1">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!onStudentClock}
          data-testid="clock-academy"
          onClick={() => onStudentClock && switchTo("")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-60",
            !onStudentClock ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted",
          )}
        >
          <School className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("academy", { place: academyName })}</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={onStudentClock}
          data-testid="clock-student"
          onClick={() => {
            if (onStudentClock) return;
            const first = suggested ?? options[0]?.value;
            if (first) switchTo(first);
          }}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-60",
            onStudentClock ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Home className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("student")}</span>
        </button>
      </div>

      {onStudentClock ? (
        <>
          <Combobox
            options={options}
            value={tied}
            onChange={(next) => next && switchTo(next)}
            placeholder={t("pickCountry")}
            searchPlaceholder={t("searchCountry")}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("studentHint", { place: tiedName })}</p>
          {slots.length > 0 && (
            <p className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground" data-testid="clock-academy-times">
              <span className="font-semibold">{t("onAcademyClock")}</span>{" "}
              {slots
                .map((slot) => {
                  const at = slotOnClock(slot.weekday, slot.start_time_local, tied, academyTz);
                  return `${tw(`weekday.${at.weekday}`)} ${formatHm12(at.time, locale)}`;
                })
                .join(" · ")}
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {suggested ? t("academyHintAbroad", { country: countryName(studentCountry, locale) }) : t("academyHint")}
          {suggested && !disabled && (
            <>
              {" "}
              <button
                type="button"
                data-testid="clock-suggest"
                onClick={() => switchTo(suggested)}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {t("tieToStudent")}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
