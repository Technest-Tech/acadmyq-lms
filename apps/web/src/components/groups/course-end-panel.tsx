"use client";

import { ArrowUpRight, Hourglass, Lock, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, textareaClass } from "@/components/groups/group-format";
import { PASTEL } from "@/components/groups/group-look";
import { LevelSelect } from "@/components/levels/level-select";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useModernLook } from "@/lib/capabilities";
import { closeGroup, promoteGroup, renewGroup, type GroupDetail } from "@/lib/groups-api";
import { type Level, listLevels } from "@/lib/levels-api";
import { cn } from "@/lib/utils";
import { useLevelWord } from "@/lib/levels";

type Action = "renew" | "promote" | "close";

/** The day after a date (YYYY-MM-DD), in plain calendar arithmetic. */
function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Days between two YYYY-MM-DD dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * "نهاية الكورس" (docs/centre-profile, Phase 2 §2): what a centre does when a group's term ends —
 * renew it into a new term, promote its students into the next level's term, or close it. Shown on a
 * RUNNING or FINISHED group for whoever manages groups; highlighted while the term is ending soon.
 * A renewal or promotion opens the new group; a close stays and refreshes.
 */
export function CourseEndPanel({ group, onClosed }: { group: GroupDetail; onClosed: (g: GroupDetail) => void }) {
  const t = useTranslations("courseTerm");
  const word = useLevelWord();
  const [action, setAction] = useState<Action | null>(null);
  const endingSoon = group.ending_soon === true;
  const look = useModernLook();

  return (
    <section
      className={cn(
        "rounded-2xl border p-4",
        look && "centre-surface",
        endingSoon ? "border-amber-400/60 bg-amber-500/5 dark:border-amber-500/40" : "bg-card",
      )}
      data-testid="course-end-panel"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={cn("min-w-0", look && "flex items-center gap-3")}>
          {look && (
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", endingSoon ? PASTEL.amber : PASTEL.indigo)}>
              <Hourglass className="size-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className={cn("flex items-center gap-1.5 font-semibold", look && "text-base font-extrabold")}>
              {!look && <Hourglass className={cn("size-4", endingSoon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} aria-hidden />}
              {t("panel.title")}
            </p>
            <p className={cn("text-muted-foreground mt-0.5 text-sm", look && "text-xs")}>
              {endingSoon && <span className="text-amber-700 dark:text-amber-300">{t("panel.endingSoon")} </span>}
              {group.state === "FINISHED" ? t("panel.subtitleFinished", { word }) : t("panel.subtitleRunning", { word })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setAction("renew")} data-testid="course-renew">
            <Repeat className="size-3.5" />
            {t("panel.renew")}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => setAction("promote")} data-testid="course-promote">
            <ArrowUpRight className="size-3.5" />
            {t("panel.promote")}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => setAction("close")} data-testid="course-close">
            <Lock className="size-3.5" />
            {t("panel.close")}
          </Button>
        </div>
      </div>

      <Modal open={action === "renew"} onClose={() => setAction(null)} title={t("renew.title")} description={t("renew.subtitle")} size="lg">
        {action === "renew" && <RenewForm group={group} onCancel={() => setAction(null)} />}
      </Modal>
      <Modal open={action === "promote"} onClose={() => setAction(null)} title={t("promote.title")} description={t("promote.subtitle", { word })} size="lg">
        {action === "promote" && <PromoteForm group={group} onCancel={() => setAction(null)} />}
      </Modal>
      <Modal open={action === "close"} onClose={() => setAction(null)} title={t("close.title")} description={t("close.subtitle")}>
        {action === "close" && (
          <CloseForm
            group={group}
            onCancel={() => setAction(null)}
            onClosed={(g) => {
              setAction(null);
              onClosed(g);
            }}
          />
        )}
      </Modal>
    </section>
  );
}

/** The members a new term can take on: a checklist, everyone ticked to begin with. */
function MemberChecklist({
  group,
  picked,
  onChange,
  label,
  hint,
  testId,
}: {
  group: GroupDetail;
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  label: string;
  hint: string;
  testId: string;
}) {
  const t = useTranslations("courseTerm");
  const active = group.members.filter((m) => m.status === "ACTIVE");

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {label} <span className="text-muted-foreground tabular-nums">({picked.size}/{active.length})</span>
        </span>
        {active.length > 0 && (
          <span className="flex gap-2 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={() => onChange(new Set(active.map((m) => m.student_id)))}>
              {t("renew.selectAll")}
            </button>
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => onChange(new Set())}>
              {t("renew.selectNone")}
            </button>
          </span>
        )}
      </div>
      {active.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-center text-sm">{t("renew.noMembers")}</p>
      ) : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border" data-testid={testId}>
          {active.map((m) => (
            <li key={m.student_id}>
              <label className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" checked={picked.has(m.student_id)} onChange={() => toggle(m.student_id)} data-testid={`${testId}-${m.student_id}`} />
                <span className="min-w-0 flex-1 truncate">{m.full_name}</span>
                {m.attendance?.rate != null && (
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{Math.round(m.attendance.rate * 100)}%</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

function TermDates({
  startDate,
  endDate,
  lessons,
  onStart,
  onEnd,
  onLessons,
}: {
  startDate: string;
  endDate: string;
  lessons: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  onLessons: (v: string) => void;
}) {
  const t = useTranslations("courseTerm");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          {t("renew.startDate")} <span className="text-destructive">*</span>
        </span>
        <input className={fieldClass} type="date" value={startDate} onChange={(e) => onStart(e.target.value)} data-testid="term-start" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("renew.endDate")}</span>
        <input className={fieldClass} type="date" value={endDate} min={startDate || undefined} onChange={(e) => onEnd(e.target.value)} data-testid="term-end" />
        <span className="text-muted-foreground block text-xs">{t("renew.endDateHint")}</span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("plannedLessons")}</span>
        <input className={fieldClass} type="number" inputMode="numeric" min={1} value={lessons} onChange={(e) => onLessons(e.target.value)} data-testid="term-lessons" />
      </label>
    </div>
  );
}

/** Where a new term's dates start from: the day after the old end (or today), kept the same length. */
function defaultDates(group: GroupDetail): { start: string; end: string } {
  const today = new Date().toISOString().slice(0, 10);
  const start = group.end_date ? dayAfter(group.end_date) : today;
  const end = group.end_date ? addDays(start, Math.max(0, daysBetween(group.start_date, group.end_date))) : "";
  return { start: start < today && group.state !== "FINISHED" ? today : start, end };
}

function RenewForm({ group, onCancel }: { group: GroupDetail; onCancel: () => void }) {
  const t = useTranslations("courseTerm");
  const tGroups = useTranslations("groups");
  const router = useRouter();
  const defaults = defaultDates(group);
  const [name, setName] = useState(group.name);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [lessons, setLessons] = useState(group.lessons_planned != null ? String(group.lessons_planned) : "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group.members.filter((m) => m.status === "ACTIVE").map((m) => m.student_id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCount = group.members.filter((m) => m.status === "ACTIVE").length;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!startDate) return setError(t("renew.errors.startDate"));
    if (endDate && endDate < startDate) return setError(t("renew.errors.endBeforeStart"));
    if (lessons && (!Number.isInteger(Number(lessons)) || Number(lessons) < 1)) return setError(t("renew.errors.lessons"));
    setBusy(true);
    setError(null);
    try {
      const keepAll = picked.size === activeCount;
      const res = await renewGroup(group.id, {
        start_date: startDate,
        end_date: endDate || null,
        lessons_planned: lessons ? Number(lessons) : null,
        name: name.trim() && name.trim() !== group.name ? name.trim() : null,
        keep_members: keepAll,
        ...(keepAll ? {} : { member_ids: [...picked] }),
      });
      router.push(`/groups/${res.group.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, t("panel.failed")));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="renew-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {group.lessons.upcoming > 0 && <AlertBanner variant="info" message={t("renew.upcomingWarning", { count: group.lessons.upcoming })} />}

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("renew.name")}</span>
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="renew-name" />
      </label>

      <TermDates startDate={startDate} endDate={endDate} lessons={lessons} onStart={setStartDate} onEnd={setEndDate} onLessons={setLessons} />

      <MemberChecklist group={group} picked={picked} onChange={setPicked} label={t("renew.members")} hint={t("renew.membersHint")} testId="renew-members" />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {tGroups("form.cancel")}
        </Button>
        <Button type="submit" disabled={busy} className="gap-1.5" data-testid="renew-submit">
          <Repeat className="size-4" />
          {busy ? t("renew.saving") : t("renew.submit")}
        </Button>
      </div>
    </form>
  );
}

/** The level after the group's, by the academy's order — what a promotion goes to unless told otherwise. */
function nextLevel(levels: Level[], levelId: string | null | undefined): Level | null {
  if (!levelId) return null;
  const sorted = [...levels].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const idx = sorted.findIndex((l) => l.id === levelId);
  if (idx < 0) return null;
  return sorted.slice(idx + 1).find((l) => l.is_active) ?? null;
}

function PromoteForm({ group, onCancel }: { group: GroupDetail; onCancel: () => void }) {
  const t = useTranslations("courseTerm");
  const word = useLevelWord();
  const tGroups = useTranslations("groups");
  const router = useRouter();
  const defaults = defaultDates(group);
  const [levels, setLevels] = useState<Level[] | undefined>(undefined);
  const [toLevelId, setToLevelId] = useState("");
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [lessons, setLessons] = useState(group.lessons_planned != null ? String(group.lessons_planned) : "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group.members.filter((m) => m.status === "ACTIVE").map((m) => m.student_id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ groupId: string; levelName: string; notPromoted: string[] } | null>(null);

  useEffect(() => {
    let live = true;
    void listLevels()
      .then((res) => {
        if (!live) return;
        setLevels(res.levels);
        const next = nextLevel(res.levels, group.level_id);
        if (next) setToLevelId(next.id);
      })
      .catch(() => live && setLevels([]));
    return () => {
      live = false;
    };
  }, [group.level_id]);

  const hasNext = useMemo(() => (levels ? nextLevel(levels, group.level_id) !== null : true), [levels, group.level_id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!toLevelId) return setError(t("promote.errors.level", { word }));
    if (picked.size === 0) return setError(t("promote.errors.members"));
    if (!startDate) return setError(t("renew.errors.startDate"));
    if (endDate && endDate < startDate) return setError(t("renew.errors.endBeforeStart"));
    if (lessons && (!Number.isInteger(Number(lessons)) || Number(lessons) < 1)) return setError(t("renew.errors.lessons"));
    setBusy(true);
    setError(null);
    try {
      const res = await promoteGroup(group.id, {
        to_level_id: toLevelId,
        start_date: startDate,
        end_date: endDate || null,
        lessons_planned: lessons ? Number(lessons) : null,
        member_ids: [...picked],
      });
      setDone({
        groupId: res.group.id,
        levelName: res.group.level ?? levels?.find((l) => l.id === res.to_level_id)?.name ?? "",
        notPromoted: res.not_promoted.map((s) => s.full_name),
      });
    } catch (err) {
      setError(apiErrorMessage(err, t("panel.failed")));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4" data-testid="promote-done">
        <AlertBanner variant="success" message={t("promote.done", { level: done.levelName })} />
        <p className="text-sm" data-testid="promote-not-promoted">
          {t("promote.notPromoted", { count: done.notPromoted.length, names: done.notPromoted.join("، ") })}
        </p>
        <div className="flex justify-end">
          <Button type="button" className="gap-1.5" onClick={() => router.push(`/groups/${done.groupId}`)} data-testid="promote-open-new">
            <ArrowUpRight className="size-4" />
            {t("promote.openNew")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="promote-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          {t("promote.toLevel", { word })} <span className="text-destructive">*</span>
        </label>
        <LevelSelect value={toLevelId} onChange={setToLevelId} levels={levels} noneLabel={t("promote.toLevelPlaceholder", { word })} testId="promote-to-level" />
        {levels && !hasNext && <p className="text-muted-foreground text-xs">{t("promote.noNext", { word })}</p>}
      </div>

      <TermDates startDate={startDate} endDate={endDate} lessons={lessons} onStart={setStartDate} onEnd={setEndDate} onLessons={setLessons} />

      <MemberChecklist group={group} picked={picked} onChange={setPicked} label={t("promote.members", { word })} hint={t("promote.membersHint")} testId="promote-members" />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {tGroups("form.cancel")}
        </Button>
        <Button type="submit" disabled={busy || !toLevelId} className="gap-1.5" data-testid="promote-submit">
          <ArrowUpRight className="size-4" />
          {busy ? t("promote.saving") : t("promote.submit")}
        </Button>
      </div>
    </form>
  );
}

function CloseForm({ group, onCancel, onClosed }: { group: GroupDetail; onCancel: () => void; onClosed: (g: GroupDetail) => void }) {
  const t = useTranslations("courseTerm");
  const tGroups = useTranslations("groups");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await closeGroup(group.id, reason.trim() || null);
      onClosed(res.group);
    } catch (err) {
      setError(apiErrorMessage(err, t("panel.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="close-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("close.reason")}</span>
        <textarea className={textareaClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("close.reasonPlaceholder")} maxLength={500} data-testid="close-reason" />
      </label>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {tGroups("form.cancel")}
        </Button>
        <Button type="submit" variant="destructive" disabled={busy} className="gap-1.5" data-testid="close-submit">
          <Lock className="size-4" />
          {busy ? t("close.saving") : t("close.submit")}
        </Button>
      </div>
    </form>
  );
}
