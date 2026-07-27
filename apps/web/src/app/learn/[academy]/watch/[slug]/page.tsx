"use client";

import {
  Award,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ListChecks,
  PanelRightClose,
  PanelRightOpen,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLearn } from "@/components/learn/context";
import {
  LessonTypeIcon,
  ProgressBar,
  ProgressRing,
  useFormatDuration,
  useLessonTypeLabel,
} from "@/components/learn/course-bits";
import { SiteLogo } from "@/components/learn/site-chrome";
import { Button } from "@/components/ui/button";
import {
  learnCourse,
  learnEnrollFree,
  learnPlayer,
  learnSaveProgress,
  LearnApiError,
  type LearnLesson,
  type LearnProgress,
  type LearnSection,
} from "@/lib/learn-api";
import { completedCount, lessonsOf, resumeLesson, sumDuration } from "@/lib/learn-format";
import { cn } from "@/lib/utils";
import { LessonContent } from "../../lesson-content";

/**
 * The lesson player (docs/lms/09). Runs WITHOUT the marketing chrome — the provider strips the
 * header and footer on `/watch/*` — so the whole viewport belongs to the lesson: a stage on the
 * left, the curriculum on the right, and a bar at the bottom that always answers "what now".
 *
 * It behaves the way a course platform is expected to: it remembers where you stopped inside a
 * video, ticks a lesson off once you have effectively watched it, and rolls on to the next one.
 * `?lesson=<id>` deep-links a specific lesson, and the URL follows as you move.
 */

type PlayerData = Awaited<ReturnType<typeof learnPlayer>>;

const MEDIA_TYPES = new Set(["VIDEO_UPLOAD", "YOUTUBE", "AUDIO"]);
/** Watched this far in → treat the lesson as done, the same rule the big platforms use. */
const COMPLETE_AT = 0.95;
const AUTOPLAY_KEY = "lms_autoplay";

