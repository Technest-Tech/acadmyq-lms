"use client";

import {
  Award,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  LogOut,
  Mail,
  Phone,
  PlayCircle,
  Sparkles,
  Ticket,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthShell } from "@/components/learn/auth-forms";
import { BookGrid } from "@/components/learn/book-card";
import { useLearn } from "@/components/learn/context";
import {
  CourseThumb,
  ProgressBar,
  ProgressRing,
  useFormatDuration,
} from "@/components/learn/course-bits";
import { Container, CtaButton } from "@/components/learn/sections";
import {
  learnCatalog,
  learnLibrary,
  learnPlayer,
  type LearnCourseCard,
  type LearnLesson,
  type LearnProductCard,
} from "@/lib/learn-api";
import { completedCount, lessonsOf, resumeLesson } from "@/lib/learn-format";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * "My learning" (docs/lms/09) — the signed-in learner's home: what they unlocked, how far they got,
 * what to do next, and the certificates waiting at the end. The dashboard a course platform opens
 * on, rather than a bare list.
 *
 * Progress is computed by asking each enrolled course for its content, which already carries the
 * learner's per-lesson progress map. That is one request per enrolled course — fine, because a
 * learner holds a handful of them, and it beats a summary endpoint that would have to duplicate the
 * player's rules about what counts as complete. A course whose fetch fails is shown without a bar.
 */

interface Enrolled {
  course: LearnCourseCard;
  done: number;
  total: number;
  /** The lesson "continue" lands on — the first one they haven't finished. */
  next?: LearnLesson;
}

type Tab = "progress" | "completed" | "all" | "certificates" | "library";

