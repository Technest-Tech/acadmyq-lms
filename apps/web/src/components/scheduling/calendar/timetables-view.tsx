"use client";

import {
  CalendarRange,
  ClipboardList,
  Clock,
  GraduationCap,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { TimetableSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A schedule-local "17:00:00" wall-clock rendered as a 12-hour time (am/pm) in the locale. */
function formatTime(time: string, locale: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(2000, 0, 1, h ?? 0, m ?? 0);
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** Total weekly minutes a timetable books across all its slots. */
function weeklyMinutes(tt: TimetableSummary): number {
  return tt.slots.reduce((sum, s) => sum + s.duration_minutes, 0);
}

/**
 * The List view as the academy's full timetable roster — one card per student's ACTIVE weekly
 * schedule, independent of any calendar period (the recurring rule, not generated sessions).
 * Each card shows the weekly pattern (read straight from the schedule slots in the schedule's
 * own timezone) with affordances to update the schedule or open the full lesson log. A header
 * action opens the "new timetable" form. Read-only callers see only the log affordance.
 */
export function TimetablesView({
  timetables,
  loading,
  canManage,
  onUpdate,
  onLog,
  onAddNew,
}: {
  timetables: TimetableSummary[];
  loading: boolean;
  canManage: boolean;
  onUpdate: (studentId: string, studentName: string) => void;
  onLog: (studentId: string, studentName: string) => void;
  onAddNew: () => void;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();

  return (
    <div className="space-y-3" data-testid="timetables-view">
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-sm">
        <div className="flex size-9 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
          <Users className="size-4 text-violet-500" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("timetables.title")}</h3>
          <p className="text-muted-foreground text-xs">
            {t("timetables.subtitle", { count: timetables.length })}
          </p>
        </div>
        {canManage && (
          <Button
            type="button"
            size="sm"
            data-testid="add-timetable"
            onClick={onAddNew}
            className="ms-auto gap-1.5"
          >
            <Plus className="size-3.5" />
            {t("timetables.addNew")}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border bg-card py-16 shadow-sm">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : timetables.length === 0 ? (
        <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-2xl border py-16 text-center shadow-sm">
          <CalendarRange className="text-muted-foreground/60 size-8" aria-hidden />
          <p className="text-muted-foreground text-sm">{t("timetables.empty")}</p>
          <p className="text-muted-foreground/70 text-xs">{t("timetables.emptyHint")}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {timetables.map((tt) => {
            const name = tt.student_name ?? "—";
            const mins = weeklyMinutes(tt);
            return (
              <li
                key={tt.schedule_id}
                data-testid={`timetable-${tt.student_id}`}
                className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Student header */}
                <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/[0.06] to-transparent px-4 py-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold uppercase text-primary ring-1 ring-primary/15">
                    {name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    {tt.teacher_name && (
                      <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                        <GraduationCap className="size-3 shrink-0" aria-hidden />
                        {tt.teacher_name}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium tabular-nums">
                    {t("timetable.slotsCount", { count: tt.slots.length })}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  {/* Weekly pattern chips (schedule-local wall-clock) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                        {t("timetables.slotsPattern")}
                      </p>
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px] tabular-nums">
                        <Clock className="size-3" aria-hidden />
                        {Math.round((mins / 60) * 10) / 10} {t("timetables.hoursShort")} / {t("timetables.perWeek")}
                      </span>
                    </div>
                    {tt.slots.length === 0 ? (
                      <p className="text-muted-foreground/70 text-xs italic">
                        {t("timetables.noPattern")}
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {tt.slots.map((s, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
                          >
                            <span className="font-semibold text-foreground">
                              {t(`weekday.${s.weekday}`)}
                            </span>
                            <span className="text-muted-foreground flex items-center gap-1.5 tabular-nums">
                              <Clock className="size-3" aria-hidden />
                              {formatTime(s.start_time_local, locale)}
                              <span className="text-muted-foreground/40">·</span>
                              {s.duration_minutes}
                              {t("timetable.durationUnit")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Timezone hint */}
                  {tt.timezone && (
                    <p className="text-muted-foreground/70 text-[11px]">
                      {tt.timezone.replace(/_/g, " ")}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="mt-auto flex items-center gap-2 border-t pt-3">
                    {canManage && (
                      <button
                        type="button"
                        data-testid={`update-timetable-${tt.student_id}`}
                        onClick={() => onUpdate(tt.student_id, name)}
                        className="group/btn flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-xs font-semibold text-primary shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:shadow active:translate-y-px"
                      >
                        <Pencil className="size-3.5 transition-transform group-hover/btn:-rotate-12" aria-hidden />
                        {t("timetables.update")}
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`log-timetable-${tt.student_id}`}
                      onClick={() => onLog(tt.student_id, name)}
                      className={cn(
                        "group/btn flex flex-1 items-center justify-center gap-1.5 rounded-xl border bg-card px-3 py-2.5 text-xs font-semibold text-foreground shadow-sm transition-all hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 hover:shadow active:translate-y-px dark:hover:border-violet-800/60 dark:hover:bg-violet-950/30 dark:hover:text-violet-300",
                      )}
                    >
                      <ClipboardList className="size-3.5 transition-transform group-hover/btn:scale-110" aria-hidden />
                      {t("timetables.fullLog")}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
