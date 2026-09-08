"use client";

import {
  ArrowUpRight,
  Award,
  BadgeCheck,
  Book,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Download,
  GraduationCap,
  Headphones,
  Infinity as InfinityIcon,
  Loader2,
  Play,
  Quote,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Users,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ComponentProps, type ReactNode } from "react";
import { useLearn } from "@/components/learn/context";
import {
  splitExpertise,
  useClosingCtaLabel,
  useDefaultFaq,
} from "@/components/learn/storefront";
import { cn } from "@/lib/utils";

const DEFAULT_HERO_IMAGE = "/learn/hero-learning.webp";
const DEFAULT_ABOUT_IMAGE = "/learn/about-learning.webp";

/**
 * The section kit of the LMS public site (docs/lms/09) — the half that is IDENTICAL for every
 * client. Each section takes its words from the academy's site profile and, when a field is blank,
 * from the template's own translations, so an unconfigured site is still complete and bilingual
 * rather than full of holes.
 *
 * Nothing here reaches for data on its own: sections are pure, which is what lets the same
 * `FeatureGrid` appear on the home page and the about page without either knowing about the other.
 */

// ── primitives ────────────────────────────────────────────────────────────────

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  video: Video,
  award: Award,
  clock: Clock,
  infinity: InfinityIcon,
  smartphone: Smartphone,
  users: Users,
  shield: Shield,
  book: Book,
  headphones: Headphones,
  download: Download,
  check: Check,
};

export function iconFor(name: string | undefined): LucideIcon {
  return ICONS[name ?? ""] ?? Sparkles;
}

/** Page-width container — one place decides how wide the whole site reads. */
export function Container({
  className,
  id,
  children,
}: {
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6", className)}>
      {children}
    </div>
  );
}

/**
 * Section background tones — the "different background per section" rhythm. Each is a distinct but
 * restrained treatment so the page reads as one designed system rather than a patchwork:
 *  - plain    the page surface (nothing added)
 *  - muted    a soft neutral panel
 *  - tint     a brand-tinted wash + a faint corner glow
 *  - pattern  a masked dot-grid over a neutral panel
 *  - gradient a diagonal brand→neutral wash
 */
export type SectionTone = "plain" | "muted" | "tint" | "pattern" | "gradient";

/** Per-section background + divider controls, shared by every section wrapper so the home page can
 *  set each section's rhythm from one place. */
export interface SectionChrome {
  tone?: SectionTone;
  divider?: boolean;
}

export function Section({
  className,
  tone = "plain",
  muted,
  divider = false,
  children,
  id,
}: {
  className?: string;
  tone?: SectionTone;
  /** @deprecated back-compat alias for tone="muted". */
  muted?: boolean;
  /** Render a modern divider straddling this section's top edge. */
  divider?: boolean;
  children: ReactNode;
  id?: string;
}) {
  const resolved: SectionTone = muted ? "muted" : tone;

  return (
    <section
      id={id}
      className={cn(
        // One spacing scale for the whole site. The mobile step is deliberately much smaller than
        // the desktop one: at 390px a 4rem gap between two sections is most of a screen of nothing.
        "relative isolate py-12 sm:py-16 lg:py-20",
        resolved === "muted" && "bg-muted/40",
      )}
    >
      <SectionTexture tone={resolved} />
      {divider && <SectionDivider />}
      <Container className={className}>{children}</Container>
    </section>
  );
}

/** The decorative backdrop for a section tone. Sits behind the content (isolated stacking context). */
function SectionTexture({ tone }: { tone: SectionTone }) {
  if (tone === "tint") {
    return (
      <>
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, var(--brand-soft) 0%, transparent 55%)",
          }}
        />
        <div className="pointer-events-none absolute -top-20 -end-16 -z-10 size-72 rounded-full bg-[var(--brand-soft)] blur-3xl" />
      </>
    );
  }
  if (tone === "pattern") {
    return (
      <>
        <div className="bg-muted/30 pointer-events-none absolute inset-0 -z-10" />
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "22px 22px",
            maskImage:
              "linear-gradient(180deg, transparent, black 18%, black 82%, transparent)",
            WebkitMaskImage:
              "linear-gradient(180deg, transparent, black 18%, black 82%, transparent)",
          }}
        />
      </>
    );
  }
  if (tone === "gradient") {
    return (
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(120deg, var(--brand-soft) 0%, transparent 42%, transparent 58%, var(--muted) 100%)",
        }}
      />
    );
  }
  return null; // plain / muted need no overlay
}

