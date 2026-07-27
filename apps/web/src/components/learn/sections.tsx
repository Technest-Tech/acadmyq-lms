"use client";

import {
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
import { useState, type ReactNode } from "react";
import { useLearn } from "@/components/learn/context";
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
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6", className)}>
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
        "relative isolate py-16 sm:py-20",
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
        "mb-10 space-y-3",
        align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl",
      )}
    >
      {eyebrow && (
        <span className="text-primary inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold tracking-wide uppercase">
          <Sparkles className="size-3.5" aria-hidden />
          {eyebrow}
        </span>
      )}
      <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl lg:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="text-muted-foreground text-base leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/** The site's primary button. An `href` renders a link, otherwise a button. */
export function CtaButton({
  href,
  onClick,
  variant = "solid",
  className,
  disabled,
  children,
}: {
  href?: string;
  onClick?: () => void;
  variant?: "solid" | "outline" | "onDark";
  className?: string;
  /** Button form only — an in-flight action (enrolling, submitting) that must not fire twice. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const classes = cn(
    "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-100",
    variant === "solid" &&
      "bg-primary text-primary-foreground shadow-lg shadow-[var(--brand-soft)]",
    variant === "outline" &&
      "border-border hover:border-primary/60 hover:text-primary border",
    variant === "onDark" &&
      "border border-white/20 text-white/85 hover:bg-white/10 hover:text-white",
    disabled && "pointer-events-none opacity-60",
    className,
  );

  if (href) {
    const external = href.startsWith("http");
    return external ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
      >
        {children}
      </a>
    ) : (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classes}
    >
      {children}
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
.hero-float { animation: heroFloat 6s ease-in-out infinite; }
.hero-float-slow { animation: heroFloat 8s ease-in-out infinite; }
.hero-rise { opacity: 0; animation: heroRise 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }
@media (prefers-reduced-motion: reduce) {
  .hero-orb-1, .hero-orb-2, .hero-float, .hero-float-slow { animation: none; }
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
export function Hero({ actions }: { actions?: ReactNode }) {
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
    <section className="relative isolate overflow-hidden">
      <style>{HERO_CSS}</style>
      <HeroBackdrop style={style} image={hero.image_url} />

      <Container className="relative py-20 sm:py-24 lg:py-28">
        <div
          className={cn(
            "grid items-center gap-14",
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
              className="hero-rise mt-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-[3.5rem] lg:leading-[1.05]"
              style={{ animationDelay: "0.05s" }}
            >
              {title}
            </h1>

            <p
              className={cn(
                "hero-rise mt-5 max-w-xl text-lg leading-relaxed text-pretty",
                dark ? "text-white/75" : "text-muted-foreground",
              )}
              style={{ animationDelay: "0.12s" }}
            >
              {subtitle}
            </p>

            <div
              className="hero-rise mt-8 flex flex-col gap-3 sm:flex-row"
              style={{ animationDelay: "0.19s" }}
            >
              {actions}
            </div>

            {badges.length > 0 && (
              <div
                className="hero-rise mt-7 flex flex-wrap gap-2 border-t pt-6"
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

          {withVisual && <HeroVisual image={visualImage} />}
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



/**
 * The course-preview visual beside the copy. When the client supplied a hero image it is framed as a
 * playable course card with floating stat chips; otherwise a designed course-card mockup stands in,
 * so even a zero-configuration site looks like a real product rather than an empty column.
 */
function HeroVisual({ image }: { image: string }) {
  const t = useTranslations("learn");
  const { siteName } = useLearn();

  return (
    <div className="relative hidden lg:block">
      {/* Depth: a brand glow behind the card. */}
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-[var(--brand-soft)] blur-2xl" />

      <div className="hero-float relative">
        <div className="bg-card overflow-hidden rounded-[1.75rem] border shadow-2xl ring-1 ring-black/5">
          {/* Media / play */}
          <div className="relative aspect-video overflow-hidden">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="size-full object-cover" />
            ) : (
              <div
                className="size-full"
                style={{
                  background:
                    "linear-gradient(140deg, var(--brand) 0%, color-mix(in oklab, var(--brand) 55%, black) 100%)",
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-white/95 shadow-xl">
                <Play
                  className="text-primary ms-0.5 size-6 fill-current"
                  aria-hidden
                />
              </span>
            </span>
            <span className="text-primary absolute start-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold shadow">
              <Sparkles className="size-3.5" aria-hidden />{" "}
              {t("hero.card.badge")}
            </span>
          </div>

          {/* Body: a course-outline mock. */}
          <div className="space-y-4 p-5">
            <div>
              <p className="line-clamp-1 font-bold">{siteName}</p>
              <p className="text-muted-foreground text-xs">
                {t("hero.card.subtitle")}
              </p>
            </div>
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
                  {i === 0 && (
                    <span className="text-muted-foreground ms-auto text-[10px] font-medium">
                      4:20
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
    <Container className="relative z-20 -mt-12 pb-4">
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
    <Section tone={tone} divider={divider}>
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
              <h3 className="mb-1.5 font-semibold">{item.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
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
    <Section tone={tone} divider={divider}>
      <SectionHeading
        title={site.steps.heading || t("defaults.steps.heading")}
      />
      <ol className="grid gap-6 md:grid-cols-3">
        {items.map((item, i) => (
          <li key={item.title} className="relative">
            <span className="text-primary mb-4 flex size-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-lg font-bold tabular-nums">
              {i + 1}
            </span>
            <h3 className="mb-1.5 font-semibold">{item.title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
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

export function AboutSplit({ tone, divider }: SectionChrome = {}) {
  const t = useTranslations("learn");
  const { site, siteName } = useLearn();
  if (!site.about.show) return null;

  const body = site.about.body || t("defaults.about.body", { name: siteName });
  const image = site.about.image_url || DEFAULT_ABOUT_IMAGE;

  return (
    <Section tone={tone} divider={divider}>
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="space-y-5">
          <SectionHeading
            align="start"
            title={
              site.about.heading ||
              t("defaults.about.heading", { name: siteName })
            }
          />
          <p className="text-muted-foreground -mt-6 leading-relaxed whitespace-pre-wrap">
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
    <Section tone={tone} divider={divider}>
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
                className="mx-auto mb-4 size-20 rounded-full object-cover"
              />
            ) : (
              <span className="text-primary mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-[var(--brand-soft)] text-2xl font-bold">
                {person.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <h3 className="font-semibold">{person.name}</h3>
            {person.role && (
              <p className="text-primary text-sm font-medium">{person.role}</p>
            )}
            {person.bio && (
              <p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">
                {person.bio}
              </p>
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
    <Section tone={tone} divider={divider}>
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
            <blockquote className="flex-1 text-sm leading-relaxed">
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
}: SectionChrome & { limit?: number } = {}) {
  const t = useTranslations("learn");
  const { site } = useLearn();
  const [open, setOpen] = useState<number | null>(0);
  if (!site.faq.show) return null;

  const all =
    site.faq.items.length > 0
      ? site.faq.items
      : (t.raw("defaults.faq.items") as { q: string; a: string }[]);
  const items = limit ? all.slice(0, limit) : all;
  if (items.length === 0) return null;

  return (
    <Section tone={tone} divider={divider}>
      <SectionHeading title={site.faq.heading || t("defaults.faq.heading")} />
      <div className="mx-auto max-w-3xl space-y-3">
        {items.map((item, i) => (
          <div
            key={item.q}
            className="bg-card overflow-hidden rounded-2xl border"
          >
            <button
              type="button"
              aria-expanded={open === i}
              onClick={() => setOpen((cur) => (cur === i ? null : i))}
              className="hover:bg-muted/50 flex w-full items-center gap-3 px-5 py-4 text-start transition-colors"
            >
              <span className="flex-1 font-medium">{item.q}</span>
              <ChevronDown
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform",
                  open === i && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            {open === i && (
              <p className="text-muted-foreground border-t px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap">
                {item.a}
              </p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── closing CTA ───────────────────────────────────────────────────────────────

export function CtaBand({ onPrimary }: { onPrimary?: () => void }) {
  const t = useTranslations("learn");
  const { site, siteName } = useLearn();
  if (!site.cta.show) return null;

  return (
    <section className="relative isolate mt-20 overflow-hidden py-20">
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
          <h2 className="text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">
            {site.cta.title || t("defaults.cta.title", { name: siteName })}
          </h2>
          <p className="mx-auto max-w-lg text-white/65">
            {site.cta.subtitle || t("defaults.cta.subtitle")}
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            {site.cta.button_href ? (
              <CtaButton href={site.cta.button_href}>
                {site.cta.button_label || t("defaults.cta.button")}
              </CtaButton>
            ) : (
              <CtaButton onClick={onPrimary}>
                {site.cta.button_label || t("defaults.cta.button")}
              </CtaButton>
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
      <Container className="py-12 sm:py-16">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
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
