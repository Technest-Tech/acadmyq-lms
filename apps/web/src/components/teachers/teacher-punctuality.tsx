"use client";

import { AlarmClock, CalendarDays, CheckCheck, DoorClosed, Link2Off, Timer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { StatusBadge } from "@/components/attendance/status-badge";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  getTeacherPunctuality,
  type PunctualityBucket,
  type PunctualitySessionRow,
  type TeacherPunctuality as Punctuality,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A teacher's punctuality: for a period, when they pressed Enter on each lesson, against its start.
 *
 * Built like the Supervision page and for the same reason — every percentage is two counts that
 * are printed beside it, and every count is a set of rows in the log underneath, so "on time 62%"
 * can always be traced to the lessons that were late.
 */

type PeriodKey = "week" | "month" | "last30" | "last90";

const LATE_OPTIONS = [0, 5, 10, 15] as const;

const BUCKET_TONE: Record<PunctualityBucket, ChipTone> = {
  on_time: "good",
  late: "crit",
  missed: "warn",
  pending: "info",
};

/** Local calendar date as Y-m-d — the API reads the academy's own days. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function periodRange(key: PeriodKey): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  const shift = (days: number) =>
    ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  switch (key) {
    case "week": {
      // Weeks start on Saturday here, as the academies' timetables do.
      const back = (now.getDay() + 1) % 7;
      return { from: shift(-back), to: today };
    }
    case "month":
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "last30":
      return { from: shift(-29), to: today };
    case "last90":
      return { from: shift(-89), to: today };
  }
}

const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

export function TeacherPunctuality({ teacherId }: { teacherId: string }) {
  const t = useTranslations("teachers.punctuality");
  const locale = useLocale();

  const [period, setPeriod] = useState<PeriodKey | "custom">("last30");
  const [range, setRange] = useState(() => periodRange("last30"));
  const [lateMinutes, setLateMinutes] = useState<number>(5);
  const [data, setData] = useState<Punctuality | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await getTeacherPunctuality(teacherId, {
          from: range.from,
          to: range.to,
          late_minutes: lateMinutes,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [teacherId, range.from, range.to, lateMinutes, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }),
    [locale],
  );

  const totals = data?.totals;
  const first = loading && !data;
  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors focus:ring-3";

  // Measuring only starts once a link exists; say so when it cuts into the period on screen.
  const since = data?.tracking_since ? new Date(data.tracking_since) : null;
  const sinceCutsIn = since !== null && ymd(since) > range.from;

  return (
    <div className="space-y-4" data-testid="teacher-punctuality">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      {/* ── Period + threshold ─────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm">
        <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border p-0.5" role="group">
          {(["week", "month", "last30", "last90"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setPeriod(key);
                setRange(periodRange(key));
              }}
              aria-pressed={period === key}
              data-testid={`punctuality-period-${key}`}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                period === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`period.${key}`)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("from")}</span>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              if (!e.target.value) return;
              setPeriod("custom");
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("to")}</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              if (!e.target.value) return;
              setPeriod("custom");
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
            className={inputClass}
          />
        </label>
        <span className="bg-border hidden h-6 w-px sm:block" aria-hidden />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("lateAfter")}</span>
          <div className="flex gap-1 rounded-lg border p-0.5" role="group" aria-label={t("lateAfter")}>
            {LATE_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setLateMinutes(n)}
                aria-pressed={lateMinutes === n}
                data-testid={`punctuality-late-${n}`}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                  lateMinutes === n
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("minutes", { n })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {data && data.tracking_since === null && (
        <p
          className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="punctuality-no-link"
        >
          <Link2Off className="size-4 shrink-0" aria-hidden />
          {t("noLink")}
        </p>
      )}

      {/* ── The numbers ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("tiles.onTime")}
          value={totals?.on_time_rate != null ? `${Math.round(totals.on_time_rate)}%` : "—"}
          sub={totals ? t("tiles.onTimeSub", { on_time: totals.on_time, measured: totals.measured }) : undefined}
          subTone={totals && totals.measured > 0 ? (totals.on_time_rate ?? 0) >= 80 ? "good" : "warn" : "neutral"}
          icon={CheckCheck}
          loading={first}
          testId="punctuality-on-time"
        />
        <StatTile
          label={t("tiles.avgDelay")}
          value={totals?.avg_delay_minutes != null ? t("minutes", { n: totals.avg_delay_minutes }) : "—"}
          sub={
            totals?.avg_late_minutes != null
              ? t("tiles.avgLateSub", { n: totals.avg_late_minutes })
              : t("tiles.avgDelaySub")
          }
          subTone={totals?.avg_late_minutes != null ? "crit" : "neutral"}
          icon={Timer}
          loading={first}
          testId="punctuality-avg-delay"
        />
        <StatTile
          label={t("tiles.late")}
          value={totals?.late ?? "—"}
          sub={totals ? t("tiles.shareSub", { pct: pct(totals.late, totals.measured) }) : undefined}
          subTone={totals && totals.late > 0 ? "crit" : "neutral"}
          icon={AlarmClock}
          loading={first}
          testId="punctuality-late"
        />
        <StatTile
          label={t("tiles.missed")}
          value={totals?.missed ?? "—"}
          sub={totals ? t("tiles.shareSub", { pct: pct(totals.missed, totals.measured) }) : undefined}
          subTone={totals && totals.missed > 0 ? "warn" : "neutral"}
          icon={DoorClosed}
          loading={first}
          testId="punctuality-missed"
        />
      </div>

      {/* One bar for the whole period: the split a single glance should give. */}
      {totals && totals.measured > 0 && (
        <div className="space-y-1.5" data-testid="punctuality-bar">
          <div className="bg-muted flex h-2.5 overflow-hidden rounded-full">
            {(
              [
                ["on_time", totals.on_time, "bg-emerald-500"],
                ["late", totals.late, "bg-rose-500"],
                ["missed", totals.missed, "bg-amber-400"],
              ] as const
            ).map(([key, n, color]) =>
              n > 0 ? (
                <span
                  key={key}
                  className={cn("h-full", color)}
                  style={{ width: `${(n / totals.measured) * 100}%` }}
                  title={`${t(`bucket.${key}`)} · ${n}`}
                />
              ) : null,
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("measuredNote", { measured: totals.measured, late: data?.late_minutes ?? lateMinutes })}
            {totals.pending > 0 && <span className="ms-1">· {t("pendingNote", { n: totals.pending })}</span>}
            {sinceCutsIn && since && (
              <span className="ms-1">· {t("since", { date: dayFmt.format(since) })}</span>
            )}
          </p>
        </div>
      )}

      {/* ── The lessons behind the numbers ─────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <CalendarDays className="text-muted-foreground size-4" aria-hidden />
          {t("log.title")}
          {data && (
            <span className="text-muted-foreground text-xs font-normal tabular-nums">
              {data.sessions.length}
            </span>
          )}
        </h3>
        {data?.truncated && (
          <AlertBanner variant="info" message={t("truncated", { n: data.sessions.length })} />
        )}
        <TableCard testId="punctuality-log">
          {data && data.sessions.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">{t("log.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={TR_HEAD}>
                  <Th>{t("log.date")}</Th>
                  <Th>{t("log.student")}</Th>
                  <Th>{t("log.status")}</Th>
                  <Th>{t("log.entered")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(data?.sessions ?? []).map((row) => (
                  <LogLine key={row.id} row={row} dateFmt={dateFmt} timeFmt={timeFmt} />
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </section>
    </div>
  );
}

function LogLine({
  row,
  dateFmt,
  timeFmt,
}: {
  row: PunctualitySessionRow;
  dateFmt: Intl.DateTimeFormat;
  timeFmt: Intl.DateTimeFormat;
}) {
  const t = useTranslations("teachers.punctuality");
  const delay = row.delay_minutes;

  return (
    <tr data-testid="punctuality-row" data-bucket={row.bucket}>
      <Td className="whitespace-nowrap tabular-nums">
        {dateFmt.format(new Date(row.scheduled_at_utc))}
        <span className="text-muted-foreground ms-1 text-xs">· {row.duration_minutes}m</span>
      </Td>
      <Td className="font-medium">{row.student_name ?? "—"}</Td>
      <Td>
        <StatusBadge status={row.status} />
      </Td>
      <Td>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={BUCKET_TONE[row.bucket]} dot>
            {t(`bucket.${row.bucket}`)}
          </StatusChip>
          {row.first_joined_at && delay !== null && (
            <span className="text-muted-foreground text-xs">
              {timeFmt.format(new Date(row.first_joined_at))}
              {" · "}
              {delay > 0
                ? t("afterStart", { n: delay })
                : delay < 0
                  ? t("beforeStart", { n: -delay })
                  : t("atStart")}
            </span>
          )}
          {/* A teacher who dropped and came back pressed more than once — the first one counts. */}
          {row.joins.length > 1 && (
            <span
              className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
              title={row.joins.map((j) => timeFmt.format(new Date(j))).join(" · ")}
              data-testid="punctuality-presses"
            >
              {t("presses", { n: row.joins.length })}
            </span>
          )}
        </span>
      </Td>
    </tr>
  );
}
