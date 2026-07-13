/** Shared formatters for the Super Admin video oversight pages. */

export function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 GB";
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${(bytes / 1e6).toFixed(bytes / 1e6 >= 10 ? 0 : 1)} MB`;
}

export function fmtHours(seconds: number): string {
  if (!seconds || seconds <= 0) return "0h";
  const h = seconds / 3600;
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
}

/** Whole days from now until an ISO date (negative when past). */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}