export default function WatchPage() {
  const t = useTranslations("learn");
  const { academy, siteName, requireAuth, openRedeem, refresh } = useLearn();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<PlayerData | null>(null);
  const [progress, setProgress] = useState<Record<string, LearnProgress>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "locked" | "error">("loading");
  // Locked, but the course costs nothing — the gate is one click, not a code hunt.
  const [lockedFree, setLockedFree] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [mobileList, setMobileList] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [certificate, setCertificate] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "notes">("overview");

  // The lesson to open: whatever the learner last picked in this session, else the `?lesson=` they
  // arrived with (read straight off the URL — no useSearchParams, no Suspense boundary needed).
  const requestedRef = useRef<string | null>(null);
  // True once the learner has moved themselves, which is what makes autoplay their choice, not ours.
  const navigated = useRef(false);
  // Fire-and-forget position saves; kept in a ref so the flush on lesson change sees the latest.
  const pending = useRef<{ lessonId: string; position: number } | null>(null);

  useEffect(() => {
    setAutoplay(window.localStorage.getItem(AUTOPLAY_KEY) !== "off");
  }, []);

  const load = useCallback(() => {
    setState("loading");
    learnPlayer(academy, slug)
      .then((d) => {
        setData(d);
        setProgress(d.progress ?? {});
        const flat = lessonsOf(d.sections);
        const asked =
          requestedRef.current ?? new URLSearchParams(window.location.search).get("lesson");
        const wanted = asked ? flat.find((l) => l.id === asked) : undefined;
        setCurrentId((wanted ?? resumeLesson(flat, d.progress ?? {}))?.id ?? null);
        setState("ready");
      })
      .catch((e) => {
        if (e instanceof LearnApiError && e.status === 401) setState("auth");
        else if (e instanceof LearnApiError && e.status === 403) {
          setState("locked");
          learnCourse(academy, slug)
            .then((c) => setLockedFree(c.course.is_free))
            .catch(() => setLockedFree(false));
        } else setState("error");
      });
  }, [academy, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const lessons = useMemo(() => lessonsOf(data?.sections ?? []), [data]);
  const current: LearnLesson | undefined = useMemo(
    () => lessons.find((l) => l.id === currentId),
    [lessons, currentId],
  );
  const index = current ? lessons.findIndex((l) => l.id === current.id) : -1;
  const previousLesson = index > 0 ? lessons[index - 1] : undefined;
  const nextLesson = index >= 0 ? lessons[index + 1] : undefined;
  const done = useMemo(() => completedCount(lessons, progress), [lessons, progress]);
  const pct = lessons.length > 0 ? Math.round((done / lessons.length) * 100) : 0;
  const currentDone = current ? progress[current.id]?.status === "COMPLETED" : false;

  /** Writes one lesson's progress through, keeping the local map in step with the server's answer. */
  const save = useCallback(
    async (lessonId: string, input: { position_seconds?: number; completed?: boolean }) => {
      try {
        const res = await learnSaveProgress(academy, lessonId, input);
        if (res.certificate) setCertificate(res.certificate.serial);
      } catch {
        /* keep the UI responsive; a failed save just leaves the lesson un-ticked */
      }
    },
    [academy],
  );

  const setCompleted = useCallback(
    (lesson: LearnLesson, completed: boolean) => {
      setProgress((p) => ({
        ...p,
        [lesson.id]: {
          status: completed ? "COMPLETED" : "IN_PROGRESS",
          position_seconds: p[lesson.id]?.position_seconds ?? 0,
          completed_at: p[lesson.id]?.completed_at ?? null,
        },
      }));
      void save(lesson.id, { completed });
    },
    [save],
  );

  /** Moves to a lesson, flushing the outgoing one's resume point and following the URL along. */
  const goTo = useCallback(
    (lesson: LearnLesson) => {
      const flush = pending.current;
      if (flush && flush.lessonId !== lesson.id) {
        void save(flush.lessonId, { position_seconds: Math.floor(flush.position) });
        pending.current = null;
      }
      requestedRef.current = lesson.id;
      navigated.current = true;
      setCurrentId(lesson.id);
      setMobileList(false);
      setTab("overview");
      window.history.replaceState(null, "", `?lesson=${lesson.id}`);
      document.querySelector("#lesson-stage")?.scrollIntoView({ block: "start" });
    },
    [save],
  );

  const advance = useCallback(() => {
    if (nextLesson) goTo(nextLesson);
  }, [nextLesson, goTo]);

  /** The media reported a position: remember it, and tick the lesson off once it's effectively done. */
  const onTime = useCallback(
    (position: number, duration: number) => {
      if (!current) return;
      pending.current = { lessonId: current.id, position };
      void save(current.id, { position_seconds: Math.floor(position) });
      if (duration > 0 && position / duration >= COMPLETE_AT && !currentDone) {
        setCompleted(current, true);
      }
    },
    [current, currentDone, save, setCompleted],
  );

  const onEnded = useCallback(() => {
    if (!current) return;
    if (!currentDone) setCompleted(current, true);
    if (autoplay) advance();
  }, [current, currentDone, autoplay, setCompleted, advance]);

  // Last resume point on the way out (tab close is best-effort; the 10s cadence covers the rest).
  useEffect(
    () => () => {
      const flush = pending.current;
      if (flush)
        void learnSaveProgress(academy, flush.lessonId, {
          position_seconds: Math.floor(flush.position),
        }).catch(() => undefined);
    },
    [academy],
  );

  const toggleAutoplay = () => {
    setAutoplay((v) => {
      window.localStorage.setItem(AUTOPLAY_KEY, v ? "off" : "on");
      return !v;
    });
  };

  if (state === "auth") {
    return (
      <Prompt
        message={t("player.signInNeeded")}
        action={t("auth.signIn")}
        onClick={() => requireAuth(load)}
        academy={academy}
        slug={slug}
      />
    );
  }
  if (state === "locked") {
    return (
      <Prompt
        message={lockedFree ? t("player.freeJoin") : t("player.notEnrolled")}
        action={lockedFree ? t("course.enrollFree") : t("course.enroll")}
        onClick={
          lockedFree
            ? () => {
                learnEnrollFree(academy, slug)
                  .then(() => {
                    void refresh();
                    load();
                  })
                  .catch(() => setState("error"));
              }
            : openRedeem
        }
        academy={academy}
        slug={slug}
      />
    );
  }
  if (state === "loading") {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-16">
        <div className="bg-muted aspect-video animate-pulse rounded-2xl" />
        <div className="bg-muted h-6 w-1/3 animate-pulse rounded" />
      </div>
    );
  }
  if (state === "error" || !data) {
    return <p className="text-muted-foreground py-24 text-center text-sm">{t("errors.generic")}</p>;
  }

  const finished = lessons.length > 0 && done === lessons.length;
  const isMedia = current ? MEDIA_TYPES.has(current.type) : false;

  const stage = current ? (
    <LessonContent
      key={current.id}
      lesson={current}
      academy={academy}
      startAt={progress[current.id]?.position_seconds}
      autoPlay={autoplay && navigated.current}
      onTime={onTime}
      onEnded={onEnded}
      onComplete={load}
    />
  ) : null;

  const curriculum = (
    <Curriculum
      sections={data.sections}
      progress={progress}
      currentId={currentId}
      onPick={goTo}
      onToggle={setCompleted}
      done={done}
      total={lessons.length}
    />
  );

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── player bar ─────────────────────────────────────────────────────── */}
      <header className="bg-background/90 sticky top-0 z-30 border-b backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Link
            href={`/learn/${academy}/c/${slug}`}
            className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-2 text-sm transition-colors"
          >
            <ChevronLeft className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
            <span className="max-w-[40vw] truncate font-semibold sm:max-w-xs">
              {data.course.title}
            </span>
          </Link>

          <div className="ms-auto flex items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-2.5 sm:flex">
              <ProgressRing value={pct} size={34} stroke={3} />
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("player.progress", { done, total: lessons.length })}
              </span>
            </span>

            <button
              type="button"
              onClick={() => setMobileList(true)}
              className="border-input hover:border-primary/50 inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors lg:hidden"
            >
              <ListChecks className="size-4" aria-hidden />
              {t("player.contents")}
            </button>

            <button
              type="button"
              onClick={() => setSidebar((v) => !v)}
              aria-label={t("player.contents")}
              title={t("player.contents")}
              className="text-muted-foreground hover:text-foreground hidden p-1.5 transition-colors lg:inline-flex"
            >
              {sidebar ? (
                <PanelRightClose className="size-5 rtl:rotate-180" aria-hidden />
              ) : (
                <PanelRightOpen className="size-5 rtl:rotate-180" aria-hidden />
              )}
            </button>

            <Link href={`/learn/${academy}`} aria-label={siteName} className="hidden sm:block">
              <SiteLogo size={28} />
            </Link>
          </div>
        </div>
      </header>

      <div className="flex flex-1 lg:min-h-0">
        {/* ── stage ────────────────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
          {/* A video owns the top of the screen; a reading or a quiz reads better UNDER its own
              title, so only media gets the black stage above the lesson header. */}
          {isMedia && (
            <div id="lesson-stage" className="bg-neutral-950">
              <div className="mx-auto w-full max-w-5xl">{stage}</div>
            </div>
          )}

          <div
            id={isMedia ? undefined : "lesson-stage"}
            className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6"
          >
            {(certificate || finished) && (
              <Link
                href={`/learn/${academy}/certificate/${slug}`}
                className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                <Award className="size-5 shrink-0" aria-hidden />
                <span className="flex-1">
                  {certificate ? t("player.certificateEarned") : t("player.certificateReady")}
                </span>
                <ChevronRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
              </Link>
            )}

            {current ? (
              <>
                <LessonHeader
                  lesson={current}
                  position={index + 1}
                  total={lessons.length}
                  completed={currentDone}
                  onToggle={() => setCompleted(current, !currentDone)}
                />

                {!isMedia && <div className="mt-6">{stage}</div>}

                <LessonTabs
                  tab={tab}
                  setTab={setTab}
                  lesson={current}
                  academy={academy}
                  courseDescription={data.course.description}
                />

                <nav className="mt-8 flex items-center justify-between gap-3 border-t pt-5">
                  <NavButton
                    lesson={previousLesson}
                    direction="prev"
                    label={t("player.previous")}
                    onClick={goTo}
                  />
                  <label className="text-muted-foreground hidden cursor-pointer items-center gap-2 text-xs font-medium sm:flex">
                    <input
                      type="checkbox"
                      checked={autoplay}
                      onChange={toggleAutoplay}
                      className="accent-primary size-4"
                    />
                    {t("player.autoplay")}
                  </label>
                  <NavButton
                    lesson={nextLesson}
                    direction="next"
                    label={t("player.next")}
                    onClick={goTo}
                  />
                </nav>
              </>
            ) : (
              <p className="text-muted-foreground py-16 text-center text-sm">{t("player.empty")}</p>
            )}
          </div>
        </main>

        {/* ── curriculum ───────────────────────────────────────────────────── */}
        {sidebar && (
          <aside className="hidden w-[350px] shrink-0 border-s lg:block lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
            {curriculum}
          </aside>
        )}
      </div>

      {/* Mobile curriculum — a sheet, so the lesson never loses its place behind it. */}
      {mobileList && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileList(false)}
            aria-hidden
          />
          <div className="bg-background absolute inset-y-0 end-0 flex w-[88vw] max-w-sm flex-col shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <span className="font-semibold">{t("player.contents")}</span>
              <button
                type="button"
                onClick={() => setMobileList(false)}
                aria-label={t("player.close")}
                className="text-muted-foreground hover:text-foreground p-1.5"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{curriculum}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── lesson chrome ─────────────────────────────────────────────────────────────

