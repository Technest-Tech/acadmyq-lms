"use client";

import {
  ArrowRight,
  BookOpen,
  Check,
  LayoutGrid,
  PlayCircle,
  Rows3,
  Search,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLearn } from "@/components/learn/context";
import {
  CourseThumb,
  Pill,
  useFormatDuration,
} from "@/components/learn/course-bits";
import {
  CourseGrid,
  CourseGridSkeleton,
  CourseList,
  CourseListSkeleton,
} from "@/components/learn/course-card";
import { Container, CtaBand, CtaButton } from "@/components/learn/sections";
import { learnCatalog, type LearnCourseCard } from "@/lib/learn-api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The catalogue (docs/lms/09) — the shop floor of the course site. Built the way a course
 * marketplace is: search, facets, sort and two densities, with the learner's own courses one click
 * away at the top.
 *
 * All of it runs client-side on purpose. A catalogue is tens of rows, already in memory after one
 * request; a round-trip per keystroke or per facet click would be strictly slower and would put
 * load on the API for no gain.
 */

type Sort =
  | "newest"
  | "popular"
  | "longest"
  | "shortest"
  | "priceLow"
  | "priceHigh"
  | "az";
type Price = "all" | "free" | "paid";
type Length = "any" | "short" | "medium" | "long";
/** "" = every level / every topic. Both facets only exist when the catalogue actually varies. */
type Level = "" | NonNullable<LearnCourseCard["level"]>;

const HOUR = 3600;

