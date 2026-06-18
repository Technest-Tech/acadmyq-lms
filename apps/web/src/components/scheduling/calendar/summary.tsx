"use client";

import {
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Clock,
  GraduationCap,
  Layers,
  type LucideIcon,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CalendarSession, TimetableSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STATUS_DOT, STATUS_ORDER } from "./utils";

/** Shared tile shape for both summary strips. */
interface Tile {
  key: string;
  label: string;
  value: number | string;
  Icon: LucideIcon;
  tint: string;
}

function SummaryTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(({ key, label, value, Icon, tint }) => (
        <div
          key={key}
          data-testid={`summary-${key}`}
          className="bg-card flex items-center gap-3 rounded-xl border px-3.5 py-2.5 shadow-sm"
        >
          <Icon className={cn("size-5 shrink-0", tint)} aria-hidden />
          <div className="min-w-0">
            <div className="text-xl leading-none font-bold tabular-nums">{value}</div>
            <div className="text-muted-foreground truncate text-xs">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A premium at-a-glance strip: four summary tiles (total / scheduled / attended / cancelled)
 * computed from the sessions in the current range, plus the status colour legend. Purely a
 * read-out — it never refetches; it derives everything from the feed already on screen.
 */
export function CalendarSummary({ sessions }: { sessions: CalendarSession[] }) {
  const t = useTranslations("scheduling");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of sessions) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [sessions]);

  const cancelled =
    (counts.CANCELLED_BY_TEACHER ?? 0) + (counts.CANCELLED_BY_STUDENT ?? 0);

  const tiles: Tile[] = [
    {
      key: "total",
      label: t("calendar.summary.total"),
      value: sessions.length,
      Icon: Layers,
      tint: "text-foreground",
    },
    {
      key: "scheduled",
      label: t("status.SCHEDULED"),
      value: counts.SCHEDULED ?? 0,
      Icon: CalendarClock,
      tint: "text-blue-500",
    },
    {
      key: "attended",
      label: t("status.ATTENDED"),
      value: counts.ATTENDED ?? 0,
      Icon: CalendarCheck,
      tint: "text-emerald-500",
    },
    {
      key: "cancelled",
      label: t("calendar.summary.cancelled"),
      value: cancelled,
      Icon: CalendarX,
      tint: "text-red-500",
    },
  ];

  return (
    <div className="space-y-3">
      <SummaryTiles tiles={tiles} />

      {/* Status legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5">
        {STATUS_ORDER.map((status) => (
          <span key={status} className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
            {t(`status.${status}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The summary strip for the List/Timetables section: four tiles describing the recurring
 * weekly load — how many timetables, how many weekly sessions, the total weekly hours, and how
 * many distinct teachers carry them. Period-independent; derived from the timetable roster.
 */
export function TimetablesSummary({
  timetables,
}: {
  timetables: TimetableSummary[];
}) {
  const t = useTranslations("scheduling");

  const { slots, minutes, teachers } = useMemo(() => {
    let slots = 0;
    let minutes = 0;
    const teachers = new Set<string>();
    for (const tt of timetables) {
      teachers.add(tt.teacher_id);
      for (const s of tt.slots) {
        slots += 1;
        minutes += s.duration_minutes;
      }
    }
    return { slots, minutes, teachers: teachers.size };
  }, [timetables]);

  const tiles: Tile[] = [
    {
      key: "timetables",
      label: t("timetables.summary.count"),
      value: timetables.length,
      Icon: Users,
      tint: "text-violet-500",
    },
    {
      key: "weekly-sessions",
      label: t("timetables.summary.weeklySessions"),
      value: slots,
      Icon: CalendarClock,
      tint: "text-blue-500",
    },
    {
      key: "weekly-hours",
      label: t("timetables.summary.weeklyHours"),
      value: Math.round((minutes / 60) * 10) / 10,
      Icon: Clock,
      tint: "text-emerald-500",
    },
    {
      key: "teachers",
      label: t("timetables.summary.teachers"),
      value: teachers,
      Icon: GraduationCap,
      tint: "text-amber-500",
    },
  ];

  return (
    <div className="space-y-3">
      <SummaryTiles tiles={tiles} />
    </div>
  );
}
