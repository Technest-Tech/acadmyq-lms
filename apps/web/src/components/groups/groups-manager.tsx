"use client";

import { AlertTriangle, Archive, CalendarClock, CheckCheck, Clock, GraduationCap, Hourglass, Layers, MapPin, PlayCircle, Plus, Search, UsersRound, Video } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { GroupForm } from "@/components/groups/group-form";
import { STATE_BADGE, pastelFor } from "@/components/groups/group-look";
import {
  STATE_TONE,
  fieldClass,
  isolateFractions,
  lessonDate,
  lessonTime,
  sortSlots,
  wallTime,
} from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile, type TileTone } from "@/components/ui/segment-tile";
import { listTeachers } from "@/lib/api";
import { fetchRoster } from "@/lib/roster";
import { listGroups, type GroupRow, type GroupState } from "@/lib/groups-api";
import { LevelSelect } from "@/components/levels/level-select";
import { useCapability, useModernLook } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import { useLevelWord } from "@/lib/levels";

type Tab = "ACTIVE" | GroupState;
const TABS: Tab[] = ["ACTIVE", "RUNNING", "UPCOMING", "FINISHED", "ARCHIVED"];

/** A centre reads the tabs as its stat cards. */
const TAB_TILES: Record<Tab, { icon: typeof Layers; tone: TileTone }> = {
  ACTIVE: { icon: Layers, tone: "violet" },
  RUNNING: { icon: PlayCircle, tone: "teal" },
  UPCOMING: { icon: CalendarClock, tone: "gold" },
  FINISHED: { icon: CheckCheck, tone: "slate" },
  ARCHIVED: { icon: Archive, tone: "slate" },
};

/**
 * The Groups page (docs/groups): every group class as a card — who teaches it, seats taken, the
 * weekly times, the next lesson, and a red flag when a lesson's sheet is overdue. The tabs cut the
 * list by the derived state, and their counts come from the same response as the cards, so a
 * number and the cards under it never disagree.
 */
