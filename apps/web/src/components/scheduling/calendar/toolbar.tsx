"use client";

import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  Square,
} from "lucide-react";
import type { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { CalendarView } from "./utils";

type T = ReturnType<typeof useTranslations>;

const VIEW_ICON = {
  month: CalendarDays,
  week: CalendarRange,
  day: Square,
  list: List,
} as const;

const ALL_VIEWS: CalendarView[] = ["month", "week", "day", "list"];

/**
 * The header bar: a date title with Today/prev/next navigation on the leading side, and the
 * filters, view switcher and the New-session action on the trailing side. Navigation keeps the
 * `prev-week`/`next-week` test ids regardless of the active view — "next" advances by whatever
 * period the current view spans.
 */
export function CalendarToolbar({
  t,
  title,
  view,
  onView,
  onPrev,
  onNext,
  onToday,
  canPickTeacher,
  teacherOptions,
  teacherId,
  onTeacher,
  canPickStudent,
  studentOptions,
  studentId,
  onStudent,
  allowedViews = ALL_VIEWS,
  onCreate,
}: {
  t: T;
  title: string;
  view: CalendarView;
  onView: (v: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  canPickTeacher: boolean;
  teacherOptions: ComboboxOption[];
  teacherId: string;
  onTeacher: (id: string) => void;
  canPickStudent: boolean;
  studentOptions: ComboboxOption[];
  studentId: string;
  onStudent: (id: string) => void;
  /** Subset of views to show in the switcher. Defaults to all four. */
  allowedViews?: CalendarView[];
  /** Opens quick-create at a sensible default time. Omitted for read-only viewers. */
  onCreate?: () => void;
}) {
  return (
    <div className="bg-card flex flex-col gap-3 rounded-2xl border p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      {/* Leading cluster — navigation + current period */}
      <div className="flex items-center gap-2">
        <div className="bg-muted/60 flex items-center rounded-lg p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("calendar.prev")}
            data-testid="prev-week"
            onClick={onPrev}
          >
            <ChevronLeft className="rtl:rotate-180" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("calendar.next")}
            data-testid="next-week"
            onClick={onNext}
          >
            <ChevronRight className="rtl:rotate-180" aria-hidden />
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="calendar-today"
          onClick={onToday}
        >
          {t("calendar.today")}
        </Button>
        <h2
          className="truncate text-base font-bold tracking-tight tabular-nums sm:text-lg"
          data-testid="calendar-title"
        >
          {title}
        </h2>
      </div>

      {/* Trailing cluster — filters + view switcher + create */}
      <div className="flex flex-wrap items-center gap-2">
        {canPickTeacher && (
          <Combobox
            data-testid="calendar-teacher"
            className="w-40 sm:w-44"
            options={teacherOptions}
            value={teacherId}
            onChange={onTeacher}
            placeholder={t("calendar.allTeachers")}
            searchPlaceholder={t("calendar.searchTeacher")}
          />
        )}
        {canPickStudent && (
          <Combobox
            data-testid="calendar-student"
            className="w-40 sm:w-44"
            options={studentOptions}
            value={studentId}
            onChange={onStudent}
            placeholder={t("calendar.allStudents")}
            searchPlaceholder={t("calendar.searchStudent")}
          />
        )}

        <div
          className="bg-muted/60 inline-flex items-center gap-0.5 rounded-lg p-0.5"
          role="tablist"
          aria-label={t("calendar.viewLabel")}
        >
          {allowedViews.map((v) => {
            const Icon = VIEW_ICON[v];
            const active = v === view;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`view-${v}`}
                title={t(`calendar.view.${v}`)}
                onClick={() => onView(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "bg-background text-foreground ring-foreground/[0.06] shadow-sm ring-1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">
                  {t(`calendar.view.${v}`)}
                </span>
              </button>
            );
          })}
        </div>

        {onCreate && (
          <Button
            type="button"
            size="sm"
            data-testid="calendar-new-session"
            onClick={onCreate}
            className="gap-1.5"
          >
            <Plus className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t("calendar.newSession")}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
