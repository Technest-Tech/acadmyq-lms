"use client";

import {
  Award,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  Download,
  FileText,
  HelpCircle,
  Infinity as InfinityIcon,
  Lock,
  MessageCircle,
  PlayCircle,
  RefreshCw,
  Share2,
  Smartphone,
  Sparkles,
  Ticket,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLearn } from "@/components/learn/context";
import {
  CourseThumb,
  LessonTypeIcon,
  Meta,
  Pill,
  useFormatDuration,
  useLessonTypeLabel,
} from "@/components/learn/course-bits";
import { CourseGrid } from "@/components/learn/course-card";
import {
  Container,
  CtaButton,
  FaqAccordion,
  Section,
} from "@/components/learn/sections";
import { useRequestCodeHref } from "@/components/learn/site-chrome";
import { Modal } from "@/components/ui/modal";
import {
  learnCatalog,
  learnCourse,
  learnEnrollFree,
  type LearnCourseCard,
  type LearnCourseDetail,
  type LearnLesson,
  type LearnSection,
} from "@/lib/learn-api";
import {
  courseStats,
  formatMonthYear,
  lessonsOf,
  sumDuration,
} from "@/lib/learn-format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LessonContent } from "../../lesson-content";

/**
 * A course's sales page (docs/lms/09) — the surface that has to convince someone to go find a code,
 * built to the shape a buyer already knows from the big course marketplaces: a dark headline band,
 * an enrol card that floats over it, the syllabus at a glance, and a curriculum you can open lesson
 * by lesson before you pay.
 *
 * Locked lessons stay VISIBLE (titles, types and runtimes only): seeing what you would get is the
 * whole point, and the API withholds the content itself, so nothing leaks.
 */