export default function CatalogPage() {
  const t = useTranslations("learn");
  const locale = useLocale();
  const { academy, commerce, openRedeem, isEnrolled, learner } = useLearn();

  const [courses, setCourses] = useState<LearnCourseCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  const [query, setQuery] = useState("");
  const [price, setPrice] = useState<Price>("all");
  const [length, setLength] = useState<Length>("any");
  const [level, setLevel] = useState<Level>("");
  const [category, setCategory] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    learnCatalog(academy)
      .then((r) => setCourses(r.courses))
      .catch(() => setFailed(true));
  }, [academy]);

  const all = useMemo(() => courses ?? [], [courses]);
  const mine = useMemo(
    () => all.filter((c) => isEnrolled(c.id)),
    [all, isEnrolled],
  );
  // Facets only earn their space when the catalogue actually varies along them.
  const hasPaid = all.some((c) => !c.is_free);
  const hasFree = all.some((c) => c.is_free);
  const hasDurations = all.some((c) => (c.duration_seconds ?? 0) > 0);
  const hasPreviews = all.some((c) => (c.preview_count ?? 0) > 0);
  // Derived from the rows themselves: a client who never set a level gets no level facet, and the
  // topic list is their own vocabulary rather than a taxonomy the platform imposed.
  const levels = useMemo(
    () =>
      (["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"] as const).filter(
        (value) => all.some((c) => c.level === value),
      ),
    [all],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set(
          all.map((c) => c.category?.trim()).filter((v): v is string => !!v),
        ),
      ].sort((a, b) => a.localeCompare(b, locale)),
    [all, locale],
  );
  const totalLessons = all.reduce(
    (sum, course) => sum + course.lesson_count,
    0,
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = all.filter((c) => {
      if (mineOnly && !isEnrolled(c.id)) return false;
      if (price === "free" && !c.is_free) return false;
      if (price === "paid" && c.is_free) return false;
      if (previewOnly && (c.preview_count ?? 0) === 0) return false;
      if (level !== "" && c.level !== level) return false;
      if (category !== "" && (c.category ?? "").trim() !== category) return false;

      const seconds = c.duration_seconds ?? 0;
      if (length === "short" && !(seconds > 0 && seconds < HOUR)) return false;
      if (length === "medium" && !(seconds >= HOUR && seconds < 3 * HOUR))
        return false;
      if (length === "long" && !(seconds >= 3 * HOUR)) return false;

      if (needle === "") return true;
      return (
        c.title.toLowerCase().includes(needle) ||
        (c.subtitle ?? "").toLowerCase().includes(needle) ||
        (c.category ?? "").toLowerCase().includes(needle)
      );
    });

    const at = (c: LearnCourseCard) => new Date(c.published_at ?? 0).getTime();
    const seconds = (c: LearnCourseCard) => c.duration_seconds ?? 0;

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "popular":
          return (
            (b.learner_count ?? 0) - (a.learner_count ?? 0) || at(b) - at(a)
          );
        case "longest":
          return seconds(b) - seconds(a);
        case "shortest":
          return seconds(a) - seconds(b);
        case "priceLow":
          return a.price_minor - b.price_minor;
        case "priceHigh":
          return b.price_minor - a.price_minor;
        case "az":
          return a.title.localeCompare(b.title, locale);
        default:
          return at(b) - at(a);
      }
    });
  }, [
    all,
    query,
    price,
    length,
    level,
    category,
    mineOnly,
    previewOnly,
    sort,
    isEnrolled,
    locale,
  ]);

  const activeFilters =
    (price !== "all" ? 1 : 0) +
    (length !== "any" ? 1 : 0) +
    (level !== "" ? 1 : 0) +
    (category !== "" ? 1 : 0) +
    (mineOnly ? 1 : 0) +
    (previewOnly ? 1 : 0);

  const filtering = query.trim() !== "" || activeFilters > 0;

  const clearAll = () => {
    setPrice("all");
    setLength("any");
    setLevel("");
    setCategory("");
    setMineOnly(false);
    setPreviewOnly(false);
    setQuery("");
  };

  const facets = (
    <FacetPanel
      price={price}
      setPrice={setPrice}
      length={length}
      setLength={setLength}
      mineOnly={mineOnly}
      setMineOnly={setMineOnly}
      previewOnly={previewOnly}
      setPreviewOnly={setPreviewOnly}
      showPrice={hasPaid && hasFree}
      showLength={hasDurations}
      showPreview={hasPreviews}
      showMine={mine.length > 0}
      counts={{ mine: mine.length }}
      level={level}
      setLevel={setLevel}
      levels={levels}
      category={category}
      setCategory={setCategory}
      categories={categories}
    />
  );

  return (
    <>
      {/* Search-first hero: on a catalogue, the field IS the page's primary action. */}
      <section className="relative isolate overflow-hidden border-b">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(160deg, var(--brand-soft), transparent 68%)",
          }}
        />
        <Container className="py-9 sm:py-14 lg:py-16">
          <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="max-w-2xl space-y-4">
              <span className="text-primary inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold tracking-wide uppercase">
                <Sparkles className="size-3.5" aria-hidden />
                {t("catalog.eyebrow")}
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-5xl">
                {t("catalog.title")}
              </h1>
              <p className="text-muted-foreground text-base leading-relaxed sm:text-lg">
                {t("catalog.subtitle")}
              </p>

              <div className="relative pt-2">
                <Search
                  className="text-muted-foreground pointer-events-none absolute start-4 top-1/2 size-5 translate-y-0.5"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("catalog.search")}
                  aria-label={t("catalog.search")}
                  className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/40 h-14 w-full rounded-2xl border ps-12 pe-11 text-sm shadow-[0_12px_35px_-24px_rgba(15,23,42,0.45)] outline-none transition-all focus-visible:ring-4"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={t("catalog.clearSearch")}
                    className="text-muted-foreground hover:text-foreground absolute end-3 top-1/2 -translate-y-1/2 p-1.5 transition-colors"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <div className="hidden grid-cols-2 gap-3 lg:grid">
              <CatalogStat
                icon={<BookOpen className="size-5" aria-hidden />}
                value={
                  courses === null ? "—" : formatNumber(all.length, locale)
                }
                label={t("catalog.courseCountLabel")}
              />
              <CatalogStat
                icon={<PlayCircle className="size-5" aria-hidden />}
                value={
                  courses === null ? "—" : formatNumber(totalLessons, locale)
                }
                label={t("catalog.lessonCountLabel")}
              />
            </div>
          </div>
        </Container>
      </section>

      {/* Pick up where you left off — the first thing a returning student looks for. */}
      {learner && mine.length > 0 && (
        <div className="bg-muted/40 border-b">
          <Container className="py-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold tracking-wide uppercase">
                {t("catalog.continueLearning")}
              </h2>
              <Link
                href={`/learn/${academy}/me`}
                className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
              >
                {t("nav.myLearning")}
                <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
              </Link>
            </div>
            <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
              {mine.slice(0, 8).map((course) => (
                <ResumeTile key={course.id} course={course} academy={academy} />
              ))}
            </div>
          </Container>
        </div>
      )}

      <Container className="py-6 sm:py-10">
        <div className="grid gap-7 lg:grid-cols-[260px_1fr]">
          <aside className="hidden lg:block">
            <div className="bg-card sticky top-24 space-y-6 rounded-2xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="inline-flex items-center gap-2 text-sm font-bold">
                  <SlidersHorizontal className="size-4" aria-hidden />
                  {t("catalog.filters")}
                </h2>
                {activeFilters > 0 && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-primary text-xs font-semibold hover:underline"
                  >
                    {t("catalog.clearAll")}
                  </button>
                )}
              </div>
              {facets}
            </div>
          </aside>

          <div className="min-w-0">
            {/* Toolbar — result count on one side, how-to-look controls on the other. */}
            <div className="bg-card mb-5 flex flex-wrap items-center gap-3 rounded-2xl border p-2.5 ps-4 shadow-sm">
              <p className="text-muted-foreground text-sm">
                {courses === null
                  ? t("catalog.loading")
                  : t("catalog.resultCount", { count: visible.length })}
              </p>

              <div className="ms-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  className="border-input hover:border-primary/50 inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors lg:hidden"
                >
                  <SlidersHorizontal className="size-4" aria-hidden />
                  {t("catalog.filters")}
                  {activeFilters > 0 && (
                    <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[10px] font-bold">
                      {activeFilters}
                    </span>
                  )}
                </button>

                <label className="sr-only" htmlFor="catalog-sort">
                  {t("catalog.sort")}
                </label>
                <select
                  id="catalog-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="border-input bg-background focus-visible:border-ring h-10 rounded-xl border px-3 text-sm font-semibold outline-none"
                >
                  {(
                    [
                      "newest",
                      "popular",
                      "longest",
                      "shortest",
                      "priceLow",
                      "priceHigh",
                      "az",
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {t(`catalog.sortBy.${value}`)}
                    </option>
                  ))}
                </select>

                <div className="bg-muted/70 hidden items-center gap-0.5 rounded-xl p-1 sm:flex">
                  {(
                    [
                      {
                        value: "grid",
                        icon: LayoutGrid,
                        label: t("catalog.gridView"),
                      },
                      {
                        value: "list",
                        icon: Rows3,
                        label: t("catalog.listView"),
                      },
                    ] as const
                  ).map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setView(value)}
                      aria-pressed={view === value}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "rounded-lg p-2 transition-colors",
                        view === value
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filtersOpen && (
              <div className="bg-card mb-5 space-y-6 rounded-2xl border p-5 lg:hidden">
                {facets}
                {activeFilters > 0 && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-primary text-xs font-semibold hover:underline"
                  >
                    {t("catalog.clearAll")}
                  </button>
                )}
              </div>
            )}

            {activeFilters > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {price !== "all" && (
                  <FilterChip
                    label={t(
                      `catalog.price${price === "free" ? "Free" : "Paid"}`,
                    )}
                    onClear={() => setPrice("all")}
                  />
                )}
                {length !== "any" && (
                  <FilterChip
                    label={t(`catalog.length.${length}`)}
                    onClear={() => setLength("any")}
                  />
                )}
                {mineOnly && (
                  <FilterChip
                    label={t("catalog.tabMine")}
                    onClear={() => setMineOnly(false)}
                  />
                )}
                {level !== "" && (
                  <FilterChip
                    label={t(`catalog.level.${level}`)}
                    onClear={() => setLevel("")}
                  />
                )}
                {category !== "" && (
                  <FilterChip label={category} onClear={() => setCategory("")} />
                )}
                {previewOnly && (
                  <FilterChip
                    label={t("catalog.hasPreview")}
                    onClear={() => setPreviewOnly(false)}
                  />
                )}
              </div>
            )}

            {failed ? (
              <p className="text-muted-foreground py-16 text-center text-sm">
                {t("errors.generic")}
              </p>
            ) : courses === null ? (
              view === "list" ? (
                <CourseListSkeleton />
              ) : (
                <CourseGridSkeleton />
              )
            ) : visible.length === 0 ? (
              // Two different nothings: "your filters exclude everything" is a mistake to undo,
              // "this shop has published nothing yet" is a fact to state calmly.
              <div className="rounded-2xl border border-dashed px-6 py-20 text-center">
                <BookOpen
                  className="text-muted-foreground/40 mx-auto mb-4 size-10"
                  aria-hidden
                />
                {filtering ? (
                  <>
                    <p className="font-semibold">{t("catalog.noMatchesTitle")}</p>
                    <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
                      {t("catalog.noMatches")}
                    </p>
                    <CtaButton
                      variant="outline"
                      className="mt-6"
                      onClick={clearAll}
                    >
                      {t("catalog.clearAll")}
                    </CtaButton>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">{t("catalog.emptyTitle")}</p>
                    <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
                      {t("catalog.emptyHint")}
                    </p>
                    {commerce.codes && (
                      <CtaButton
                        variant="outline"
                        className="mt-6"
                        onClick={openRedeem}
                      >
                        <Ticket className="size-4" aria-hidden />
                        {t("redeem.cta")}
                      </CtaButton>
                    )}
                  </>
                )}
              </div>
            ) : view === "list" ? (
              <CourseList courses={visible} />
            ) : (
              <CourseGrid
                courses={visible}
                className="sm:grid-cols-2 xl:grid-cols-3"
              />
            )}

            {courses !== null && visible.length > 0 && (
              <p className="text-muted-foreground mt-8 text-center text-xs">
                {t("catalog.totalLine", {
                  courses: formatNumber(all.length, locale),
                  lessons: formatNumber(
                    all.reduce((sum, c) => sum + c.lesson_count, 0),
                    locale,
                  ),
                })}
              </p>
            )}
          </div>
        </div>
      </Container>

      <CtaBand onPrimary={commerce.codes ? openRedeem : undefined} />
    </>
  );
}

