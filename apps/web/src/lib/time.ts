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