function LessonHeader({
  lesson,
  position,
  total,
  completed,
  onToggle,
}: {
  lesson: LearnLesson;
  position: number;
  total: number;
  completed: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("learn");
  const typeLabel = useLessonTypeLabel();
  const duration = useFormatDuration()(lesson.duration_seconds);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {t("player.lessonOf", { position, total })}
        </p>
        <h1 className="text-xl font-bold sm:text-2xl">{lesson.title}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <LessonTypeIcon type={lesson.type} className="size-3.5" />
            {typeLabel(lesson.type)}
          </span>
          {duration && (
            <span className="inline-flex items-center gap-1.5">
              <Timer className="size-3.5" aria-hidden />
              {duration}
            </span>
          )}
          {lesson.is_preview && (
            <span className="text-primary font-semibold">{t("course.preview")}</span>
          )}
        </div>
      </div>

      {/* A quiz ticks itself off when it is passed — a manual tick would be a lie. */}
      {lesson.type !== "QUIZ" && (
        <Button size="lg" variant={completed ? "outline" : "default"} onClick={onToggle}>
          <CheckCircle2 />
          {completed ? t("player.completed") : t("player.markComplete")}
        </Button>
      )}
    </div>
  );
}

function LessonTabs({
  tab,
  setTab,
  lesson,
  academy,
  courseDescription,
}: {
  tab: "overview" | "notes";
  setTab: (t: "overview" | "notes") => void;
  lesson: LearnLesson;
  academy: string;
  courseDescription: string | null;
}) {
  const t = useTranslations("learn");
  // A TEXT lesson's body IS the stage content — repeating it under "overview" would be noise.
  const body = lesson.type === "TEXT" ? null : (lesson.body ?? null);

  return (
    <div className="mt-6">
      <div className="flex gap-1 border-b">
        {(["overview", "notes"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-selected={tab === value}
            role="tab"
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              tab === value
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t(`player.tab.${value}`)}
          </button>
        ))}
      </div>

      <div className="pt-5">
        {tab === "overview" ? (
          <div className="space-y-4 text-sm leading-relaxed">
            {body ? (
              <p className="whitespace-pre-wrap">{body}</p>
            ) : courseDescription ? (
              <p className="text-muted-foreground whitespace-pre-wrap">{courseDescription}</p>
            ) : (
              <p className="text-muted-foreground">{t("player.noOverview")}</p>
            )}
          </div>
        ) : (
          <LessonNotes academy={academy} lessonId={lesson.id} />
        )}
      </div>
    </div>
  );
}