function CatalogStat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="bg-card/90 rounded-2xl border p-5 shadow-[0_16px_45px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
      <span className="text-primary mb-5 flex size-10 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
        {icon}
      </span>
      <p className="text-3xl font-extrabold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="text-muted-foreground mt-1 text-xs font-medium">{label}</p>
    </div>
  );
}

/** A compact "resume" tile for the continue-learning rail. */
function ResumeTile({
  course,
  academy,
}: {
  course: LearnCourseCard;
  academy: string;
}) {
  const t = useTranslations("learn");
  const duration = useFormatDuration()(course.duration_seconds);

  return (
    <Link
      href={`/learn/${academy}/watch/${course.slug}`}
      className="group bg-card hover:border-primary/40 flex w-64 shrink-0 snap-start items-center gap-3 rounded-2xl border p-3 transition-all hover:shadow-md"
    >
      <CourseThumb
        src={course.cover_image_path}
        className="aspect-square size-14 shrink-0 rounded-xl"
        iconClassName="size-5"
      />
      <div className="min-w-0 flex-1">
        <p className="group-hover:text-primary truncate text-sm font-semibold transition-colors">
          {course.title}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {duration ?? t("catalog.lessons", { count: course.lesson_count })}
        </p>
      </div>
      <PlayCircle className="text-primary size-5 shrink-0" aria-hidden />
    </Link>
  );
}

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Pill className="text-primary bg-[var(--brand-soft)]">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="hover:opacity-70"
        aria-label={label}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </Pill>
  );
}