/**
 * A modern section splitter — a soft gradient rule with a small floating brand badge straddling the
 * boundary. Pulled up over the section's top edge so it reads as a divider between two sections
 * regardless of their background colours. Purely decorative.
 */
export function SectionDivider() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 items-center justify-center"
      aria-hidden
    >
      <span className="h-px w-20 bg-gradient-to-r from-transparent to-[var(--brand-line)] sm:w-36" />
      <span className="bg-card mx-2.5 flex size-9 items-center justify-center rounded-xl border shadow-sm">
        <Sparkles className="text-primary size-4" />
      </span>
      <span className="h-px w-20 bg-gradient-to-l from-transparent to-[var(--brand-line)] sm:w-36" />
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "mb-8 space-y-3 sm:mb-10",
        align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl",
      )}
    >
      {eyebrow && (
        <span className="text-primary inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold tracking-wide uppercase">
          <Sparkles className="size-3.5" aria-hidden />
          {eyebrow}
        </span>
      )}
      <h2
        dir="auto"
        className="text-2xl font-bold tracking-tight text-balance sm:text-3xl lg:text-4xl"
      >
        {title}
      </h2>
      {subtitle && (
        <p dir="auto" className="text-muted-foreground text-base leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/**
 * The site's primary button. An `href` renders a link, otherwise a button.
 *
 * Two sizes and four surfaces, and that is the whole button system — every call to action on the
 * storefront comes through here so heights, radii, focus rings and disabled states cannot drift
 * apart page by page. The hover is a 1px lift rather than a scale: scaling type resamples it, and
 * on a card grid the wobble reads as jitter.
 */
export function CtaButton({
  href,
  onClick,
  variant = "solid",
  size = "lg",
  className,
  disabled,
  loading,
  type = "button",
  children,
  ...rest
}: {
  href?: string;
  onClick?: () => void;
  variant?: "solid" | "outline" | "onDark" | "ghost";
  size?: "lg" | "md";
  className?: string;
  /** Button form only — an in-flight action (enrolling, submitting) that must not fire twice. */
  disabled?: boolean;
  /** Same as disabled, plus a spinner: the action IS running, rather than being unavailable. */
  loading?: boolean;
  type?: "button" | "submit";
  children: ReactNode;
} & Pick<ComponentProps<"button">, "aria-label">) {
  const inert = disabled === true || loading === true;
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[transform,background-color,border-color,color,box-shadow] duration-200",
    "focus-visible:ring-ring/60 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
    "motion-safe:hover:-translate-y-px",
    size === "lg" ? "h-12 px-6 text-sm" : "h-10 px-4 text-sm",
    variant === "solid" &&
      "bg-primary text-primary-foreground shadow-md shadow-[var(--brand-soft)] hover:brightness-[1.06]",
    variant === "outline" &&
      "border-border hover:border-primary/60 hover:text-primary border bg-transparent",
    variant === "onDark" &&
      "border border-white/25 text-white hover:bg-white/12 focus-visible:ring-white/70 focus-visible:ring-offset-transparent",
    variant === "ghost" && "text-primary hover:bg-[var(--brand-soft)]",
    inert && "pointer-events-none opacity-60",
    className,
  );

  const body = (
    <>
      {loading === true && (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      )}
      {children}
    </>
  );

  if (href) {
    const external = href.startsWith("http");
    return external ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        {...rest}
      >
        {body}
      </a>
    ) : (
      <Link href={href} className={classes} {...rest}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={inert}
      className={classes}
      {...rest}
    >
      {body}
    </button>
  );
}

// ── hero ──────────────────────────────────────────────────────────────────────

const HERO_CSS = `
@keyframes heroOrb { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(28px,-24px,0) scale(1.12); } }
@keyframes heroOrb2 { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(-30px,20px,0) scale(1.15); } }
@keyframes heroFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@keyframes heroRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.hero-orb-1 { animation: heroOrb 15s ease-in-out infinite; }
.hero-orb-2 { animation: heroOrb2 18s ease-in-out infinite; }
.hero-rise { opacity: 0; animation: heroRise 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }
/* The preview card only drifts where it sits BESIDE the copy. On a phone it is stacked in the
   reading flow, and a card that bobs while you scroll past it is just noise. */
@media (min-width: 1024px) {
  .hero-float { animation: heroFloat 6s ease-in-out infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-orb-1, .hero-orb-2, .hero-float { animation: none; }
  .hero-rise { opacity: 1; animation: none; }
}
`;

/**
 * The site's opening statement — the single most-seen surface, so it is built to read like a real
 * course platform: an animated backdrop, live social proof (REAL student / course / certificate
 * counts, never a fabricated rating), and a polished course-preview visual. Every word, the badges
 * and the primary CTA still come from the client's profile; `hero_style` picks the backdrop (brand
 * gradient / full-bleed photo / plain light surface).
 */
export function Hero({
  actions,
  /** A real course to put in the preview card — the newest one, once the catalogue has loaded. */
  course,
  /** Below the buttons: the quiet "have a code?" link on a site where codes are not the headline. */
  footnote,
}: {
  actions?: ReactNode;
  course?: HeroCourse | null;
  footnote?: ReactNode;
}) {
  const t = useTranslations("learn");
  const { site, siteName } = useLearn();
  const { hero, brand } = site;

  const style =
    brand.hero_style === "image" && hero.image_url ? "image" : brand.hero_style;
  const dark = style !== "plain";
  // The full-bleed photo IS the backdrop, so it carries no side visual; the other styles do.
  const withVisual = style !== "image";

  const title = hero.title || t("hero.title", { name: siteName });
  const subtitle = hero.subtitle || t("hero.subtitle");
  const eyebrow = hero.eyebrow || t("hero.eyebrow");
  const visualImage = hero.image_url || DEFAULT_HERO_IMAGE;
  const badges =
    hero.badges.length > 0
      ? hero.badges
      : (t.raw("defaults.badges") as string[]);

  return (
    <section id="site-hero" className="relative isolate overflow-hidden">
      <style>{HERO_CSS}</style>
      <HeroBackdrop style={style} image={hero.image_url} />

      {/* The mobile step is a third of the desktop one on purpose. The old hero padded 5rem top AND
          bottom on a 390px screen and hid its only visual, which left a screen-and-a-half of empty
          brand colour between the buttons and the first course. */}
      <Container className="relative py-10 sm:py-16 lg:py-24">
        <div
          className={cn(
            "grid items-center gap-8 sm:gap-10",
            withVisual && "lg:grid-cols-[1.05fr_0.95fr] lg:gap-16",
          )}
        >
          <div className={cn("max-w-2xl", dark && "text-white")}>
            {eyebrow && (
              <span
                className={cn(
                  "hero-rise inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold",
                  dark
                    ? "border border-white/15 bg-white/10 text-white/90 backdrop-blur"
                    : "text-primary border border-[var(--brand-line)] bg-[var(--brand-soft)]",
                )}
              >
                <span className="relative flex size-2">
                  <span
                    className={cn(
                      "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                      dark ? "bg-white" : "bg-primary",
                    )}
                  />
                  <span
                    className={cn(
                      "relative inline-flex size-2 rounded-full",
                      dark ? "bg-white" : "bg-primary",
                    )}
                  />
                </span>
                {eyebrow}
              </span>
            )}

            <h1
              dir="auto"
              className="hero-rise mt-5 text-[2rem] leading-[1.15] font-bold tracking-tight text-balance sm:mt-6 sm:text-5xl lg:text-[3.5rem] lg:leading-[1.05]"
              style={{ animationDelay: "0.05s" }}
            >
              {title}
            </h1>

            <p
              className={cn(
                "hero-rise mt-4 max-w-xl leading-relaxed text-pretty sm:mt-5 sm:text-lg",
                dark ? "text-white/75" : "text-muted-foreground",
              )}
              style={{ animationDelay: "0.12s" }}
            >
              {subtitle}
            </p>

            <div
              className="hero-rise mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row"
              style={{ animationDelay: "0.19s" }}
            >
              {actions}
            </div>

            {footnote && (
              <div
                className={cn(
                  "hero-rise mt-4 text-sm",
                  dark ? "text-white/70" : "text-muted-foreground",
                )}
                style={{ animationDelay: "0.26s" }}
              >
                {footnote}
              </div>
            )}

            {badges.length > 0 && (
              <div
                className="hero-rise mt-6 flex flex-wrap gap-2 border-t pt-5 sm:mt-7 sm:pt-6"
                style={{
                  animationDelay: "0.33s",
                  borderColor: dark
                    ? "rgba(255,255,255,0.12)"
                    : "var(--border)",
                }}
              >
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                      dark
                        ? "border border-white/12 bg-white/[0.06] text-white/75"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Check
                      className={cn(
                        "size-3 shrink-0",
                        dark ? "text-white/80" : "text-primary",
                      )}
                      aria-hidden
                    />
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>

          {withVisual && (
            <HeroVisual image={visualImage} course={course ?? null} />
          )}
        </div>
      </Container>

      {/* Soften the dark band into the light page below. The stats band (StatsBand) is lifted above
          this with its own stacking context, so it sits ON TOP of the fade rather than behind it. */}
      {dark && (
        <div className="to-background pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent" />
      )}
    </section>
  );
}

/** The hero's layered backdrop: full-bleed photo, animated brand gradient, or a soft light wash. */
function HeroBackdrop({ style, image }: { style: string; image: string }) {
  if (style === "image") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt=""
          className="absolute inset-0 -z-20 size-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-black/80 via-black/65 to-black/80" />
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />
      </>
    );
  }

  if (style === "gradient") {
    return (
      <>
        <div
          className="absolute inset-0 -z-20"
          style={{
            background:
              "linear-gradient(150deg, oklch(0.17 0.02 255) 0%, oklch(0.21 0.035 235) 42%, var(--brand-deep) 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.055]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />
        <div
          className="hero-orb-1 pointer-events-none absolute -top-44 -end-40 -z-10 size-[560px] rounded-full blur-[140px]"
          style={{ background: "var(--brand)", opacity: 0.4 }}
        />
        <div className="hero-orb-2 pointer-events-none absolute -bottom-52 -start-32 -z-10 size-[460px] rounded-full bg-indigo-500/25 blur-[130px]" />
      </>
    );
  }

  // plain — a light, brand-tinted wash so the light hero still has depth.
  return (
    <>
      <div
        className="absolute inset-0 -z-20"
        style={{
          background:
            "linear-gradient(160deg, var(--brand-soft) 0%, transparent 55%)",
        }}
      />
      <div className="hero-orb-1 pointer-events-none absolute -top-40 -end-40 -z-10 size-[460px] rounded-full bg-[var(--brand-soft)] blur-[120px]" />
    </>
  );
}



/** The one course the hero previews — whatever the catalogue's newest published course is. */
export interface HeroCourse {
  title: string;
  slug: string;
  cover_image_path: string | null;
  lesson_count: number;
  duration_seconds?: number;
  preview_count?: number;
}

/**
 * The course-preview visual beside the copy — and, on a phone, UNDER it.
 *
 * It used to be `hidden lg:block`, which is where the storefront's worst mobile bug lived: the
 * column vanished but the hero kept its desktop padding, so a phone got a screenful of empty brand
 * colour between the buttons and the first course. It now renders at every width, compact on small
 * screens, because the answer to "there is a hole here" is content, not more padding.
 *
 * What it shows, in order of how true it is: the newest REAL course (cover, title, lesson count,
 * runtime), else the client's own hero image, else a designed mock. The mock never claims to be a
 * course — no invented title, rating or student count — it is visibly a placeholder shape.
 */
function HeroVisual({
  image,
  course,
}: {
  image: string;
  course: HeroCourse | null;
}) {
  const t = useTranslations("learn");
  const { academy, siteName } = useLearn();
  const cover = course?.cover_image_path || image;

  const card = (
    <div className="bg-card text-foreground overflow-hidden rounded-3xl border shadow-2xl ring-1 ring-black/5">
      {/* Media / play. The ratio is fixed, so swapping the mock for a real cover after the
          catalogue loads cannot move the page. */}
      <div className="relative aspect-video overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={course ? t("catalog.coverAlt", { title: course.title }) : ""}
            className="absolute inset-0 size-full object-cover"
            fetchPriority="high"
          />
        ) : (
          <div
            className="size-full"
            style={{
              background:
                "linear-gradient(140deg, var(--brand) 0%, color-mix(in oklab, var(--brand) 55%, black) 100%)",
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/95 shadow-xl sm:size-16">
            <Play
              className="text-primary ms-0.5 size-5 fill-current sm:size-6"
              aria-hidden
            />
          </span>
        </span>
        <span className="text-primary absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold shadow sm:start-4 sm:top-4">
          <Sparkles className="size-3.5" aria-hidden />
          {t("hero.card.badge")}
        </span>
      </div>

      <div className="space-y-3.5 p-4 sm:space-y-4 sm:p-5">
        <div className="min-w-0">
          <p dir="auto" className="line-clamp-2 leading-snug font-bold break-words">
            {course?.title ?? siteName}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {course
              ? t("catalog.lessons", { count: course.lesson_count })
              : t("hero.card.subtitle")}
          </p>
        </div>

        {/* A real course shows its own facts; with none loaded yet the rows are plainly a
            placeholder shape rather than invented lesson titles. */}
        <ul className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="bg-[var(--brand-soft)] text-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
                {i === 0 ? (
                  <Play className="size-3 fill-current" aria-hidden />
                ) : (
                  <BookOpen className="size-3.5" aria-hidden />
                )}
              </span>
              <span
                className="bg-muted h-2.5 rounded-full"
                style={{ width: `${78 - i * 16}%` }}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="relative">
      {/* Depth: a brand glow behind the card. Desktop only — on a phone it just costs a repaint. */}
      <div
        className="pointer-events-none absolute -inset-6 -z-10 hidden rounded-[2rem] bg-[var(--brand-soft)] blur-2xl lg:block"
        aria-hidden
      />
      <div className="mx-auto max-w-md lg:mx-0 lg:max-w-none">
        <div className="hero-float">
          {course ? (
            <Link
              href={`/learn/${academy}/c/${course.slug}`}
              className="focus-visible:ring-ring focus-visible:ring-offset-background block rounded-3xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {card}
            </Link>
          ) : (
            card
          )}
        </div>
      </div>
    </div>
  );
}

// ── stats ─────────────────────────────────────────────────────────────────────

/**
 * The numbers band — the client's OWN figures ("15 years teaching"), written in the site editor.
 * Renders nothing until they write some, so a site nobody has configured shows no band at all.
 */
export function StatsBand() {
  const { site } = useLearn();
  if (!site.stats.show) return null;

  // ONLY the client's own numbers. There used to be a fallback to the live catalogue counters
  // (courses / lessons / learners / certificates), but a young academy then advertised "1 learner"
  // in 3xl type — the band undersold exactly the sites that could least afford it. A client who
  // wants numbers here writes ones worth showing ("15 years teaching") in the site editor.
  const items = site.stats.items;
  if (items.length === 0) return null;

  // `relative z-20` is load-bearing: -mt-12 pulls this card up into the hero, and the hero ends with
  // a full-width fade overlay that would otherwise paint over the card's top row.
  return (
    <Container id="site-stats" className="relative z-20 -mt-12 pb-4">
      <dl className="bg-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl border shadow-xl lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="bg-card px-6 py-7 text-center">
            <dt className="text-primary text-3xl font-bold tabular-nums">
              {item.value}
            </dt>
            <dd className="text-muted-foreground mt-1 text-sm">{item.label}</dd>
          </div>
        ))}
      </dl>
    </Container>
  );
}

// ── why us ────────────────────────────────────────────────────────────────────

export function FeatureGrid({ tone, divider }: SectionChrome = {}) {
  const t = useTranslations("learn");
  const { site } = useLearn();
  if (!site.features.show) return null;

  const items =
    site.features.items.length > 0
      ? site.features.items
      : (t.raw("defaults.features.items") as {
          icon: string;
          title: string;
          body: string;
        }[]);
  if (items.length === 0) return null;

  return (
    <Section id="site-features" tone={tone} divider={divider}>
      <SectionHeading
        title={site.features.heading || t("defaults.features.heading")}
        subtitle={site.features.subheading || t("defaults.features.subheading")}
      />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = iconFor(item.icon);
          return (
            <div
              key={item.title}
              className="group bg-card hover:border-primary/40 rounded-2xl border p-6 transition-all hover:shadow-lg"
            >
              <span className="text-primary mb-4 flex size-11 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 dir="auto" className="mb-1.5 font-semibold">
                {item.title}
              </h3>
              <p
                dir="auto"
                className="text-muted-foreground text-sm leading-relaxed"
              >
                {item.body}
              </p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── how it works ──────────────────────────────────────────────────────────────

export function StepsRail({ tone = "muted", divider }: SectionChrome = {}) {
  const t = useTranslations("learn");
  const { site } = useLearn();
  if (!site.steps.show) return null;

  const items =
    site.steps.items.length > 0
      ? site.steps.items
      : (t.raw("defaults.steps.items") as { title: string; body: string }[]);
  if (items.length === 0) return null;

  return (
    <Section id="site-steps" tone={tone} divider={divider}>
      <SectionHeading
        title={site.steps.heading || t("defaults.steps.heading")}
      />
      <ol className="grid gap-6 md:grid-cols-3">
        {items.map((item, i) => (
          <li key={item.title} className="relative">
            <span className="text-primary mb-4 flex size-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-lg font-bold tabular-nums">
              {i + 1}
            </span>
            <h3 dir="auto" className="mb-1.5 font-semibold">
              {item.title}
            </h3>
            <p dir="auto" className="text-muted-foreground text-sm leading-relaxed">
              {item.body}
            </p>
            {i < items.length - 1 && (
              <span
                className="absolute top-6 start-[3.75rem] hidden h-px w-[calc(100%-3rem)] md:block"
                style={{ background: "var(--brand-line)" }}
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ── about ─────────────────────────────────────────────────────────────────────

export function AboutSplit({
  tone,
  divider,
  /**
   * The About PAGE's version: adds the client's mission and teaching approach under the story, so
   * that page says something the home page does not. The home page passes nothing and keeps the
   * short split — the two must not print the same words twice (docs/lms/09 §6).
   */
  full = false,
}: SectionChrome & { full?: boolean } = {}) {
  const t = useTranslations("learn");
  const { site, siteName } = useLearn();
  if (!site.about.show) return null;

  const body = site.about.body || t("defaults.about.body", { name: siteName });
  const image = site.about.image_url || DEFAULT_ABOUT_IMAGE;
  // Blank blocks are hidden rather than filled with generic filler — an About page padded out with
  // copy nobody wrote is exactly the "generic LMS demo" smell this template exists to avoid.
  const extra = full
    ? (
        [
          ["missionHeading", site.about.mission],
          ["approachHeading", site.about.approach],
        ] as const
      ).filter(([, value]) => (value ?? "").trim() !== "")
    : [];

  return (
    <Section id="site-about" tone={tone} divider={divider}>
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="space-y-5">
          <SectionHeading
            align="start"
            title={
              // On the About PAGE the client's heading is already the page title, so this block
              // names what it actually is — the story — instead of printing the same words twice.
              full
                ? t("about.storyHeading")
                : site.about.heading ||
                  t("defaults.about.heading", { name: siteName })
            }
          />
          <p
            dir="auto"
            className="text-muted-foreground -mt-6 leading-relaxed whitespace-pre-wrap"
          >
            {body}
          </p>
          {site.about.points.length > 0 && (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {site.about.points.map((point) => (
                <li key={point} className="flex items-start gap-2 text-sm">
                  <BadgeCheck
                    className="text-primary mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                  {point}
                </li>
              ))}
            </ul>
          )}

          {extra.map(([key, value]) => (
            <div key={key} className="border-s-2 ps-4" style={{ borderColor: "var(--brand-line)" }}>
              <h3 className="font-semibold">{t(`about.${key}`)}</h3>
              <p className="text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-wrap">
                {value}
              </p>
            </div>
          ))}
        </div>

        <div className="relative">
          <div
            className="absolute -inset-4 -z-10 rounded-[2.25rem] bg-[var(--brand-soft)] blur-2xl"
            aria-hidden
          />
          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white p-1.5 shadow-2xl shadow-black/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt=""
              className="aspect-4/3 w-full rounded-[1.65rem] object-cover"
            />
            <div
              className="pointer-events-none absolute inset-1.5 rounded-[1.65rem] bg-gradient-to-t from-black/20 via-transparent to-white/10"
              aria-hidden
            />
          </div>
          <span
            className="absolute -bottom-5 -start-5 flex size-20 items-center justify-center rounded-3xl border border-white/70 bg-white/90 shadow-xl backdrop-blur"
            aria-hidden
          >
            <GraduationCap className="text-primary size-8" />
          </span>
        </div>
      </div>
    </Section>
  );
}

// ── instructors ───────────────────────────────────────────────────────────────

/** Renders nothing when the client listed no one — a site never invents teachers. */
export function InstructorGrid({ tone, divider }: SectionChrome = {}) {
  const t = useTranslations("learn");
  const { site } = useLearn();
  if (!site.instructors.show || site.instructors.items.length === 0)
    return null;

  return (
    <Section id="site-instructors" tone={tone} divider={divider}>
      <SectionHeading
        title={site.instructors.heading || t("defaults.instructors.heading")}
      />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {site.instructors.items.map((person) => (
          <div
            key={person.name}
            className="bg-card rounded-2xl border p-6 text-center"
          >
            {person.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={person.photo_url}
                alt={person.name}
                loading="lazy"
                className="mx-auto mb-4 size-20 rounded-full object-cover"
              />
            ) : (
              <span
                className="text-primary mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-[var(--brand-soft)] text-2xl font-bold"
                aria-hidden
              >
                {person.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <h3 dir="auto" className="font-semibold break-words">
              {person.name}
            </h3>
            {person.role && (
              <p className="text-primary text-sm font-medium break-words">
                {person.role}
              </p>
            )}
            {person.bio && (
              <p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">
                {person.bio}
              </p>
            )}
            {splitExpertise(person.expertise).length > 0 && (
              <ul className="mt-3.5 flex flex-wrap justify-center gap-1.5">
                {splitExpertise(person.expertise).map((topic) => (
                  <li
                    key={topic}
                    className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium"
                  >
                    {topic}
                  </li>
                ))}
              </ul>
            )}
            {person.link_url && (
              <a
                href={person.link_url}
                target={person.link_url.startsWith("http") ? "_blank" : undefined}
                rel={
                  person.link_url.startsWith("http")
                    ? "noopener noreferrer"
                    : undefined
                }
                className="text-primary mt-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
              >
                {t("course.instructorLink")}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── testimonials ──────────────────────────────────────────────────────────────

/** Also renders nothing when empty — fabricated reviews are not a default. */
export function TestimonialGrid({
  tone = "tint",
  divider,
}: SectionChrome = {}) {
  const t = useTranslations("learn");
  const { site } = useLearn();
  if (!site.testimonials.show || site.testimonials.items.length === 0)
    return null;

  return (
    <Section id="site-testimonials" tone={tone} divider={divider}>
      <SectionHeading
        title={site.testimonials.heading || t("defaults.testimonials.heading")}
      />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {site.testimonials.items.map((item) => (
          <figure
            key={item.quote}
            className="bg-card flex flex-col rounded-2xl border p-6"
          >
            <Quote className="text-primary/30 mb-3 size-7" aria-hidden />
            <blockquote dir="auto" className="flex-1 text-sm leading-relaxed">
              {item.quote}
            </blockquote>
            {item.rating > 0 && (
              <div
                className="mt-4 flex gap-0.5"
                aria-label={`${item.rating}/5`}
              >
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={cn(
                      "size-3.5",
                      i < item.rating
                        ? "fill-current text-amber-400"
                        : "text-muted-foreground/30",
                    )}
                    aria-hidden
                  />
                ))}
              </div>
            )}
            <figcaption className="mt-4 flex items-center gap-3 border-t pt-4">
              {item.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.photo_url}
                  alt={item.name}
                  className="size-9 rounded-full object-cover"
                />
              ) : (
                <span className="text-primary flex size-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-bold">
                  {item.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {item.name}
                </span>
                {item.role && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {item.role}
                  </span>
                )}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

export function FaqAccordion({
  limit,
  tone,
  divider,
  /** The dedicated /faq page already carries this heading as its page title. */
  hideHeading = false,
}: SectionChrome & { limit?: number; hideHeading?: boolean } = {}) {
  const t = useTranslations("learn");
  const { site } = useLearn();
  // The starter set is assembled from what this site actually offers — it never explains a checkout
  // that is switched off, or leads with access codes on a site that sells online (docs/lms/09 §8).
  const fallback = useDefaultFaq();
  const [open, setOpen] = useState<number | null>(0);
  if (!site.faq.show) return null;

  const all = site.faq.items.length > 0 ? site.faq.items : fallback;
  const items = limit ? all.slice(0, limit) : all;
  if (items.length === 0) return null;

  return (
    <Section id="site-faq" tone={tone} divider={divider}>
      {!hideHeading && (
        <SectionHeading title={site.faq.heading || t("defaults.faq.heading")} />
      )}
      <div className="mx-auto max-w-3xl space-y-3">
        {items.map((item, i) => (
          <div
            key={item.q}
            className="bg-card overflow-hidden rounded-2xl border"
          >
            <h3>
              <button
                type="button"
                aria-expanded={open === i}
                aria-controls={`faq-answer-${i}`}
                id={`faq-question-${i}`}
                onClick={() => setOpen((cur) => (cur === i ? null : i))}
                className="hover:bg-muted/50 focus-visible:ring-ring/60 flex w-full items-center gap-3 px-5 py-4 text-start font-medium transition-colors focus-visible:-outline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                <span dir="auto" className="flex-1">
                  {item.q}
                </span>
                <ChevronDown
                  className={cn(
                    "text-muted-foreground size-4 shrink-0 transition-transform",
                    open === i && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
            </h3>
            <div
              id={`faq-answer-${i}`}
              role="region"
              aria-labelledby={`faq-question-${i}`}
              hidden={open !== i}
            >
              <p
                dir="auto"
                className="text-muted-foreground border-t px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap"
              >
                {item.a}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── closing CTA ───────────────────────────────────────────────────────────────

/**
 * The site's ONE closing ask. It used to be shadowed by a second, identical block at the top of the
 * footer — the same heading and subtitle, twice, one under the other — which is why the footer no
 * longer carries a CTA panel of its own (see site-chrome.tsx).
 */
export function CtaBand({ onPrimary }: { onPrimary?: () => void }) {
  const t = useTranslations("learn");
  const { academy, site, siteName, commerce } = useLearn();
  const defaultLabel = useClosingCtaLabel();
  if (!site.cta.show) return null;

  // Where the default button goes when the client wrote no link: the catalogue on a site that sells
  // or gives something away, and the redeem dialog on a code-only site.
  const codeOnly = commerce.codes && !commerce.checkout && !commerce.free;
  const label = site.cta.button_label || defaultLabel;

  return (
    <section id="site-cta" className="relative isolate mt-16 overflow-hidden py-14 sm:mt-20 sm:py-20">
      <div
        className="absolute inset-0 -z-20"
        style={{
          background:
            "linear-gradient(155deg, oklch(0.15 0.02 250) 0%, oklch(0.19 0.03 220) 50%, var(--brand-deep) 100%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <Container className="relative text-center">
        <div className="mx-auto max-w-2xl space-y-6">
          <h2
            dir="auto"
            className="text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl"
          >
            {site.cta.title || t("defaults.cta.title", { name: siteName })}
          </h2>
          <p className="mx-auto max-w-lg text-white/65">
            {site.cta.subtitle || t("defaults.cta.subtitle")}
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            {site.cta.button_href ? (
              <CtaButton href={site.cta.button_href}>{label}</CtaButton>
            ) : codeOnly ? (
              <CtaButton onClick={onPrimary}>{label}</CtaButton>
            ) : (
              <CtaButton href={`/learn/${academy}/courses`}>{label}</CtaButton>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

// ── inner-page header ─────────────────────────────────────────────────────────

/** The compact hero every non-home page opens with, so they share one rhythm. */
export function PageHero({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(160deg, var(--brand-soft), transparent 70%)",
        }}
      />
      <Container className="py-9 sm:py-14 lg:py-16">
        <div className="max-w-2xl space-y-3">
          <h1
            dir="auto"
            className="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-muted-foreground leading-relaxed">{subtitle}</p>
          )}
          {children}
        </div>
      </Container>
    </section>
  );
}
