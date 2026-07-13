"use client";

import {
  CalendarClock,
  Clock,
  GraduationCap,
  type LucideIcon,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { TimetableSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Shared tile shape for the summary strip. */
interface Tile {
  key: string;
  label: string;
  value: number | string;
  Icon: LucideIcon;
  /** Text colour for the glyph. */
  tint: string;
  /** Matching wash for the glyph's plate. */
  plate: string;
}

function SummaryTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {tiles.map(({ key, label, value, Icon, tint, plate }) => (
        <div
          key={key}
          data-testid={`summary-${key}`}
          className="bg-card flex items-center gap-3 rounded-2xl border px-3.5 py-3 shadow-sm transition-shadow hover:shadow-md"
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
              plate,
            )}
          >
            <Icon className={cn("size-4.5", tint)} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-xl leading-none font-bold tabular-nums">
              {value}
            </div>
            <div className="text-muted-foreground mt-1 truncate text-xs font-medium">
              {label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The summary strip for the Timetables tab: four tiles describing the recurring weekly load —
 * how many timetables, how many weekly sessions, the total weekly hours, and how many distinct
 * teachers carry them. Period-independent; derived from the timetable roster.
 *
 * The Calendar tab has no such strip: its numbers only ever restated what the grid already
 * showed, and the status dropdown carries the filtering they used to hint at.
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
      tint: "text-violet-600 dark:text-violet-400",
      plate: "bg-violet-500/10 ring-violet-500/20",
    },
    {
      key: "weekly-sessions",
      label: t("timetables.summary.weeklySessions"),
      value: slots,
      Icon: CalendarClock,
      tint: "text-blue-600 dark:text-blue-400",
      plate: "bg-blue-500/10 ring-blue-500/20",
    },
    {
      key: "weekly-hours",
      label: t("timetables.summary.weeklyHours"),
      value: Math.round((minutes / 60) * 10) / 10,
      Icon: Clock,
      tint: "text-emerald-600 dark:text-emerald-400",
      plate: "bg-emerald-500/10 ring-emerald-500/20",
    },
    {
      key: "teachers",
      label: t("timetables.summary.teachers"),
      value: teachers,
      Icon: GraduationCap,
      tint: "text-amber-600 dark:text-amber-400",
      plate: "bg-amber-500/10 ring-amber-500/20",
    },
  ];

  return <SummaryTiles tiles={tiles} />;
}