export default function MyLearningPage() {
  const t = useTranslations("learn");
  const locale = useLocale();
  const {
    academy,
    learner,
    enrolled,
    loading,
    isEnrolled,
    openRedeem,
    logout,
  } = useLearn();
  const [items, setItems] = useState<Enrolled[] | null>(null);
  const [tab, setTab] = useState<Tab>("progress");
  // The bookshelf (docs/lms/11). Loaded independently of the courses: a learner who owns only books
  // must still see something here, and a failing catalogue must not take the library down with it.
  const [library, setLibrary] = useState<LearnProductCard[]>([]);

  useEffect(() => {
    if (!learner) return;
    let cancelled = false;
    void learnLibrary(academy)
      .then((r) => {
        if (!cancelled) setLibrary(r.products);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [academy, learner]);

  useEffect(() => {
    if (!learner) return;
    let cancelled = false;

    void (async () => {
      let courses: LearnCourseCard[] = [];
      try {
        courses = (await learnCatalog(academy)).courses.filter((c) =>
          isEnrolled(c.id),
        );
      } catch {
        if (!cancelled) setItems([]);
        return;
      }

      const withProgress = await Promise.all(
        courses.map(async (course): Promise<Enrolled> => {
          try {
            const data = await learnPlayer(academy, course.slug);
            const lessons = lessonsOf(data.sections);
            const done = completedCount(lessons, data.progress);
            return {
              course,
              done,
              total: lessons.length,
              next:
                done < lessons.length
                  ? resumeLesson(lessons, data.progress)
                  : undefined,
            };
          } catch {
            return { course, done: 0, total: course.lesson_count };
          }
        }),
      );

      if (!cancelled) setItems(withProgress);
    })();

    return () => {
      cancelled = true;
    };
    // Re-runs when a redeem grows the enrolment set — `enrolled` is the identity that changes then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academy, learner, enrolled]);

  const groups = useMemo(() => {
    const all = items ?? [];
    const finished = all.filter((i) => i.total > 0 && i.done >= i.total);
    return {
      all,
      finished,
      inProgress: all.filter((i) => !(i.total > 0 && i.done >= i.total)),
      lessonsDone: all.reduce((sum, i) => sum + i.done, 0),
    };
  }, [items]);

  if (loading) {
    return (
      <Container className="py-24">
        <div className="bg-muted mx-auto h-8 w-48 animate-pulse rounded" />
      </Container>
    );
  }

  if (!learner) {
    return (
      <AuthShell title={t("me.signInNeeded")}>
        <div className="space-y-3">
          <CtaButton href={`/learn/${academy}/login`} className="w-full">
            {t("auth.signIn")}
          </CtaButton>
          <CtaButton
            variant="outline"
            href={`/learn/${academy}/courses`}
            className="w-full"
          >
            {t("catalog.title")}
          </CtaButton>
        </div>
      </AuthShell>
    );
  }

  const firstName = learner.full_name.trim().split(/\s+/)[0] ?? "";
  const initials = learner.full_name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  const visible =
    tab === "progress"
      ? groups.inProgress
      : tab === "completed"
        ? groups.finished
        : groups.all;
  const tabItems: { value: Tab; label: string; count: number }[] = [
    {
      value: "progress",
      label: t("me.tabInProgress"),
      count: groups.inProgress.length,
    },
    {
      value: "completed",
      label: t("me.tabCompleted"),
      count: groups.finished.length,
    },
    { value: "all", label: t("me.tabAll"), count: groups.all.length },
    // Only offered once they own one — an empty tab is a question the page cannot answer.
    ...(library.length > 0
      ? [
          {
            value: "library" as Tab,
            label: t("books.myLibrary"),
            count: library.length,
          },
        ]
      : []),
    {
      value: "certificates",
      label: t("me.certificates"),
      count: groups.finished.length,
    },
  ];

  return (
    <>
      {/* ── profile band ───────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden border-b">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(160deg, var(--brand-soft), transparent 70%)",
          }}
        />
        <Container className="py-10 sm:py-14">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <span
              className="bg-primary text-primary-foreground flex size-20 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold shadow-lg"
              aria-hidden
            >
              {initials || <GraduationCap className="size-8" />}
            </span>

            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {t("me.title", { name: firstName })}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t("me.subtitle")}
              </p>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5" aria-hidden />
                  {learner.email}
                </span>
                {learner.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="size-3.5" aria-hidden />
                    {learner.phone}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <CtaButton onClick={openRedeem}>
                <Ticket className="size-4" aria-hidden />
                {t("redeem.cta")}
              </CtaButton>
              <CtaButton variant="outline" href={`/learn/${academy}/courses`}>
                {t("catalog.viewAll")}
              </CtaButton>
            </div>
          </div>

          {/* Live counters, straight off the same data the list below renders. */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              icon={<BookOpen className="size-4" aria-hidden />}
              value={formatNumber(groups.all.length, locale)}
              label={t("me.stats.courses")}
            />
            <StatTile
              icon={<PlayCircle className="size-4" aria-hidden />}
              value={formatNumber(groups.inProgress.length, locale)}
              label={t("me.stats.inProgress")}
            />
            <StatTile
              icon={<CheckCircle2 className="size-4" aria-hidden />}
              value={formatNumber(groups.lessonsDone, locale)}
              label={t("me.stats.lessonsDone")}
            />
            <StatTile
              icon={<Award className="size-4" aria-hidden />}
              value={formatNumber(groups.finished.length, locale)}
              label={t("me.stats.certificates")}
            />
          </div>
        </Container>
      </section>

      <Container className="py-10 sm:py-12">
        <div className="grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="bg-card sticky top-24 rounded-2xl border p-3 shadow-sm">
              <p className="text-muted-foreground px-3 pt-2 pb-3 text-xs font-bold tracking-wide uppercase">
                {t("me.myCourses")}
              </p>
              <nav className="space-y-1">
                {tabItems.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-current={tab === item.value ? "page" : undefined}
                    onClick={() => setTab(item.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start text-sm font-semibold transition-colors",
                      tab === item.value
                        ? "bg-[var(--brand-soft)] text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span>{item.label}</span>
                    {items !== null && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                          tab === item.value ? "bg-card" : "bg-muted",
                        )}
                      >
                        {formatNumber(item.count, locale)}
                      </span>
                    )}
                  </button>
                ))}
              </nav>

              <div className="mt-3 space-y-2 border-t pt-3">
                <button
                  type="button"
                  onClick={openRedeem}
                  className="bg-primary text-primary-foreground flex h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition-opacity hover:opacity-90"
                >
                  <Ticket className="size-4" aria-hidden />
                  {t("redeem.cta")}
                </button>
                <Link
                  href={`/learn/${academy}/courses`}
                  className="border-border hover:border-primary/40 hover:text-primary flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors"
                >
                  <BookOpen className="size-4" aria-hidden />
                  {t("catalog.viewAll")}
                </Link>
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            {/* Compact tabs stay on mobile; desktop gets the persistent learning rail. */}
            <div className="mb-6 flex flex-wrap items-center gap-1 border-b lg:hidden">
              {tabItems.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.value}
                  onClick={() => setTab(item.value)}
                  className={cn(
                    "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
                    tab === item.value
                      ? "border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground border-transparent",
                  )}
                >
                  {item.label}
                  {items !== null && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                        tab === item.value
                          ? "bg-[var(--brand-soft)]"
                          : "bg-muted",
                      )}
                    >
                      {formatNumber(item.count, locale)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="bg-card rounded-3xl border p-4 shadow-sm sm:p-6">
              {items === null ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <div
                      key={i}
                      className="bg-muted h-28 animate-pulse rounded-2xl"
                    />
                  ))}
                </div>
              ) : groups.all.length === 0 ? (
                <EmptyState
                  title={t("me.none")}
                  action={
                    <CtaButton className="mt-6" onClick={openRedeem}>
                      <Ticket className="size-4" aria-hidden />
                      {t("redeem.cta")}
                    </CtaButton>
                  }
                />
              ) : tab === "library" ? (
                <BookGrid books={library} />
              ) : tab === "certificates" ? (
                groups.finished.length === 0 ? (
                  <EmptyState
                    title={t("me.noCertificates")}
                    action={
                      <CtaButton
                        variant="outline"
                        className="mt-6"
                        onClick={() => setTab("progress")}
                      >
                        {t("me.tabInProgress")}
                      </CtaButton>
                    }
                  />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {groups.finished.map(({ course }) => (
                      <Link
                        key={course.id}
                        href={`/learn/${academy}/certificate/${course.slug}`}
                        className="group bg-card hover:border-primary/40 relative overflow-hidden rounded-2xl border p-5 transition-all hover:shadow-lg"
                      >
                        <span
                          className="pointer-events-none absolute -end-8 -top-8 size-24 rounded-full bg-amber-200/40 blur-2xl"
                          aria-hidden
                        />
                        <Award
                          className="mb-3 size-7 text-amber-500"
                          aria-hidden
                        />
                        <p className="group-hover:text-primary line-clamp-2 font-semibold transition-colors">
                          {course.title}
                        </p>
                        <p className="text-muted-foreground mt-1.5 text-xs">
                          {t("me.certificate")}
                        </p>
                      </Link>
                    ))}
                  </div>
                )
              ) : visible.length === 0 ? (
                <EmptyState
                  title={
                    tab === "completed"
                      ? t("me.noneCompleted")
                      : t("me.noneInProgress")
                  }
                  action={
                    <CtaButton
                      variant="outline"
                      className="mt-6"
                      onClick={() => setTab("all")}
                    >
                      {t("me.tabAll")}
                    </CtaButton>
                  }
                />
              ) : (
                <ul className="space-y-4">
                  {visible.map((item) => (
                    <CourseProgressRow
                      key={item.course.id}
                      item={item}
                      academy={academy}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* ── account ──────────────────────────────────────────────────────── */}
            <div className="bg-card mt-6 rounded-2xl border p-5 shadow-sm sm:p-6">
              <h2 className="mb-4 text-sm font-bold tracking-wide uppercase">
                {t("me.account")}
              </h2>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Field label={t("auth.fullName")} value={learner.full_name} />
                <Field label={t("auth.email")} value={learner.email} />
                <Field
                  label={t("contact.phone")}
                  value={learner.phone ?? "—"}
                />
              </dl>
              <button
                type="button"
                onClick={() => void logout()}
                className="text-muted-foreground hover:text-destructive mt-5 inline-flex items-center gap-2 text-sm font-semibold transition-colors"
              >
                <LogOut className="size-4" aria-hidden />
                {t("auth.logout")}
              </button>
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────────

function CourseProgressRow({
  item,
  academy,
}: {
  item: Enrolled;
  academy: string;
}) {
  const t = useTranslations("learn");
  const duration = useFormatDuration()(item.course.duration_seconds);
  const { course, done, total, next } = item;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const finished = total > 0 && done >= total;

  return (
    <li className="bg-card hover:border-primary/40 flex flex-col gap-4 rounded-2xl border p-4 transition-all hover:shadow-md sm:flex-row sm:items-center sm:gap-5 sm:p-5">
      <Link href={`/learn/${academy}/c/${course.slug}`} className="shrink-0">
        <CourseThumb
          src={course.cover_image_path}
          className="aspect-video w-full rounded-xl sm:w-40"
          iconClassName="size-6"
        />
      </Link>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/learn/${academy}/c/${course.slug}`}
              className="hover:text-primary line-clamp-1 font-semibold transition-colors"
            >
              {course.title}
            </Link>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="tabular-nums">
                {t("player.progress", { done, total })}
              </span>
              {duration && (
                <span className="inline-flex items-center gap-1">
                  <Timer className="size-3.5" aria-hidden />
                  {duration}
                </span>
              )}
            </p>
          </div>
          <ProgressRing
            value={pct}
            size={44}
            className="hidden sm:inline-flex"
          />
        </div>

        <ProgressBar value={pct} tone={finished ? "emerald" : "primary"} />

        {next ? (
          <p className="text-muted-foreground truncate text-xs">
            <span className="font-semibold">{t("me.upNext")}</span> {next.title}
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
            <Sparkles className="size-3.5" aria-hidden />
            {t("me.finished")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        {finished && (
          <Link
            href={`/learn/${academy}/certificate/${course.slug}`}
            className="border-border hover:border-primary/50 hover:text-primary inline-flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition-colors"
          >
            <Award className="size-4" aria-hidden />
            {t("me.certificate")}
          </Link>
        )}
        <Link
          href={
            next
              ? `/learn/${academy}/watch/${course.slug}?lesson=${next.id}`
              : `/learn/${academy}/watch/${course.slug}`
          }
          className="bg-primary text-primary-foreground inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-opacity hover:opacity-90"
        >
          <PlayCircle className="size-4" aria-hidden />
          {finished
            ? t("me.review")
            : done > 0
              ? t("course.continue")
              : t("me.start")}
        </Link>
      </div>
    </li>
  );
}

function StatTile({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="bg-card/80 rounded-2xl border p-4 backdrop-blur">
      <span className="text-primary mb-2 flex size-8 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
        {icon}
      </span>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed py-20 text-center">
      <BookOpen
        className="text-muted-foreground/40 mx-auto mb-4 size-10"
        aria-hidden
      />
      <p className="text-muted-foreground mx-auto max-w-sm text-sm">{title}</p>
      {action}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="truncate text-sm font-semibold">{value}</dd>
    </div>
  );
}
