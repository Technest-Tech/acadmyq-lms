/**
 * Display-only time helpers (Master Spec §6.3): the API sends UTC ISO strings;
 * the client renders them as wall-clock in the viewer's/academy's timezone.
 */
export function formatDateTime(
  utcIso: string,
  timeZone: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(utcIso));
}

function bcp47(locale: string): string {
  // Arabic renders Arabic-Indic digits via the explicit numbering system (R-LOC / AC-9.12).
  return locale.startsWith("ar") && !locale.includes("-nu-")
    ? `${locale}-u-nu-arab`
    : locale;
}

const REL_DIVISIONS: Array<{
  amount: number;
  unit: Intl.RelativeTimeFormatUnit;
}> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/**
 * Locale-aware relative timestamp ("2 hours ago" / "منذ ساعتين") for the audit/activity
 * trail. Beyond ~30 days it falls back to an absolute, locale-formatted date so the trail
 * stays both scannable and precise.
 */
export function formatRelativeTime(iso: string, locale: string): string {
  const date = new Date(iso);
  let duration = (date.getTime() - Date.now()) / 1000; // seconds, negative for past

  if (Math.abs(duration) > 60 * 60 * 24 * 30) {
    return new Intl.DateTimeFormat(bcp47(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  const rtf = new Intl.RelativeTimeFormat(bcp47(locale), { numeric: "auto" });
  for (const division of REL_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return new Intl.DateTimeFormat(bcp47(locale)).format(date);
}

/** Absolute, locale-formatted date-time using the viewer's local zone (audit detail). */
export function formatLocalDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(bcp47(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