export default function CourseDetailPage() {
  const t = useTranslations("learn");
  const locale = useLocale();
  const { academy, site, isEnrolled, openRedeem, requireAuth, refresh } =
    useLearn();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<LearnCourseDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [others, setOthers] = useState<LearnCourseCard[]>([]);
  const [preview, setPreview] = useState<LearnLesson | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // The floating card is the primary CTA; once it scrolls away the mobile bar takes over.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardVisible, setCardVisible] = useState(true);

  useEffect(() => {
    setData(null);
    setMissing(false);
    learnCourse(academy, slug)
      .then(setData)
      .catch(() => setMissing(true));
    learnCatalog(academy)
      .then((r) =>
        setOthers(r.courses.filter((c) => c.slug !== slug).slice(0, 3)),
      )
      .catch(() => setOthers([]));
  }, [academy, slug]);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setCardVisible(entries[0]?.isIntersecting ?? true),
      { rootMargin: "-80px 0px 0px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [data]);

  /**
   * Free course = no code, no paywall: sign in (if needed) and the enrollment is created on the
   * spot. `refresh` re-reads /me, so the card flips to "Continue" without a reload.
   */
  const joinFree = () =>
    requireAuth(async () => {
      setJoinError(null);
      setJoining(true);
      try {
        await learnEnrollFree(academy, slug);
        await refresh();
      } catch (e) {
        setJoinError(e instanceof Error ? e.message : t("course.enrollFailed"));
      } finally {
        setJoining(false);
      }
    });

  const stats = useMemo(() => courseStats(data?.sections ?? []), [data]);
  const previews = useMemo(
    () => lessonsOf(data?.sections ?? []).filter((l) => l.is_preview),
    [data],
  );

  if (missing) {
    return (
      <Container className="py-28 text-center">
        <p className="text-muted-foreground text-sm">{t("course.notFound")}</p>
        <CtaButton
          variant="outline"
          className="mt-6"
          href={`/learn/${academy}/courses`}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("course.back")}
        </CtaButton>
      </Container>
    );
  }

  if (!data) return <DetailSkeleton />;

  const course = data.course;
  const enrolled = isEnrolled(course.id);
  const updated = formatMonthYear(
    course.updated_at ?? course.published_at,
    locale,
  );
  const instructors = site.instructors.show
    ? site.instructors.items.slice(0, 3)
    : [];

  const enrolCard = (
    <EnrolCard
      course={course}
      sections={data.sections}
      enrolled={enrolled}
      joining={joining}
      joinError={joinError}
      onJoinFree={joinFree}
      onRedeem={openRedeem}
      onPreview={() => setPreview(previews[0] ?? null)}
      previewCount={previews.length}
      academy={academy}
    />
  );

  return (
    <>
      {/* ── headline band ─────────────────────────────────────────────────── */}
      <section
        className="relative text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--brand-deep) 0%, oklch(0.22 0.03 250) 55%, oklch(0.17 0.02 250) 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.35) 1px, transparent 0)",
            backgroundSize: "26px 26px",
            maskImage: "linear-gradient(180deg, black, transparent 85%)",
            WebkitMaskImage: "linear-gradient(180deg, black, transparent 85%)",
          }}
        />

        <Container className="relative pt-6 pb-10 sm:pt-8 sm:pb-14">
          <nav
            aria-label="breadcrumb"
            className="mb-6 flex items-center gap-2 text-xs text-white/60"
          >
            <Link
              href={`/learn/${academy}`}
              className="transition-colors hover:text-white"
            >
              {t("nav.home")}
            </Link>
            <span aria-hidden>/</span>
            <Link
              href={`/learn/${academy}/courses`}
              className="transition-colors hover:text-white"
            >
              {t("catalog.title")}
            </Link>
            <span aria-hidden>/</span>
            <span className="max-w-[45vw] truncate text-white/90">
              {course.title}
            </span>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
            <div className="max-w-2xl space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {course.is_free ? (
                  <Pill className="bg-emerald-500 text-white">
                    <Sparkles className="size-3.5" aria-hidden />
                    {t("catalog.free")}
                  </Pill>
                ) : (
                  <Pill className="bg-white/15 text-white backdrop-blur">
                    <Ticket className="size-3.5" aria-hidden />
                    {t("course.codeAccess")}
                  </Pill>
                )}
                {enrolled && (
                  <Pill className="bg-white/15 text-white backdrop-blur">
                    <BadgeCheck className="size-3.5" aria-hidden />
                    {t("catalog.enrolled")}
                  </Pill>
                )}
              </div>

              <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
                {course.title}
              </h1>

              {course.subtitle && (
                <p className="text-lg leading-relaxed text-white/75">
                  {course.subtitle}
                </p>
              )}

              {/* Headline counts (students / lessons / runtime / sections) are deliberately NOT here:
                  a young catalogue advertises its own thinness. The curriculum below still shows
                  everything, where it reads as contents rather than as a score. */}
              {updated && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/70">
                  <Meta icon={RefreshCw}>
                    {t("course.updated", { date: updated })}
                  </Meta>
                </div>
              )}

              {instructors.length > 0 && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-white/70">
                  {t("course.createdBy")}
                  <span className="font-semibold text-white underline decoration-white/30 underline-offset-4">
                    {new Intl.ListFormat(locale, {
                      type: "conjunction",
                    }).format(instructors.map((person) => person.name))}
                  </span>
                </p>
              )}
            </div>

            {/* The enrol card's column. On lg the card is lifted out of flow so it overlaps the
                band's bottom edge — the marketplace signature — while the column reserves its width.
                It hangs down PAST the sticky course index, so it has to outrank it (z-30) or that
                bar's translucent background paints a stripe across the card. Still below the site
                header (z-40), which must stay on top of everything as you scroll. */}
            <div className="lg:relative">
              <div
                ref={cardRef}
                className="lg:absolute lg:inset-x-0 lg:top-0 lg:z-[35]"
              >
                {enrolCard}
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* A compact, persistent course index keeps long sales pages easy to scan on desktop. */}
      <div className="bg-card/90 sticky top-[4.5rem] z-30 hidden border-b backdrop-blur-xl lg:block">
        <Container>
          <nav
            aria-label={t("course.about")}
            className="flex h-13 items-center gap-7 overflow-x-auto text-sm font-semibold"
          >
            {stats.sections > 0 && (
              <a
                href="#course-overview"
                className="text-muted-foreground hover:text-primary inline-flex h-full items-center border-b-2 border-transparent transition-colors hover:border-[var(--brand-line)]"
              >
                {t("course.covers")}
              </a>
            )}
            <a
              href="#course-curriculum"
              className="text-muted-foreground hover:text-primary inline-flex h-full items-center border-b-2 border-transparent transition-colors hover:border-[var(--brand-line)]"
            >
              {t("course.curriculum")}
            </a>
            {course.description && (
              <a
                href="#course-about"
                className="text-muted-foreground hover:text-primary inline-flex h-full items-center border-b-2 border-transparent transition-colors hover:border-[var(--brand-line)]"
              >
                {t("course.about")}
              </a>
            )}
            {instructors.length > 0 && (
              <a
                href="#course-instructors"
                className="text-muted-foreground hover:text-primary inline-flex h-full items-center border-b-2 border-transparent transition-colors hover:border-[var(--brand-line)]"
              >
                {t("course.instructors")}
              </a>
            )}
          </nav>
        </Container>
      </div>

      {/* ── body ───────────────────────────────────────────────────────────── */}
      <Container className="py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
          <div className="min-w-0 space-y-12">
            {stats.sections > 0 && (
              <div id="course-overview" className="scroll-mt-36">
                <SyllabusGlance sections={data.sections} />
              </div>
            )}

            <section id="course-curriculum" className="scroll-mt-36 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold sm:text-2xl">
                    {t("course.curriculum")}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t("course.curriculumMeta", {
                      sections: stats.sections,
                      lessons: stats.lessons,
                    })}
                    {stats.duration > 0 && (
                      <>
                        {" · "}
                        <Duration seconds={stats.duration} />
                      </>
                    )}
                  </p>
                </div>
              </div>

              <Curriculum
                sections={data.sections}
                enrolled={enrolled}
                watchBase={`/learn/${academy}/watch/${slug}`}
                onPreview={setPreview}
              />
            </section>

            {course.description && (
              <section id="course-about" className="scroll-mt-36 space-y-3">
                <h2 className="text-xl font-bold sm:text-2xl">
                  {t("course.about")}
                </h2>
                <ExpandableText text={course.description} />
              </section>
            )}

            {instructors.length > 0 && (
              <section
                id="course-instructors"
                className="scroll-mt-36 space-y-5"
              >
                <h2 className="text-xl font-bold sm:text-2xl">
                  {site.instructors.heading || t("course.instructors")}
                </h2>
                <div className="space-y-4">
                  {instructors.map((person) => (
                    <div
                      key={person.name}
                      className="bg-card flex gap-4 rounded-2xl border p-5"
                    >
                      <CourseThumb
                        src={person.photo_url}
                        className="size-16 shrink-0 rounded-full"
                        iconClassName="size-6"
                      />
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold">{person.name}</p>
                        {person.role && (
                          <p className="text-primary text-sm font-medium">
                            {person.role}
                          </p>
                        )}
                        {person.bio && (
                          <p className="text-muted-foreground text-sm leading-relaxed">
                            {person.bio}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* The includes list lives in the card on desktop; on mobile the card is far above by now. */}
            <section className="space-y-4 lg:hidden">
              <h2 className="text-xl font-bold">{t("course.includes")}</h2>
              <div className="bg-card rounded-2xl border p-5">
                <IncludesList sections={data.sections} />
              </div>
            </section>
          </div>

          <div aria-hidden className="hidden lg:block" />
        </div>
      </Container>

      {others.length > 0 && (
        <Section tone="muted" divider>
          <h2 className="mb-6 text-xl font-bold sm:text-2xl">
            {t("course.more")}
          </h2>
          <CourseGrid courses={others} />
        </Section>
      )}

      <FaqAccordion limit={4} tone="tint" divider />

      {/* Mobile action bar — appears only once the enrol card has scrolled past. */}
      {!cardVisible && (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t p-3 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{course.title}</p>
              <p className="text-base font-bold tabular-nums">
                {course.is_free
                  ? t("catalog.free")
                  : formatMoney(
                      { amount: course.price_minor, currency: course.currency },
                      locale,
                    )}
              </p>
            </div>
            {enrolled ? (
              <CtaButton
                href={`/learn/${academy}/watch/${slug}`}
                className="h-11 shrink-0 px-5"
              >
                <PlayCircle className="size-4" aria-hidden />
                {t("course.continue")}
              </CtaButton>
            ) : course.is_free ? (
              <CtaButton
                onClick={joinFree}
                disabled={joining}
                className="h-11 shrink-0 px-5"
              >
                {joining ? t("course.enrolling") : t("course.enrollFree")}
              </CtaButton>
            ) : (
              <CtaButton onClick={openRedeem} className="h-11 shrink-0 px-5">
                <Ticket className="size-4" aria-hidden />
                {t("course.enroll")}
              </CtaButton>
            )}
          </div>
        </div>
      )}

      {preview && (
        <Modal
          open
          size="xl"
          onClose={() => setPreview(null)}
          title={preview.title}
          description={t("course.previewNote")}
        >
          <LessonContent lesson={preview} academy={academy} />
          {previews.length > 1 && (
            <div className="mt-5 space-y-1.5 border-t pt-4">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {t("course.otherPreviews")}
              </p>
              {previews
                .filter((l) => l.id !== preview.id)
                .map((lesson) => (
                  <button
                    key={lesson.id}
                    type="button"
                    onClick={() => setPreview(lesson)}
                    className="hover:bg-muted/60 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start text-sm transition-colors"
                  >
                    <PlayCircle
                      className="text-primary size-4 shrink-0"
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{lesson.title}</span>
                    <LessonDuration seconds={lesson.duration_seconds} />
                  </button>
                ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

// ── enrol card ────────────────────────────────────────────────────────────────

function EnrolCard({
  course,
  sections,
  enrolled,
  joining,
  joinError,
  onJoinFree,
  onRedeem,
  onPreview,
  previewCount,
  academy,
}: {
  course: LearnCourseDetail["course"];
  sections: LearnSection[];
  enrolled: boolean;
  joining: boolean;
  joinError: string | null;
  onJoinFree: () => void;
  onRedeem: () => void;
  onPreview: () => void;
  previewCount: number;
  academy: string;
}) {
  const t = useTranslations("learn");
  const locale = useLocale();
  const requestCodeHref = useRequestCodeHref(course.title);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (insecure origin / permissions) — the URL bar still works */
    }
  };

  return (
    // `text-foreground` is load-bearing: the card sits inside the white-on-dark headline band, and
    // without it the price and section headings inherit that white onto the card's own surface.
    <div className="bg-card text-foreground overflow-hidden rounded-2xl border shadow-2xl">
      <button
        type="button"
        onClick={previewCount > 0 ? onPreview : undefined}
        disabled={previewCount === 0}
        className="group relative block w-full text-start disabled:cursor-default"
      >
        <CourseThumb
          src={course.cover_image_path}
          className="aspect-video"
          iconClassName="size-12"
        />
        {previewCount > 0 && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white transition-colors group-hover:bg-black/55">
            <span className="flex size-14 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-110">
              <PlayCircle className="size-8 text-neutral-900" aria-hidden />
            </span>
            <span className="text-sm font-semibold">
              {t("course.previewCta")}
            </span>
          </span>
        )}
      </button>

      <div className="space-y-4 p-5">
        <div className="flex items-baseline justify-between gap-3">
          {course.is_free ? (
            <span className="inline-flex items-center gap-1.5 text-3xl font-bold text-emerald-600">
              <Sparkles className="size-6" aria-hidden />
              {t("catalog.free")}
            </span>
          ) : (
            <span className="text-3xl font-bold tracking-tight tabular-nums">
              {formatMoney(
                { amount: course.price_minor, currency: course.currency },
                locale,
              )}
            </span>
          )}
          {!course.is_free && (
            <span className="text-muted-foreground text-xs">
              {t("course.oneOff")}
            </span>
          )}
        </div>

        {enrolled ? (
          <CtaButton
            href={`/learn/${academy}/watch/${course.slug}`}
            className="w-full"
          >
            <PlayCircle className="size-4" aria-hidden />
            {t("course.continue")}
          </CtaButton>
        ) : course.is_free ? (
          <CtaButton onClick={onJoinFree} disabled={joining} className="w-full">
            <Sparkles className="size-4" aria-hidden />
            {joining ? t("course.enrolling") : t("course.enrollFree")}
          </CtaButton>
        ) : (
          <>
            <CtaButton onClick={onRedeem} className="w-full">
              <Ticket className="size-4" aria-hidden />
              {t("course.enroll")}
            </CtaButton>
            {/* The other half of the code model: a visitor with no code needs a way to ask for one,
                and the answer is a person — WhatsApp, or the contact page as the fallback. */}
            <CtaButton
              variant="outline"
              href={requestCodeHref}
              className="w-full"
            >
              <MessageCircle className="size-4" aria-hidden />
              {t("course.requestCode")}
            </CtaButton>
            <p className="text-muted-foreground text-center text-xs leading-relaxed">
              {t("redeem.hint")}
            </p>
          </>
        )}

        {joinError && <p className="text-destructive text-sm">{joinError}</p>}

        <div className="border-t pt-4">
          <p className="mb-3 text-sm font-bold">{t("course.includes")}</p>
          <IncludesList sections={sections} />
        </div>

        <button
          type="button"
          onClick={share}
          className="text-muted-foreground hover:text-primary inline-flex w-full items-center justify-center gap-2 pt-1 text-xs font-semibold transition-colors"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Share2 className="size-3.5" aria-hidden />
          )}
          {copied ? t("course.linkCopied") : t("course.share")}
        </button>
      </div>
    </div>
  );
}

/** "This course includes" — every line derived from what the course actually contains. */
function IncludesList({ sections }: { sections: LearnSection[] }) {
  const t = useTranslations("learn");
  const stats = courseStats(sections);

  const rows: { icon: typeof Video; label: ReactNode }[] = [];
  if (stats.videos > 0) {
    rows.push({
      icon: Video,
      label:
        stats.duration > 0 ? (
          <>
            <Duration seconds={stats.duration} /> {t("course.includesVideo")}
          </>
        ) : (
          t("course.includesVideoCount", { count: stats.videos })
        ),
    });
  }
  if (stats.readings > 0) {
    rows.push({
      icon: FileText,
      label: t("course.includesReadings", { count: stats.readings }),
    });
  }
  if (stats.downloads > 0) {
    rows.push({
      icon: Download,
      label: t("course.includesDownloads", { count: stats.downloads }),
    });
  }
  if (stats.quizzes > 0) {
    rows.push({
      icon: HelpCircle,
      label: t("course.includesQuizzes", { count: stats.quizzes }),
    });
  }
  rows.push({ icon: InfinityIcon, label: t("course.includesLifetime") });
  rows.push({ icon: Smartphone, label: t("course.includesDevices") });
  rows.push({ icon: Award, label: t("course.certificateIncluded") });

  return (
    <ul className="space-y-2.5 text-sm">
      {rows.map((row, i) => (
        <li key={i} className="text-muted-foreground flex items-center gap-2.5">
          <row.icon className="text-primary size-4 shrink-0" aria-hidden />
          <span className="flex-1">{row.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ── syllabus ──────────────────────────────────────────────────────────────────

/** "What this course covers" — the section titles, which ARE the promise, in a scannable grid. */
function SyllabusGlance({ sections }: { sections: LearnSection[] }) {
  const t = useTranslations("learn");
  const titles = sections.filter((s) => s.lessons.length > 0).slice(0, 8);
  if (titles.length < 2) return null;

  return (
    <section className="bg-card rounded-2xl border p-6 sm:p-7">
      <h2 className="mb-5 text-xl font-bold sm:text-2xl">
        {t("course.covers")}
      </h2>
      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {titles.map((section) => (
          <li key={section.id} className="flex gap-2.5 text-sm leading-relaxed">
            <Check
              className="text-primary mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <span>{section.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── curriculum ────────────────────────────────────────────────────────────────

function Curriculum({
  sections,
  enrolled,
  watchBase,
  onPreview,
}: {
  sections: LearnSection[];
  enrolled: boolean;
  /** `/learn/{academy}/watch/{slug}` — a lesson row appends its own `?lesson=`. */
  watchBase: string;
  onPreview: (lesson: LearnLesson) => void;
}) {
  const t = useTranslations("learn");
  // First section open by default — enough to show the shape without a wall of rows.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(sections.slice(0, 1).map((s) => s.id)),
  );
  const allOpen = open.size === sections.length && sections.length > 0;

  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground rounded-2xl border border-dashed py-12 text-center text-sm">
        {t("player.empty")}
      </p>
    );
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() =>
            setOpen(allOpen ? new Set() : new Set(sections.map((s) => s.id)))
          }
          className="text-primary text-sm font-semibold hover:underline"
        >
          {allOpen ? t("course.collapseAll") : t("course.expandAll")}
        </button>
      </div>

      <div className="bg-card divide-y overflow-hidden rounded-2xl border">
        {sections.map((section, index) => {
          const isOpen = open.has(section.id);
          const duration = sumDuration(section.lessons);

          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => toggle(section.id)}
                aria-expanded={isOpen}
                className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-4 text-start transition-colors sm:px-5"
              >
                <ChevronDown
                  className={cn(
                    "text-muted-foreground size-4 shrink-0 transition-transform",
                    isOpen && "rotate-180",
                  )}
                  aria-hidden
                />
                <span className="text-primary flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-xs font-bold tabular-nums">
                  {index + 1}
                </span>
                <span className="flex-1 font-semibold">{section.title}</span>
                <span className="text-muted-foreground hidden shrink-0 text-xs sm:block">
                  {t("catalog.lessons", { count: section.lessons.length })}
                  {duration > 0 && (
                    <>
                      {" · "}
                      <Duration seconds={duration} />
                    </>
                  )}
                </span>
              </button>

              {isOpen && (
                <ul className="border-t">
                  {section.lessons.map((lesson) => (
                    <LessonRow
                      key={lesson.id}
                      lesson={lesson}
                      enrolled={enrolled}
                      watchHref={`${watchBase}?lesson=${lesson.id}`}
                      onPreview={onPreview}
                    />
                  ))}
                  {section.lessons.length === 0 && (
                    <li className="text-muted-foreground px-5 py-4 text-sm">
                      {t("course.sectionEmpty")}
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LessonRow({
  lesson,
  enrolled,
  watchHref,
  onPreview,
}: {
  lesson: LearnLesson;
  enrolled: boolean;
  /** Where an enrolled learner lands when they pick a lesson — the player. */
  watchHref: string;
  onPreview: (lesson: LearnLesson) => void;
}) {
  const t = useTranslations("learn");
  const typeLabel = useLessonTypeLabel();
  const unlocked = lesson.is_preview || enrolled;

  const body = (
    <>
      {unlocked ? (
        <LessonTypeIcon type={lesson.type} className="text-primary shrink-0" />
      ) : (
        <Lock className="size-4 shrink-0 opacity-35" aria-hidden />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          !unlocked && "text-muted-foreground",
        )}
      >
        {lesson.title}
      </span>
      {lesson.is_preview && !enrolled && (
        <Pill className="text-primary shrink-0 bg-[var(--brand-soft)]">
          {t("course.preview")}
        </Pill>
      )}
      <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
        {typeLabel(lesson.type)}
      </span>
      <LessonDuration seconds={lesson.duration_seconds} />
    </>
  );

  const className =
    "hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-start text-sm transition-colors sm:px-5";

  // Enrolled → the lesson opens in the player. Not enrolled → a free preview opens in the modal,
  // and everything else is a title you can read but not click, which is the point of showing it.
  return (
    <li>
      {enrolled ? (
        <Link href={watchHref} className={className}>
          {body}
        </Link>
      ) : lesson.is_preview ? (
        <button
          type="button"
          onClick={() => onPreview(lesson)}
          className={className}
        >
          {body}
        </button>
      ) : (
        <div className={cn(className, "cursor-default")}>{body}</div>
      )}
    </li>
  );
}

// ── small pieces ──────────────────────────────────────────────────────────────

function Duration({ seconds }: { seconds: number }) {
  const format = useFormatDuration();
  return <>{format(seconds)}</>;
}

function LessonDuration({ seconds }: { seconds: number | null }) {
  const format = useFormatDuration();
  const value = format(seconds);
  if (!value) return null;
  return (
    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
      {value}
    </span>
  );
}

/** Long descriptions collapse to a readable height with a real "show more" — no CSS-only fade lies. */
function ExpandableText({ text }: { text: string }) {
  const t = useTranslations("learn");
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 420;

  return (
    <div className="space-y-2">
      <div className="relative">
        <p
          className={cn(
            "text-muted-foreground leading-relaxed whitespace-pre-wrap",
            long && !expanded && "line-clamp-6",
          )}
        >
          {text}
        </p>
        {long && !expanded && (
          <span className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent" />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-primary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        >
          {expanded ? t("course.showLess") : t("course.showMore")}
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <>
      <div className="bg-muted/60 border-b">
        <Container className="space-y-4 py-16">
          <div className="bg-muted h-4 w-40 animate-pulse rounded" />
          <div className="bg-muted h-9 w-2/3 animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
        </Container>
      </div>
      <Container className="grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-muted h-16 animate-pulse rounded-2xl" />
          ))}
        </div>
        <div className="bg-muted hidden h-80 animate-pulse rounded-2xl lg:block" />
      </Container>
    </>
  );
}