export function GroupsManager() {
  const t = useTranslations("groups");
  const tLevels = useTranslations("levels");
  const word = useLevelWord();
  const tTerm = useTranslations("courseTerm");
  const { can, session } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const canManage = can("group.manage");
  const isTeacher = session?.role === "TEACHER";

  const [tab, setTab] = useState<Tab>("ACTIVE");
  const [q, setQ] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [teachers, setTeachers] = useState<{ value: string; label: string }[]>([]);
  // A centre narrows the list to one of its levels (docs/centre-profile, Phase 2.1).
  const centre = useCapability("centre");
  const look = useModernLook();
  const [levelId, setLevelId] = useState("");
  // "Courses ending soon" (docs/centre-profile, Phase 2 §2): a chip, pre-set by the dashboard's link.
  const [endingSoon, setEndingSoon] = useState(() => search.get("ending_soon") === "1");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [counts, setCounts] = useState<Record<GroupState, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (isTeacher || !can("teacher.read")) return;
    void fetchRoster(listTeachers, { filter: { status: "active" } })
      .then((res) => setTeachers(res.rows.map((r) => ({ value: r.id, label: r.full_name }))))
      .catch(() => setTeachers([]));
  }, [isTeacher, can]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listGroups({
        state: tab,
        q: q.trim() || undefined,
        teacher_id: teacherId || undefined,
        level_id: levelId || undefined,
        ending_soon: centre && endingSoon ? true : undefined,
      });
      setGroups(res.groups);
      setCounts(res.counts);
    } catch {
      setError(t("loadFailed"));
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [tab, q, teacherId, levelId, centre, endingSoon, t]);

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const activeCount = counts ? counts.RUNNING + counts.UPCOMING + counts.FINISHED : null;

  const endingSoonChip = centre && (
    <button
      type="button"
      aria-pressed={endingSoon}
      onClick={() => setEndingSoon((v) => !v)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        look && "h-10 justify-center gap-1.5 rounded-xl px-3.5",
        endingSoon ? "border-amber-500 bg-amber-500 text-white" : "hover:bg-muted",
      )}
      data-testid="groups-filter-ending-soon"
    >
      <Hourglass className="size-3.5" aria-hidden />
      {tTerm("filterEndingSoon")}
    </button>
  );
  const searchField = (
    <label className={cn("relative", look && "block min-w-0 flex-1")}>
      <Search className="text-muted-foreground absolute top-1/2 size-4 -translate-y-1/2 ltr:left-3 rtl:right-3" />
      <input
        className={cn(fieldClass, "ps-9")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("search", { word })}
        aria-label={t("search", { word })}
      />
    </label>
  );
  const teacherField = teachers.length > 0 && (
    <Combobox
      options={[{ value: "", label: t("allTeachers") }, ...teachers]}
      value={teacherId}
      onChange={setTeacherId}
      placeholder={t("allTeachers")}
      searchPlaceholder={t("form.search")}
    />
  );
  const levelField = centre && <LevelSelect value={levelId} onChange={setLevelId} noneLabel={tLevels("allLevels", { word })} testId="groups-filter-level" />;

  return (
    <div className={look ? "space-y-4" : "space-y-5"}>
      <PageHero
        icon={UsersRound}
        title={t("title")}
        subtitle={t("subtitle")}
        latticeId="groups-hero"
        actions={
          <>
            {activeCount !== null && <HeroPill>{t("activeCount", { count: activeCount })}</HeroPill>}
            {canManage && (
              <Button
                type="button"
                variant="secondary"
                className={cn("gap-1.5", look && "hero-main-action")}
                onClick={() => setCreating(true)}
                data-testid="groups-new"
              >
                <Plus className="size-4" />
                {t("new")}
              </Button>
            )}
          </>
        }
      />

      {look ? (
        <>
          <div
            // Five cards: "All" takes two cells wherever they do not fit one row, so none sits alone.
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 [&>*:first-child]:col-span-2 xl:[&>*:first-child]:col-span-1"
            role="group"
            aria-label={t("title")}
            data-testid="groups-tiles"
          >
            {TABS.map((key) => (
              <SegmentTile
                key={key}
                testKey={`groups-${key}`}
                icon={TAB_TILES[key].icon}
                tone={TAB_TILES[key].tone}
                label={t(`tabs.${key}`)}
                value={counts ? (key === "ACTIVE" ? activeCount : counts[key]) : null}
                share={null}
                selected={tab === key}
                onSelect={() => setTab(key)}
              />
            ))}
          </div>
          <div className="centre-surface bg-card flex flex-col gap-2 rounded-2xl border p-3 lg:flex-row lg:items-center" data-testid="groups-filters">
            {searchField}
            {teacherField && <div className="min-w-0 lg:w-56">{teacherField}</div>}
            {levelField && <div className="min-w-0 lg:w-48">{levelField}</div>}
            {endingSoonChip}
          </div>
        </>
      ) : (
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist">
          {TABS.map((key) => {
            const n = counts ? (key === "ACTIVE" ? activeCount : counts[key]) : null;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
                data-testid={`groups-tab-${key}`}
              >
                {t(`tabs.${key}`)}
                {n !== null && <span className="ms-1.5 tabular-nums opacity-80">{n}</span>}
              </button>
            );
          })}
          {endingSoonChip}
        </div>
        <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", centre ? "lg:w-[40rem] lg:grid-cols-3" : "lg:w-[28rem]")}>
          {searchField}
          {teacherField}
          {levelField}
        </div>
      </div>
      )}

      {error && <AlertBanner variant="error" message={error} />}

      {loading && groups.length === 0 ? (
        look ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={t("loading")}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-muted h-56 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>
        )
      ) : groups.length === 0 ? (
        look ? (
          <div className="centre-surface bg-card rounded-2xl border px-6 py-12 text-center" data-testid="groups-empty">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              <UsersRound className="size-7" aria-hidden />
            </span>
            <p className="mt-3 text-lg font-extrabold">{t("empty.title")}</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{canManage ? t("empty.manage") : t("empty.read")}</p>
            {canManage && (
              <Button type="button" size="lg" className="mt-4 gap-1.5" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {t("new")}
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <UsersRound className="text-muted-foreground mx-auto size-8" aria-hidden />
            <p className="mt-2 font-medium">{t("empty.title")}</p>
            <p className="text-muted-foreground mt-1 text-sm">{canManage ? t("empty.manage") : t("empty.read")}</p>
          </div>
        )
      ) : (
        <ul className={cn("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3", look ? "gap-4" : "gap-3")} data-testid="groups-list">
          {groups.map((g) => (
            <li key={g.id}>{look ? <CentreGroupCard group={g} /> : <GroupCard group={g} />}</li>
          ))}
        </ul>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={t("new")} description={t("form.subtitle")} size={look ? "xl" : "lg"}>
        {creating && (
          <GroupForm
            onCancel={() => setCreating(false)}
            onSaved={(g) => {
              setCreating(false);
              router.push(`/groups/${g.id}?tab=members`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function GroupCard({ group: g }: { group: GroupRow }) {
  const t = useTranslations("groups");
  const tTerm = useTranslations("courseTerm");
  const tw = useTranslations("scheduling");
  const word = useLevelWord();
  const locale = useLocale();
  const centre = useCapability("centre");
  const full = g.capacity !== null && g.member_count >= g.capacity;
  const share = g.capacity ? Math.min(100, Math.round((g.member_count / g.capacity) * 100)) : null;

  return (
    <Link
      href={`/groups/${g.id}`}
      className="bg-card hover:border-primary/40 group block h-full rounded-2xl border p-4 shadow-sm transition-colors"
      data-testid={`group-card-${g.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{g.name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {[g.level, g.specialization_name].filter(Boolean).join(" · ") || t("noLevel", { word })}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", STATE_TONE[g.state])}>
          {t(`state.${g.state}`)}
        </span>
      </div>
      {centre && g.ending_soon && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300" data-testid="group-ending-soon">
          <Hourglass className="size-3" aria-hidden />
          {g.ends_in_days != null && g.ends_in_days >= 0 ? tTerm("endsIn", { days: g.ends_in_days }) : tTerm("endingSoon")}
          {g.lessons_planned != null && ` · ${tTerm("progress", { held: g.lessons_held ?? 0, planned: g.lessons_planned })}`}
        </p>
      )}

      <div className="mt-3 space-y-1.5 text-sm">
        <p className="flex items-center gap-1.5">
          <GraduationCap className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{g.teacher_name ?? "—"}</span>
        </p>
        <p className="flex items-center gap-1.5">
          {g.mode === "ONLINE" ? (
            <Video className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          ) : (
            <MapPin className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">{g.mode === "OFFLINE" && g.location ? g.location : t(`mode.${g.mode}`)}</span>
        </p>
        <p className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
          {sortSlots(g.slots).map((s) => (
            <span key={`${s.weekday}-${s.start_time_local}`}>
              {tw(`weekday.${s.weekday}`)} {wallTime(s.start_time_local, locale)}
            </span>
          ))}
        </p>
      </div>

      {/* Seats. */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t("seats")}</span>
          <span className={cn("font-semibold tabular-nums", full && "text-amber-600 dark:text-amber-400")}>
            {g.capacity !== null
              ? t("seatsOf", { count: g.member_count, capacity: g.capacity })
              : t("students", { count: g.member_count })}
          </span>
        </div>
        {share !== null && (
          <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
            <div className={cn("h-full rounded-full", full ? "bg-amber-500" : "bg-primary")} style={{ width: `${share}%` }} />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
        {g.lessons.next_lesson_at ? (
          <span className="text-muted-foreground inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden />
            {t("nextLesson", {
              when: `${lessonDate(g.lessons.next_lesson_at, g.timezone, locale)} ${lessonTime(g.lessons.next_lesson_at, g.timezone, locale)}`,
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("noNextLesson")}</span>
        )}
        {g.lessons.overdue > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-700 dark:text-rose-300"
            data-testid="group-overdue"
          >
            <AlertTriangle className="size-3" aria-hidden />
            {t("overdue", { count: g.lessons.overdue })}
          </span>
        )}
      </div>
    </Link>
  );
}

/** One number in a soft block of its colour: the lessons held, coming up, and still without a sheet. */
function LessonStat({ value, label, tone, testId }: { value: number; label: string; tone: string; testId?: string }) {
  return (
    <div className={cn("rounded-xl px-2 py-2 text-center", tone)} data-testid={testId}>
      <p className="text-lg leading-tight font-extrabold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-xs font-semibold">{label}</p>
    </div>
  );
}

/**
 * The same group, in a centre's look, in the dashboard's language: a pastel tile, soft coloured badges
 * and blocks, and its seats closing the card. Every colour says something: the tile is the subject, the
 * badge is the state, the red block is sheets owed, the amber one a course about to end, and the bar turns
 * amber when the group is full.
 */
function CentreGroupCard({ group: g }: { group: GroupRow }) {
  const t = useTranslations("groups");
  const tTerm = useTranslations("courseTerm");
  const tw = useTranslations("scheduling");
  const locale = useLocale();
  const full = g.capacity !== null && g.member_count >= g.capacity;
  const share = g.capacity ? Math.min(100, Math.round((g.member_count / g.capacity) * 100)) : null;
  const seatsLeft = g.capacity !== null ? Math.max(g.capacity - g.member_count, 0) : null;
  const state = STATE_BADGE[g.state];
  // The colour follows the subject (else the level), so every English group wears the same one.
  const tile = pastelFor(g.specialization_name ?? g.level ?? g.name);

  // Days that share a time are one chip: a Monday and Wednesday class is one fact, not two.
  const daysByTime = new Map<string, string[]>();
  for (const slot of sortSlots(g.slots)) {
    daysByTime.set(slot.start_time_local, [...(daysByTime.get(slot.start_time_local) ?? []), tw(`weekday.${slot.weekday}`)]);
  }
  const daySeparator = locale.startsWith("ar") ? "، " : ", ";
  const Place = g.mode === "ONLINE" ? Video : MapPin;

  return (
    <Link
      href={`/groups/${g.id}`}
      className="centre-surface bg-card hover:border-primary/40 focus-visible:ring-ring/50 group/card flex h-full flex-col overflow-hidden rounded-2xl border transition-all outline-none hover:shadow-md focus-visible:ring-2"
      data-testid={`group-card-${g.id}`}
    >
      <div className="flex flex-1 flex-col gap-3.5 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl", tile)}>
            <UsersRound className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="group-hover/card:text-primary truncate text-base font-extrabold transition-colors">{g.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold", state.pill)}>
                <span className={cn("size-1.5 rounded-full", state.dot)} aria-hidden />
                {t(`state.${g.state}`)}
              </span>
              {g.level && <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-bold">{g.level}</span>}
              {g.specialization_name && <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold">{g.specialization_name}</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <p className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              <GraduationCap className="size-4" aria-hidden />
            </span>
            <span className="truncate font-semibold">{g.teacher_name ?? "—"}</span>
          </p>
          <p className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              <Place className="size-4" aria-hidden />
            </span>
            <span className="truncate font-semibold">{g.mode === "OFFLINE" && g.location ? g.location : t(`mode.${g.mode}`)}</span>
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <LessonStat value={g.lessons.held} label={t("card.held")} tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" />
          <LessonStat value={g.lessons.upcoming} label={t("card.upcoming")} tone="bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300" />
          <LessonStat
            value={g.lessons.overdue}
            label={t("card.overdue")}
            tone={g.lessons.overdue > 0 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-muted text-muted-foreground"}
            testId={g.lessons.overdue > 0 ? "group-overdue" : undefined}
          />
        </div>

        <div className="space-y-1.5 text-xs font-semibold">
          {[...daysByTime].map(([time, days]) => (
            <p key={time} className="bg-muted/70 flex items-center gap-2 rounded-lg px-2.5 py-1.5">
              <Clock className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <span>
                {days.join(daySeparator)} · {wallTime(time, locale)}
              </span>
            </p>
          ))}
          <p className="flex items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            {g.lessons.next_lesson_at ? (
              <span className="truncate">
                {t("card.nextLesson")}: {lessonDate(g.lessons.next_lesson_at, g.timezone, locale)} · {lessonTime(g.lessons.next_lesson_at, g.timezone, locale)}
              </span>
            ) : (
              <span className="truncate">{t("noNextLesson")}</span>
            )}
          </p>
          {g.ending_soon && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-100 px-2.5 py-1.5 font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" data-testid="group-ending-soon">
              <Hourglass className="size-3.5 shrink-0" aria-hidden />
              <span>
                {g.ends_in_days != null && g.ends_in_days >= 0 ? tTerm("endsIn", { days: g.ends_in_days }) : tTerm("endingSoon")}
                {g.lessons_planned != null && ` · ${isolateFractions(tTerm("progress", { held: g.lessons_held ?? 0, planned: g.lessons_planned }))}`}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* The seats close every card at the same place, whatever the card above them holds. */}
      <div className="border-t px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground flex items-center gap-2 font-semibold">
            {t("seats")}
            {seatsLeft !== null && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-bold",
                  full
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                )}
              >
                {full ? t("card.full") : t("card.seatsLeft", { count: seatsLeft })}
              </span>
            )}
          </span>
          {/* LTR, or Arabic text reverses it and "0 of 15" reads as 15 / 0. */}
          <span dir="ltr" className="text-sm font-extrabold tabular-nums">
            {g.capacity !== null ? t("seatsOf", { count: g.member_count, capacity: g.capacity }) : t("students", { count: g.member_count })}
          </span>
        </div>
        {share !== null && (
          <div className="bg-muted mt-2 h-2 overflow-hidden rounded-full">
            <div className={cn("h-full rounded-full transition-all", full ? "bg-amber-500" : "bg-primary")} style={{ width: `${share}%` }} />
          </div>
        )}
      </div>
    </Link>
  );
}
