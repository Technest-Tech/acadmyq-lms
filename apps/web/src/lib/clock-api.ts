import { apiFetch } from "@/lib/api";
import { zoneOffsetMinutes } from "@/lib/academy-clock";
import { COUNTRIES } from "@/lib/countries";

/** One clock a country keeps (the API's App\Support\CountryClocks). */
export interface CountryZone {
  timezone: string;
  /** The zone's city in English ("Toronto"). */
  city: string;
  /** Its Arabic name, for the countries with several clocks. */
  city_ar: string | null;
}

export interface ClockZones {
  /** The academy's own clock. */
  timezone: string;
  country: string | null;
  /** Every country (ISO-2) with its clocks, the usual one first. */
  countries: Record<string, CountryZone[]>;
}

export interface ClockChangePlace {
  country: string;
  timezone: string;
  /** +60 = clocks go forward an hour. */
  shift_minutes: number;
  is_academy: boolean;
}

export interface ClockChange {
  /** The day the clocks change, where they change. */
  date: string;
  past: boolean;
  places: ClockChangePlace[];
  /** Timetables tied to another clock: their lessons move on the ACADEMY's clock. */
  moving_on_academy_clock: number;
  academy_shift_minutes: number | null;
  /** Students whose clock at home moves against the one their timetable is tied to. */
  moving_for_student: number;
  student_shift_minutes: number | null;
}

export interface AbroadTimetable {
  schedule_id: string;
  student_id: string;
  student_name: string | null;
  teacher_name: string | null;
}

export interface AbroadGroup {
  country: string;
  zones: CountryZone[];
  suggested: string;
  /** Minutes the country's clock is ahead of the academy's today. */
  gap_minutes: number;
  on_own_clock: number;
  on_academy_clock: AbroadTimetable[];
}

export interface ClockChanges {
  timezone: string;
  country: string | null;
  changes: ClockChange[];
  abroad: AbroadGroup[];
  no_country: number;
}

let zonesPromise: Promise<ClockZones> | null = null;

/** GET /api/clock/zones — asked once per page load; the catalogue does not change under a session. */
export function getClockZones(): Promise<ClockZones> {
  zonesPromise ??= apiFetch<ClockZones>("/api/clock/zones").catch((err) => {
    zonesPromise = null;
    throw err;
  });
  return zonesPromise;
}

/** GET /api/clock/changes — clock changes around now and the students abroad still on the academy's clock. */
export function getClockChanges(): Promise<ClockChanges> {
  return apiFetch<ClockChanges>("/api/clock/changes");
}

/** POST /api/clock/anchor — tie timetables to a clock. No lesson moves when it is done. */
export function anchorTimetables(
  scheduleIds: string[],
  timezone: string,
): Promise<{ moved: number; unchanged: number }> {
  return apiFetch("/api/clock/anchor", {
    method: "POST",
    body: JSON.stringify({ schedule_ids: scheduleIds, timezone }),
  });
}

/** A country's name in the reader's language ("السعودية" / "Saudi Arabia"). */
export function countryName(code: string | null | undefined, locale: string): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([locale.startsWith("ar") ? "ar" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return COUNTRIES.find((c) => c.code === code)?.name ?? code;
  }
}

export function countryFlag(code: string | null | undefined): string {
  return COUNTRIES.find((c) => c.code === code)?.flag ?? "";
}

/** "UTC+3" / "UTC−5:30" for a zone right now. */
export function utcLabel(timezone: string): string {
  const minutes = zoneOffsetMinutes(timezone);
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `UTC${minutes < 0 ? "−" : "+"}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * What to call a clock: the country, plus the city when the country keeps several
 * ("كندا — تورنتو (الشرق)"). A zone the catalogue does not file under a country reads as itself.
 */
export function clockName(
  timezone: string,
  locale: string,
  countries?: Record<string, CountryZone[]> | null,
  country?: string | null,
): string {
  const code =
    country ??
    (countries
      ? Object.keys(countries).find((c) => countries[c]?.some((z) => z.timezone === timezone))
      : undefined);
  if (!code) return timezone.replace(/_/g, " ");
  const name = countryName(code, locale);
  const zones = countries?.[code] ?? [];
  if (zones.length <= 1) return name;
  const zone = zones.find((z) => z.timezone === timezone);
  if (!zone) return name;
  return `${name} — ${locale.startsWith("ar") ? (zone.city_ar ?? zone.city) : zone.city}`;
}
