"use client";

import { AlertTriangle, CalendarClock, GraduationCap, Hourglass, MapPin, Plus, Search, UsersRound, Video } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { GroupForm } from "@/components/groups/group-form";
import {
  STATE_TONE,
  fieldClass,
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
import { listTeachers } from "@/lib/api";
import { fetchRoster } from "@/lib/roster";
import { listGroups, type GroupRow, type GroupState } from "@/lib/groups-api";
import { LevelSelect } from "@/components/levels/level-select";
import { useCapability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

type Tab = "ACTIVE" | GroupState;
const TABS: Tab[] = ["ACTIVE", "RUNNING", "UPCOMING", "FINISHED", "ARCHIVED"];

/**
 * The Groups page (docs/groups): every group class as a card — who teaches it, seats taken, the
 * weekly times, the next lesson, and a red flag when a lesson's sheet is overdue. The tabs cut the
 * list by the derived state, and their counts come from the same response as the cards, so a
 * number and the cards under it never disagree.
 */
export function GroupsManager() {
  const t = useTranslations("groups");
  const tLevels = useTranslations("levels");
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

  return (
    <div className="space-y-5">
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
                className="gap-1.5"
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
          {centre && (
            <button
              type="button"
              aria-pressed={endingSoon}
              onClick={() => setEndingSoon((v) => !v)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                endingSoon ? "border-amber-500 bg-amber-500 text-white" : "hover:bg-muted",
              )}
              data-testid="groups-filter-ending-soon"
            >
              <Hourglass className="size-3.5" aria-hidden />
              {tTerm("filterEndingSoon")}
            </button>
          )}
        </div>
        <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", centre ? "lg:w-[40rem] lg:grid-cols-3" : "lg:w-[28rem]")}>
          <label className="relative">
            <Search className="text-muted-foreground absolute top-1/2 size-4 -translate-y-1/2 ltr:left-3 rtl:right-3" />
            <input
              className={cn(fieldClass, "ps-9")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
            />
          </label>
          {teachers.length > 0 && (
            <Combobox
              options={[{ value: "", label: t("allTeachers") }, ...teachers]}
              value={teacherId}
              onChange={setTeacherId}
              placeholder={t("allTeachers")}
              searchPlaceholder={t("form.search")}
            />
          )}
          {centre && <LevelSelect value={levelId} onChange={setLevelId} noneLabel={tLevels("allLevels")} testId="groups-filter-level" />}
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {loading && groups.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <UsersRound className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-2 font-medium">{t("empty.title")}</p>
          <p className="text-muted-foreground mt-1 text-sm">{canManage ? t("empty.manage") : t("empty.read")}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="groups-list">
          {groups.map((g) => (
            <li key={g.id}>
              <GroupCard group={g} />
            </li>
          ))}
        </ul>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={t("new")} description={t("form.subtitle")} size="lg">
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
            {[g.level, g.specialization_name].filter(Boolean).join(" · ") || t("noLevel")}
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