/**
 * Personal notes, kept in this browser. Deliberately local: there is no notes endpoint, and a
 * textarea that silently drops what you typed is worse than one that is honest about where it lives.
 */
function LessonNotes({ academy, lessonId }: { academy: string; lessonId: string }) {
  const t = useTranslations("learn");
  const key = `lms_notes_${academy}_${lessonId}`;
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(window.localStorage.getItem(key) ?? "");
    setSaved(false);
  }, [key]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
      setSaved(true);
    }, 600);
    return () => window.clearTimeout(id);
  }, [key, value]);

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => {
          setSaved(false);
          setValue(e.target.value);
        }}
        rows={6}
        placeholder={t("player.notesPlaceholder")}
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/40 w-full rounded-xl border p-4 text-sm leading-relaxed outline-none transition-shadow focus-visible:ring-4"
      />
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {saved && value ? <Check className="size-3.5" aria-hidden /> : null}
        {t("player.notesHint")}
      </p>
    </div>
  );
}

function NavButton({
  lesson,
  direction,
  label,
  onClick,
}: {
  lesson: LearnLesson | undefined;
  direction: "prev" | "next";
  label: string;
  onClick: (lesson: LearnLesson) => void;
}) {
  if (!lesson) return <span className="w-24" />;

  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={() => onClick(lesson)}
      className={cn(
        "group hover:border-primary/50 flex min-w-0 max-w-[45%] items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
        direction === "next" && "ms-auto text-end",
      )}
    >
      {direction === "prev" && <Icon className="size-4 shrink-0 rtl:rotate-180" aria-hidden />}
      <span className="min-w-0">
        <span className="text-muted-foreground block text-[10px] font-semibold tracking-wide uppercase">
          {label}
        </span>
        <span className="group-hover:text-primary block truncate font-medium transition-colors">
          {lesson.title}
        </span>
      </span>
      {direction === "next" && <Icon className="size-4 shrink-0 rtl:rotate-180" aria-hidden />}
    </button>
  );
}

