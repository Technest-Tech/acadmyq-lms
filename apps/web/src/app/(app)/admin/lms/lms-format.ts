/** Shared formatters for the Super Admin LMS oversight pages. */

export function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 GB";
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${(bytes / 1e6).toFixed(bytes / 1e6 >= 10 ? 0 : 1)} MB`;
}

/** Whole days from now until an ISO date (negative when past). */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/**
 * How full a capacity cap is, as a percentage — or null when the cap is absent (unlimited), so a
 * caller can render "no cap" rather than a misleading empty bar.
 */
export function capPct(used: number, cap: number | null): number | null {
  if (cap === null || cap <= 0) return null;
  return Math.min(100, (used / cap) * 100);
}

/** Traffic-light tone for a usage bar: red at/over the cap, amber from 80%, else green. */
export function capTone(used: number, cap: number | null): string {
  if (cap === null || cap <= 0) return "bg-muted-foreground/30";
  if (used >= cap) return "bg-rose-500";
  return used / cap >= 0.8 ? "bg-amber-500" : "bg-emerald-500";
}
