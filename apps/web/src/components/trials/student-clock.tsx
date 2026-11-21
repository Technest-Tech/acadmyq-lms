"use client";

import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { academyTimeZone, zoneOffsetMinutes } from "@/lib/academy-clock";
import { clockName, countryFlag, getClockZones, utcLabel, type ClockZones } from "@/lib/clock-api";
import { COUNTRIES } from "@/lib/countries";
import { formatNumber } from "@/lib/money";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";
import { dayIn } from "./trial-time";

/**
 * The clock a trial's student lives on (Ahmed 2026-11-17): a trial is booked on the academy's
 * clock, and this says what that hour is at the student's home, so nobody does the sum in their
 * head when the parent says "five o'clock our time".
 */

/** The zone catalogue, asked once per page (shared with the timetable's clock picker). */
export function useClockZones(): ClockZones | null {
  const [zones, setZones] = useState<ClockZones | null>(null);
  useEffect(() => {
    let live = true;
    getClockZones()
      .then((z) => live && setZones(z))
      .catch(() => {
        // The picker then offers the academy's clock only.
      });
    return () => {
      live = false;
    };
  }, []);
  return zones;
}

/** The clock a country keeps when nobody said which of its zones (its first one); null for the academy's. */
export function usualClock(zones: ClockZones | null, country: string | null | undefined): string | null {
  if (!zones || !country) return null;
  const zone = zones.countries[country]?.[0]?.timezone ?? null;
  return zone && zone !== zones.timezone ? zone : null;
}

/** The country a stored E.164 number dials from (+966… → SA), by its longest matching code. */
export function phoneCountry(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const match = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length).find((c) => phone.startsWith(c.dialCode));
  return match?.code ?? null;
}

/** Minutes the student's clock is ahead of the academy's at that instant (negative = behind). */
export function clockGapMinutes(timezone: string, at: Date): number {
  return zoneOffsetMinutes(timezone, at) - zoneOffsetMinutes(academyTimeZone(), at);
}

/** "+١ ساعة" / "−٢٫٥ ساعة" — the gap in hours, signed. */
function useGapText() {
  const t = useTranslations("trials.studentClock");
  const locale = useLocale();
  return (minutes: number) =>
    t("gap", { sign: minutes < 0 ? "−" : "+", hours: formatNumber(Math.abs(minutes) / 60, locale) });
}

/**
 * What the trial's hour is at the student's home: "🇸🇦 ٥:٠٠ م عند الطالب (+١ ساعة)", with the day
 * when it is another day there. Nothing when the student keeps the academy's clock.
 */
export function StudentTimeNote({
  timezone,
  country,
  at,
  className,
}: {
  timezone: string | null | undefined;
  country?: string | null;
  at: string | Date;
  className?: string;
}) {
  const t = useTranslations("trials.studentClock");
  const locale = useLocale();
  const gapText = useGapText();
  if (!timezone) return null;
  const when = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(when.getTime())) return null;
  const gap = clockGapMinutes(timezone, when);
  if (gap === 0) return null;

  const otherDay = dayIn(when, timezone) !== dayIn(when, academyTimeZone());
  const time = new Intl.DateTimeFormat(numeralLocale(locale), {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    ...(otherDay ? { weekday: "long" } : {}),
  }).format(when);

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-sky-700 dark:text-sky-300", className)}
      data-testid="student-time-note"
    >
      {country && <span aria-hidden>{countryFlag(country)}</span>}
      <span>{t("at", { time })}</span>
      <span className="text-muted-foreground">({gapText(gap)})</span>
    </span>
  );
}

/**
 * Where the student lives, for a trial: the academy's own clock, or any country's (a country with
 * several clocks lists each city). Under it, the trial's hour as the student will read it.
 * `value` is the zone, "" = the academy's.
 */
export function StudentClockField({
  value,
  onChange,
  at,
  disabled,
  testId = "student-clock",
}: {
  value: string;
  onChange: (timezone: string) => void;
  /** The booked instant, for the line saying what it is at the student's home. */
  at: Date | null;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useTranslations("trials.studentClock");
  const locale = useLocale();
  const zones = useClockZones();
  const academyTz = zones?.timezone ?? academyTimeZone();

  const options = useMemo(() => {
    const countries = zones?.countries ?? {};
    const out: { value: string; label: string; sublabel?: string }[] = [];
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
    // A zone the catalogue does not list still shows as what it is.
    if (value && !out.some((o) => o.value === value)) {
      out.unshift({ value, label: value.replace(/_/g, " "), sublabel: utcLabel(value) });
    }
    const academyName = clockName(academyTz, locale, zones?.countries, zones?.country);
    return [{ value: "", label: t("academy", { place: academyName }), sublabel: utcLabel(academyTz) }, ...out];
  }, [zones, academyTz, locale, value, t]);

  const country = value ? Object.keys(zones?.countries ?? {}).find((c) => zones?.countries[c]?.some((z) => z.timezone === value)) : null;

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <Globe className="text-muted-foreground size-3.5" aria-hidden />
        {t("label")}
      </label>
      <Combobox
        options={options}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        placeholder={t("academy", { place: clockName(academyTz, locale, zones?.countries, zones?.country) })}
        searchPlaceholder={t("search")}
        disabled={disabled}
        data-testid={`${testId}-picker`}
      />
      {value && at ? (
        <p className="text-xs">
          <StudentTimeNote timezone={value} country={country} at={at} />
          {clockGapMinutes(value, at) === 0 && <span className="text-muted-foreground">{t("sameHour")}</span>}
        </p>
      ) : (
        <p className="text-muted-foreground text-[11px]">{t("hint")}</p>
      )}
    </div>
  );
}