// ── curriculum ────────────────────────────────────────────────────────────────

function Curriculum({
  sections,
  progress,
  currentId,
  onPick,
  onToggle,
  done,
  total,
}: {
  sections: LearnSection[];
  progress: Record<string, LearnProgress>;
  currentId: string | null;
  onPick: (lesson: LearnLesson) => void;
  onToggle: (lesson: LearnLesson, completed: boolean) => void;
  done: number;
  total: number;
}) {
  const t = useTranslations("learn");
  const format = useFormatDuration();
  // Everything starts open — a curriculum you have already paid for should not need excavating.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  return (
    <div className="divide-y">
      <div className="bg-background/95 sticky top-0 z-10 space-y-2.5 border-b p-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold">{t("player.contents")}</p>
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("player.progress", { done, total })}
          </span>
        </div>
        <ProgressBar
          value={total > 0 ? (done / total) * 100 : 0}
          tone={done === total && total > 0 ? "emerald" : "primary"}
        />
      </div>

      {sections.map((section, index) => {
        const open = !collapsed.has(section.id);
        const sectionDone = section.lessons.filter(
          (l) => progress[l.id]?.status === "COMPLETED",
        ).length;
        const duration = sumDuration(section.lessons);

        return (
          <div key={section.id}>
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })
              }
              aria-expanded={open}
              className="hover:bg-muted/50 flex w-full items-start gap-2.5 p-4 text-start transition-colors"
            >
              <ChevronDown
                className={cn(
                  "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform",
                  !open && "-rotate-90 rtl:rotate-90",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {t("player.sectionNumber", { n: index + 1 })} · {section.title}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                  {t("player.sectionProgress", {
                    done: sectionDone,
                    total: section.lessons.length,
                  })}
                  {duration > 0 && ` · ${format(duration)}`}
                </span>
              </span>
            </button>

            {open && (
              <ul className="pb-1">
                {section.lessons.map((lesson) => {
                  const isDone = progress[lesson.id]?.status === "COMPLETED";
                  const isCurrent = lesson.id === currentId;

                  return (
                    <li key={lesson.id} className="relative">
                      <div
                        className={cn(
                          "flex items-start gap-2.5 px-4 py-2.5 transition-colors",
                          isCurrent
                            ? "bg-[var(--brand-soft)] border-primary border-s-2"
                            : "hover:bg-muted/40 border-s-2 border-transparent",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onToggle(lesson, !isDone)}
                          aria-label={isDone ? t("player.completed") : t("player.markComplete")}
                          title={isDone ? t("player.completed") : t("player.markComplete")}
                          className="mt-0.5 shrink-0"
                          disabled={lesson.type === "QUIZ"}
                        >
                          {isDone ? (
                            <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
                          ) : (
                            <Circle
                              className={cn(
                                "size-4 opacity-40 transition-opacity",
                                lesson.type !== "QUIZ" && "hover:opacity-80",
                              )}
                              aria-hidden
                            />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onPick(lesson)}
                          className="min-w-0 flex-1 text-start"
                        >
                          <span
                            className={cn(
                              "block text-sm leading-snug",
                              isCurrent ? "text-primary font-semibold" : "font-medium",
                              isDone && !isCurrent && "text-muted-foreground",
                            )}
                          >
                            {lesson.title}
                          </span>
                          <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                            <LessonTypeIcon type={lesson.type} className="size-3" />
                            {format(lesson.duration_seconds) ?? ""}
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Prompt({
  message,
  action,
  onClick,
  academy,
  slug,
}: {
  message: string;
  action: string;
  onClick: () => void;
  academy: string;
  slug: string;
}) {
  const t = useTranslations("learn");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-28 text-center">
      <p className="text-muted-foreground text-sm">{message}</p>
      <Button size="lg" onClick={onClick}>
        {action}
      </Button>
      <Link
        href={`/learn/${academy}/c/${slug}`}
        className="text-muted-foreground hover:text-foreground text-xs transition-colors"
      >
        {t("course.back")}
      </Link>
    </div>
  );
}
