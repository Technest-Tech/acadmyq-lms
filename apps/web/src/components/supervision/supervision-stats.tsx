"use client";

import {
  AlarmClock,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  Eye,
  Loader2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { StatusBadge } from "@/components/attendance/status-badge";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import {
  ApiError,
  getSupervisionStats,
  type FollowBucket,
  type MarkBucket,
  type SupervisionSessionRow,
  type SupervisionStats as Stats,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Supervision statistics: for a period, who pressed "Following" on which lessons and how long
 * after the start, and who recorded each outcome and how long after the end.
 *
 * The page is deliberately traceable end to end: every percentage on a tile is the ratio of two
 * counts printed under it, and every count is a set of rows in the lesson table at the bottom —
 * so a supervisor being told "62% on time" can scroll down and see the lessons that were late.
 */

type PeriodKey = "today" | "yesterday" | "week" | "month" | "last30";

const BUCKET_TONE: Record<FollowBucket | MarkBucket, ChipTone> = {
  on_time: "good",
  late: "crit",
  pending: "info",
  none: "warn",
  not_needed: "neutral",
};

const ROLE_TONE: Record<string, ChipTone> = {
  ACADEMY_OWNER: "accent",
  SUPERVISOR: "info",
  TEACHER: "neutral",
  STAFF: "neutral",
};

const DEFAULT_FOLLOW_MINUTES = 10;
const DEFAULT_MARK_MINUTES = 60;

/** Local calendar date as Y-m-d — the API takes the academy's own days. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function periodRange(key: PeriodKey): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  const shift = (days: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: shift(-1), to: shift(-1) };
    case "week": {
      // Weeks start on Saturday here, as the academies' timetables do.
      const back = (now.getDay() + 1) % 7;
      return { from: shift(-back), to: today };
    }
    case "month":
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "last30":
      return { from: shift(-29), to: today };
  }
}

const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

export function SupervisionStats() {
  const t = useTranslations("supervision");
  const locale = useLocale();

  const [period, setPeriod] = useState<PeriodKey | "custom">("today");
  const [range, setRange] = useState(() => periodRange("today"));
  const [followMinutes, setFollowMinutes] = useState(DEFAULT_FOLLOW_MINUTES);
  const [markMinutes, setMarkMinutes] = useState(DEFAULT_MARK_MINUTES);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(
        await getSupervisionStats({
          from: range.from,
          to: range.to,
          follow_minutes: followMinutes,
          mark_minutes: markMinutes,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, followMinutes, markMinutes, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickPeriod = (key: PeriodKey) => {
    setPeriod(key);
    setRange(periodRange(key));
  };

  const totals = stats?.totals;
  const selectedPerson = stats?.supervisors.find((p) => p.id === person) ?? null;

  // The lesson list follows the selected person: the lessons they followed or marked.
  const rows = useMemo(() => {
    const all = stats?.sessions ?? [];
    if (person === null) return all;
    return all.filter(
      (s) => s.marked_by?.id === person || s.follow_ups.some((f) => f.user_id === person),
    );
  }, [stats, person]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }), [locale]);
  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className="space-y-6" data-testid="supervision-stats">
      <PageHero
        icon={Eye}
        title={t("title")}
        subtitle={t("subtitle")}
        latticeId="supervision-hero"
        actions={
          loading ? <Loader2 className="size-5 animate-spin text-white/80" aria-hidden /> : undefined
        }
      />

      {/* ── Period + thresholds ─────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm" data-testid="supervision-filters">
        <div className="flex flex-wrap gap-1 rounded-lg border p-0.5" role="group" aria-label={t("from")}>
          {(["today", "yesterday", "week", "month", "last30"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => pickPeriod(key)}
              aria-pressed={period === key}
              data-testid={`period-${key}`}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                period === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
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
        <ThresholdInput id="follow-minutes" label={t("followWithin")} unit={t("minutesUnit")} value={followMinutes} max={1440} onChange={setFollowMinutes} className={inputClass} />
        <ThresholdInput id="mark-minutes" label={t("markWithin")} unit={t("minutesUnit")} value={markMinutes} max={10080} onChange={setMarkMinutes} className={inputClass} />
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* ── The numbers ────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label={t("tiles.lessons")}
          value={totals?.sessions ?? 0}
          sub={totals ? t("tiles.lessonsSub", { needing: totals.needing_follow }) : undefined}
          icon={CalendarDays}
          loading={loading && !stats}
          testId="tile-lessons"
        />
        <StatTile
          label={t("tiles.followed")}
          value={totals ? pct(totals.followed, totals.needing_follow) : "—"}
          sub={totals ? t("tiles.followedSub", { on_time: totals.follow_on_time, late: totals.follow_late, none: totals.unfollowed }) : undefined}
          subTone={totals && totals.unfollowed > 0 ? "warn" : "neutral"}
          icon={Eye}
          loading={loading && !stats}
          testId="tile-followed"
        />
        <StatTile
          label={t("tiles.followedOnTime")}
          value={totals ? pct(totals.follow_on_time, totals.followed) : "—"}
          sub={totals ? t("tiles.followedOnTimeSub", { n: totals.followed, avg: totals.avg_follow_delay_minutes ?? 0 }) : undefined}
          subTone={totals && totals.follow_late > 0 ? "crit" : "good"}
          icon={AlarmClock}
          loading={loading && !stats}
          testId="tile-follow-on-time"
        />
        <StatTile
          label={t("tiles.marked")}
          value={totals ? pct(totals.marked, totals.marked + totals.unmarked) : "—"}
          sub={totals ? t("tiles.markedSub", { on_time: totals.mark_on_time, late: totals.mark_late, none: totals.unmarked }) : undefined}
          subTone={totals && totals.unmarked > 0 ? "warn" : "neutral"}
          icon={ClipboardCheck}
          loading={loading && !stats}
          testId="tile-marked"
        />
        <StatTile
          label={t("tiles.markedOnTime")}
          value={totals ? pct(totals.mark_on_time, totals.marked) : "—"}
          sub={totals ? t("tiles.markedOnTimeSub", { n: totals.marked, avg: totals.avg_mark_delay_minutes ?? 0 }) : undefined}
          subTone={totals && totals.mark_late > 0 ? "crit" : "good"}
          icon={CheckCheck}
          loading={loading && !stats}
          testId="tile-mark-on-time"
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {t("definitions")}
        {totals && (totals.follow_pending > 0 || totals.mark_pending > 0) && (
          <span className="ms-1">· {t("tiles.pending", { n: Math.max(totals.follow_pending, totals.mark_pending) })}</span>
        )}
      </p>

      {/* ── By person ──────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Users className="text-muted-foreground size-4" aria-hidden />
            {t("people.title")}
          </h2>
          <p className="text-muted-foreground text-xs">{t("people.hint")}</p>
        </div>
        <TableCard testId="supervision-people">
          {stats && stats.supervisors.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">{t("people.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={TR_HEAD}>
                  <Th>{t("people.name")}</Th>
                  <Th className="text-end">{t("people.followed")}</Th>
                  <Th className="text-end">{t("people.followOnTime")}</Th>
                  <Th className="text-end">{t("people.followLate")}</Th>
                  <Th className="text-end">{t("people.avgFollowDelay")}</Th>
                  <Th className="text-end">{t("people.marked")}</Th>
                  <Th className="text-end">{t("people.markOnTime")}</Th>
                  <Th className="text-end">{t("people.markLate")}</Th>
                  <Th className="text-end">{t("people.avgMarkDelay")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr
                  className={cn("cursor-pointer transition-colors hover:bg-muted/30", person === null && "bg-primary/5")}
                  onClick={() => setPerson(null)}
                  data-testid="person-all"
                >
                  <Td className="font-semibold">{t("people.all")}</Td>
                  <Td className="text-end tabular-nums">{totals?.followed ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{totals ? `${totals.follow_on_time} · ${pct(totals.follow_on_time, totals.followed)}` : "—"}</Td>
                  <Td className="text-end tabular-nums">{totals?.follow_late ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{totals?.avg_follow_delay_minutes != null ? t("minutes", { n: totals.avg_follow_delay_minutes }) : "—"}</Td>
                  <Td className="text-end tabular-nums">{totals?.marked ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{totals ? `${totals.mark_on_time} · ${pct(totals.mark_on_time, totals.marked)}` : "—"}</Td>
                  <Td className="text-end tabular-nums">{totals?.mark_late ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{totals?.avg_mark_delay_minutes != null ? t("minutes", { n: totals.avg_mark_delay_minutes }) : "—"}</Td>
                </tr>
                {(stats?.supervisors ?? []).map((p) => (
                  <tr
                    key={p.id}
                    className={cn("cursor-pointer transition-colors hover:bg-muted/30", person === p.id && "bg-primary/5")}
                    onClick={() => setPerson(person === p.id ? null : p.id)}
                    data-testid={`person-${p.id}`}
                    aria-selected={person === p.id}
                  >
                    <Td>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.name ?? "—"}</span>
                        <StatusChip tone={ROLE_TONE[p.role ?? ""] ?? "neutral"}>
                          {p.role && ["ACADEMY_OWNER", "SUPERVISOR", "TEACHER", "STAFF"].includes(p.role)
                            ? t(`roles.${p.role}`)
                            : t("roles.other")}
                        </StatusChip>
                      </span>
                    </Td>
                    <Td className="text-end tabular-nums">{p.followed}</Td>
                    <Td className="text-end tabular-nums">
                      {p.followed > 0 ? `${p.follow_on_time} · ${p.follow_on_time_rate ?? 0}%` : "—"}
                    </Td>
                    <Td className={cn("text-end tabular-nums", p.follow_late > 0 && "text-rose-600 dark:text-rose-400")}>{p.followed > 0 ? p.follow_late : "—"}</Td>
                    <Td className="text-end tabular-nums">{p.avg_follow_delay_minutes != null ? t("minutes", { n: p.avg_follow_delay_minutes }) : "—"}</Td>
                    <Td className="text-end tabular-nums">{p.marked}</Td>
                    <Td className="text-end tabular-nums">
                      {p.marked > 0 ? `${p.mark_on_time} · ${p.mark_on_time_rate ?? 0}%` : "—"}
                    </Td>
                    <Td className={cn("text-end tabular-nums", p.mark_late > 0 && "text-rose-600 dark:text-rose-400")}>{p.marked > 0 ? p.mark_late : "—"}</Td>
                    <Td className="text-end tabular-nums">{p.avg_mark_delay_minutes != null ? t("minutes", { n: p.avg_mark_delay_minutes }) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </section>

      {/* ── The lessons behind the numbers ─────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <ClipboardCheck className="text-muted-foreground size-4" aria-hidden />
          {selectedPerson ? t("sessions.titleFor", { name: selectedPerson.name ?? "—" }) : t("sessions.title")}
          {stats && (
            <span className="text-muted-foreground text-xs font-normal tabular-nums">{rows.length}</span>
          )}
        </h2>
        {stats?.truncated && (
          <AlertBanner variant="info" message={t("sessions.truncated", { n: stats.sessions.length })} />
        )}
        <TableCard testId="supervision-sessions">
          {stats && rows.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">{t("sessions.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={TR_HEAD}>
                  <Th>{t("sessions.date")}</Th>
                  <Th>{t("sessions.student")}</Th>
                  <Th>{t("sessions.teacher")}</Th>
                  <Th>{t("sessions.status")}</Th>
                  <Th>{t("sessions.follow")}</Th>
                  <Th>{t("sessions.mark")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((s) => (
                  <SessionLine
                    key={s.id}
                    row={s}
                    person={person}
                    followMinutes={stats?.thresholds.follow_minutes ?? followMinutes}
                    dateFmt={dateFmt}
                    timeFmt={timeFmt}
                  />
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </section>
    </div>
  );
}

function SessionLine({
  row,
  person,
  followMinutes,
  dateFmt,
  timeFmt,
}: {
  row: SupervisionSessionRow;
  person: string | null;
  followMinutes: number;
  dateFmt: Intl.DateTimeFormat;
  timeFmt: Intl.DateTimeFormat;
}) {
  const t = useTranslations("supervision");

  // With a person selected, show THEIR click on the lesson rather than the first one — judged
  // against the same threshold the server used for the first click.
  const click = person !== null ? (row.follow_ups.find((f) => f.user_id === person) ?? null) : null;
  const followedAt = click?.followed_at ?? row.followed_at;
  const followDelay = click?.delay_minutes ?? row.follow_delay_minutes;
  const followedBy = click ? click.name : row.followed_by?.name;
  const followBucket: FollowBucket =
    click !== null && row.follow_bucket !== "not_needed"
      ? click.delay_minutes <= followMinutes ? "on_time" : "late"
      : row.follow_bucket;

  return (
    <tr data-testid="supervision-row">
      <Td className="whitespace-nowrap tabular-nums">
        {dateFmt.format(new Date(row.scheduled_at_utc))}
        <span className="text-muted-foreground ms-1 text-xs">· {row.duration_minutes}m</span>
      </Td>
      <Td className="font-medium">{row.student_name ?? "—"}</Td>
      <Td className="text-muted-foreground">{row.teacher_name ?? "—"}</Td>
      <Td><StatusBadge status={row.status} /></Td>
      <Td>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={BUCKET_TONE[followBucket]} dot>{t(`bucket.${followBucket}`)}</StatusChip>
          {followedAt && followDelay !== null && (
            <span className="text-muted-foreground text-xs">
              {timeFmt.format(new Date(followedAt))}
              {" · "}
              {followDelay >= 0 ? t("afterStart", { n: followDelay }) : t("beforeStart", { n: -followDelay })}
              {followedBy ? ` · ${t("by", { name: followedBy })}` : ""}
            </span>
          )}
        </span>
      </Td>
      <Td>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={BUCKET_TONE[row.mark_bucket]} dot>{t(`bucket.${row.mark_bucket}`)}</StatusChip>
          {row.outcome_set_at && row.mark_delay_minutes !== null && (
            <span className="text-muted-foreground text-xs">
              {timeFmt.format(new Date(row.outcome_set_at))}
              {" · "}
              {row.mark_delay_minutes >= 0 ? t("afterEnd", { n: row.mark_delay_minutes }) : t("beforeEnd", { n: -row.mark_delay_minutes })}
              {row.marked_by?.name ? ` · ${t("by", { name: row.marked_by.name })}` : ""}
            </span>
          )}
        </span>
      </Td>
    </tr>
  );
}

/** A bounded minutes field: free to type in, clamped when you leave it. */
function ThresholdInput({
  id,
  label,
  unit,
  value,
  max,
  onChange,
  className,
}: {
  id: string;
  label: string;
  unit: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
  className: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <label className="flex items-center gap-1.5 text-xs" htmlFor={id}>
      <span className="text-muted-foreground">{label}</span>
      <input
        id={id}
        type="number"
        min={0}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.round(Number(draft));
          const clamped = draft !== "" && Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : value;
          setDraft(String(clamped));
          if (clamped !== value) onChange(clamped);
        }}
        className={cn(className, "w-20 tabular-nums")}
      />
      <span className="text-muted-foreground">{unit}</span>
    </label>
  );
}