/** The facet column — rendered twice (sticky sidebar on desktop, disclosure on mobile). */
function FacetPanel({
  price,
  setPrice,
  length,
  setLength,
  mineOnly,
  setMineOnly,
  previewOnly,
  setPreviewOnly,
  showPrice,
  showLength,
  showPreview,
  showMine,
  counts,
  level,
  setLevel,
  levels,
  category,
  setCategory,
  categories,
}: {
  price: Price;
  setPrice: (v: Price) => void;
  length: Length;
  setLength: (v: Length) => void;
  mineOnly: boolean;
  setMineOnly: (v: boolean) => void;
  previewOnly: boolean;
  setPreviewOnly: (v: boolean) => void;
  showPrice: boolean;
  showLength: boolean;
  showPreview: boolean;
  showMine: boolean;
  counts: { mine: number };
  level: Level;
  setLevel: (v: Level) => void;
  levels: readonly NonNullable<LearnCourseCard["level"]>[];
  category: string;
  setCategory: (v: string) => void;
  categories: string[];
}) {
  const t = useTranslations("learn");

  return (
    <div className="space-y-6">
      {showMine && (
        <FacetGroup title={t("catalog.access")}>
          <FacetToggle
            checked={mineOnly}
            onChange={() => setMineOnly(!mineOnly)}
            label={t("catalog.tabMine")}
            hint={String(counts.mine)}
          />
        </FacetGroup>
      )}

      {showPrice && (
        <FacetGroup title={t("catalog.price")}>
          {(["all", "free", "paid"] as const).map((value) => (
            <FacetRadio
              key={value}
              checked={price === value}
              onChange={() => setPrice(value)}
              label={t(
                value === "all"
                  ? "catalog.priceAll"
                  : value === "free"
                    ? "catalog.priceFree"
                    : "catalog.pricePaid",
              )}
            />
          ))}
        </FacetGroup>
      )}

      {showLength && (
        <FacetGroup title={t("catalog.duration")}>
          {(["any", "short", "medium", "long"] as const).map((value) => (
            <FacetRadio
              key={value}
              checked={length === value}
              onChange={() => setLength(value)}
              label={t(`catalog.length.${value}`)}
            />
          ))}
        </FacetGroup>
      )}

      {/* Both derived from the rows: a catalogue where every course is "Beginner" gets no level
          facet, because a filter with one option filters nothing. */}
      {levels.length > 1 && (
        <FacetGroup title={t("catalog.levelLabel")}>
          <FacetRadio
            checked={level === ""}
            onChange={() => setLevel("")}
            label={t("catalog.levelAny")}
          />
          {levels.map((value) => (
            <FacetRadio
              key={value}
              checked={level === value}
              onChange={() => setLevel(value)}
              label={t(`catalog.level.${value}`)}
            />
          ))}
        </FacetGroup>
      )}

      {categories.length > 1 && (
        <FacetGroup title={t("catalog.categoryLabel")}>
          <FacetRadio
            checked={category === ""}
            onChange={() => setCategory("")}
            label={t("catalog.categoryAny")}
          />
          {categories.map((value) => (
            <FacetRadio
              key={value}
              checked={category === value}
              onChange={() => setCategory(value)}
              label={value}
            />
          ))}
        </FacetGroup>
      )}

      {showPreview && (
        <FacetGroup title={t("catalog.content")}>
          <FacetToggle
            checked={previewOnly}
            onChange={() => setPreviewOnly(!previewOnly)}
            label={t("catalog.hasPreview")}
          />
        </FacetGroup>
      )}
    </div>
  );
}

function FacetGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function FacetRadio({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm transition-colors",
        checked
          ? "text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          checked ? "border-primary" : "border-muted-foreground/40",
        )}
      >
        {checked && <span className="bg-primary size-2 rounded-full" />}
      </span>
      {label}
    </button>
  );
}

function FacetToggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm transition-colors",
        checked
          ? "text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
          checked ? "border-primary bg-primary" : "border-muted-foreground/40",
        )}
      >
        {checked && (
          <Check className="text-primary-foreground size-3" aria-hidden />
        )}
      </span>
      <span className="flex-1">{label}</span>
      {hint && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {hint}
        </span>
      )}
    </button>
  );
}
