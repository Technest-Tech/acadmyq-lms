"use client";

import { CalendarClock, ClipboardCheck, Layers, Users } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";
import { type GroupRow, listBoardLessons, listGroups } from "@/lib/groups-api";
import { cn } from "@/lib/utils";
import { useLevelWord } from "@/lib/levels";

/** The first day (Saturday, the week's start everywhere in the groups module) of the week holding `date`, as YYYY-MM-DD. */
export function weekStartOf(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The teacher's groups (docs/groups): every active group they teach, with its level, its seats, the
 * next lesson and the sheets still owed this week. Until now the groups a teacher teaches showed
 * only through the Profile tab's card, so "what does Mona teach and what has she not marked?" meant
 * the groups board filtered by hand. Read from the same two endpoints that board uses.
 */
export function TeacherGroups({ teacherId }: { teacherId: string }) {
  const t = useTranslations("teachers");
  const tg = useTranslations("groups");
  const word = useLevelWord();
  const locale = useLocale();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [owedThisWeek, setOwedThisWeek] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listGroups({ teacher_id: teacherId, state: "ACTIVE" }),
      listBoardLessons({ view: "owed", teacher_id: teacherId }),
    ])
      .then(([{ groups: rows }, { lessons }]) => {
        if (cancelled) return;
        const weekStart = weekStartOf(new Date());
        const owed: Record<string, number> = {};
        for (const l of lessons) {
          if (l.occurrence_local_date >= weekStart) owed[l.group_id] = (owed[l.group_id] ?? 0) + 1;
        }
        setGroups(rows);
        setOwedThisWeek(owed);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  if (error) return <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />;
  if (groups === null) {
    return <div className="bg-card h-24 animate-pulse rounded-2xl border shadow-sm" data-testid="teacher-groups-loading" />;
  }
  if (groups.length === 0) {
    return (
      <div className="bg-card text-muted-foreground rounded-2xl border p-10 text-center text-sm" data-testid="teacher-groups-empty">
        {t("groups.empty")}
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="teacher-groups">
      {groups.map((g) => {
        const owed = owedThisWeek[g.id] ?? 0;
        return (
          <li key={g.id} className="bg-card rounded-2xl border p-4 shadow-sm" data-testid="teacher-group">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/groups/${g.id}`} className="block truncate text-sm font-bold hover:underline">
                  {g.name}
                </Link>
                <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                  <Layers className="size-3" aria-hidden />
                  {g.level ?? tg("noLevel", { word })}
                  {g.specialization_name ? ` · ${g.specialization_name}` : ""}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                  owed > 0
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
                )}
                data-testid="teacher-group-owed"
              >
                <ClipboardCheck className="size-3" aria-hidden />
                {t("groups.owedThisWeek", { count: owed })}
              </span>
            </div>
            <dl className="text-muted-foreground mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Users className="size-3.5 shrink-0" aria-hidden />
                <dd className="tabular-nums">
                  {g.capacity === null ? tg("students", { count: g.member_count }) : tg("seatsOf", { count: g.member_count, capacity: g.capacity })}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <CalendarClock className="size-3.5 shrink-0" aria-hidden />
                <dd className="tabular-nums">
                  {g.lessons.next_lesson_at ? tg("nextLesson", { when: when(g.lessons.next_lesson_at) }) : tg("noNextLesson")}
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
