import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DemoForm } from "@/components/marketing/demo-form";
import {
  HeroDemoPicture,
  MoneyDemo,
  PayrollDemo,
  PortalDemo,
  ReportDemo,
  ScheduleDemo,
  WhatsAppDemo,
} from "@/components/marketing/demo-visuals";
import { Faq } from "@/components/marketing/faq";
import {
  CheckItem,
  Container,
  CtaLink,
  Eyebrow,
  IconTile,
  Section,
  SectionHeading,
} from "@/components/marketing/ui";
import { marketing, ROUTES, type FeatureTile } from "@/content/marketing";
import { cn } from "@/lib/utils";
import { pageMetadata } from "./page-meta";

/**
 * The Acadmyq homepage.
 *
 * Its one job is to make an academy owner say "this is my day, organised". So it leads with the
 * academy management system — that is who the clients are (online Quran, language and tutoring
 * academies) — and walks the visitor through it in the order they feel it: what it looks like
 * (hero), whether it is for them (audiences), the mess it removes (before/after), what is inside
 * (feature grid), what happens around every lesson (a day), what they can add (modules), and why
 * their data is safe (foundation). The Course Platform is one of those modules and keeps its own
 * page, which is where course-creator advertising lands.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await marketing();

  return pageMetadata({
    meta: t.meta.home,
    path: ROUTES.home,
    ogImage: "/marketing/og-home.png",
    locale,
  });
}

export default async function HomePage() {
  const { locale, t } = await marketing();
  const home = t.home;
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;
  const tiles = home.features.tiles;

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────────────────────── */}
      {/*
        Pulled up under the sticky header (`-mt-16`) so the navy runs to the top of the window; the
        header paints itself transparent over it until the visitor scrolls. The drawing hangs off
        the bottom of the band into the strip below, which reserves the room for it.
      */}
      <section className="mk-ink relative -mt-16 pt-16">
        <div aria-hidden className="mk-lattice" />
        <Container wide className="relative pt-14 sm:pt-20">
          <div className="mx-auto max-w-4xl text-center">
            <Eyebrow onInk>{home.hero.badge}</Eyebrow>
            <h1 className="mt-6 text-[2.15rem] leading-[1.2] font-extrabold text-balance text-white sm:text-5xl lg:text-[3.6rem] lg:leading-[1.15]">
              {home.hero.title}{" "}
              {home.hero.titleAccent ? (
                <span className="bg-[linear-gradient(90deg,#F3D58A,#E2B550,#F3D58A)] bg-clip-text text-transparent">
                  {home.hero.titleAccent}
                </span>
              ) : null}
            </h1>
            <p className="text-ink-foreground/75 mx-auto mt-6 max-w-3xl text-base leading-relaxed text-pretty sm:text-lg">
              {home.hero.subtitle}
            </p>

            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <CtaLink href={home.hero.primary.href} variant="onInk">
                {home.hero.primary.label}
                <Arrow aria-hidden className="size-4" />
              </CtaLink>
              {home.hero.secondary ? (
                <CtaLink href={home.hero.secondary.href} variant="onInkGhost">
                  {home.hero.secondary.label}
                </CtaLink>
              ) : null}
            </div>

            <ul className="text-ink-foreground/70 mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
              {home.hero.points.map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <Check aria-hidden className="text-gold size-4" strokeWidth={3} />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative z-10 mx-auto mt-14 -mb-28 max-w-6xl sm:mt-16 sm:-mb-44 lg:-mb-56">
            <HeroDemoPicture demo={home.heroDemo} />
          </div>
        </Container>
      </section>

      {/* ── Built for ─────────────────────────────────────────────────────────────────────── */}
      <section className="pt-36 pb-6 sm:pt-56 lg:pt-72">
        <Container>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <span className="text-muted-foreground text-sm font-bold">{home.builtFor.label}</span>
            <ul className="flex flex-wrap justify-center gap-2">
              {home.builtFor.items.map((item) => (
                <li
                  key={item}
                  className="border-border text-foreground/80 rounded-full border bg-white px-3.5 py-1.5 text-sm font-bold"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* ── Who it's for ──────────────────────────────────────────────────────────────────── */}
      <Section id="audiences">
        <Container>
          <SectionHeading head={home.audiences.head} align="center" />

          <ul className="mt-14 grid gap-6 md:grid-cols-3">
            {home.audiences.items.map((card) => (
              <li key={card.title} className="mk-card mk-card--lift flex flex-col overflow-hidden rounded-3xl">
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={card.photo.src}
                    alt={card.photo.alt}
                    width={card.photo.width}
                    height={card.photo.height}
                    sizes="(min-width: 768px) 360px, 100vw"
                    className="size-full object-cover"
                  />
                  <span aria-hidden className="absolute inset-0 bg-[linear-gradient(to_top,oklch(0.2_0.045_264/0.55),transparent_55%)]" />
                  <span className="text-gold-foreground bg-gold absolute start-4 bottom-4 rounded-full px-3 py-1 text-xs font-bold">
                    {card.tag}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="text-xl font-extrabold">{card.title}</h3>
                  <p className="text-muted-foreground mt-2 leading-relaxed">{card.body}</p>
                  <ul className="mt-5 flex flex-col gap-2.5 text-[0.95rem]">
                    {card.points.map((point) => (
                      <CheckItem key={point}>{point}</CheckItem>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* ── Before / after ────────────────────────────────────────────────────────────────── */}
      <Section tone="muted">
        <div aria-hidden className="mk-lattice mk-lattice--light" />
        <Container className="relative">
          <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
            <div className="lg:sticky lg:top-24">
              <SectionHeading head={home.problem.head} />
              <div className="relative mt-8 hidden overflow-hidden rounded-3xl lg:block">
                <Image
                  src={home.problem.photo.src}
                  alt={home.problem.photo.alt}
                  width={home.problem.photo.width}
                  height={home.problem.photo.height}
                  sizes="420px"
                  className="aspect-[4/4.2] w-full object-cover"
                />
                <span aria-hidden className="absolute inset-0 bg-[linear-gradient(to_top,oklch(0.2_0.045_264/0.35),transparent_50%)]" />
              </div>
            </div>

            <div>
              <div className="text-muted-foreground mb-3 hidden grid-cols-2 gap-4 px-2 text-sm font-bold sm:grid">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2 rounded-full bg-rose-400" />
                  {home.problem.beforeTitle}
                </span>
                <span className="text-primary flex items-center gap-2">
                  <span aria-hidden className="bg-primary size-2 rounded-full" />
                  {home.problem.afterTitle}
                </span>
              </div>
              <ul className="flex flex-col gap-3">
                {home.problem.pairs.map((pair) => (
                  <li key={pair.before} className="mk-card grid overflow-hidden rounded-2xl sm:grid-cols-2">
                    <p className="flex items-start gap-3 bg-rose-50/40 p-4 text-[0.95rem] leading-relaxed text-slate-600 sm:p-5">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                        <X aria-hidden className="size-3.5" strokeWidth={3} />
                      </span>
                      <span>
                        <span className="sr-only">{home.problem.beforeTitle}: </span>
                        {pair.before}
                      </span>
                    </p>
                    <p className="text-foreground flex items-start gap-3 border-t border-dashed border-slate-200 p-4 text-[0.95rem] leading-relaxed font-bold sm:border-s sm:border-t-0 sm:p-5">
                      <span className="bg-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white">
                        <Check aria-hidden className="size-3.5" strokeWidth={3} />
                      </span>
                      <span>
                        <span className="sr-only">{home.problem.afterTitle}: </span>
                        {pair.after}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </Section>

      {/* ── Inside the system ─────────────────────────────────────────────────────────────── */}
      <Section id="features">
        <Container wide>
          <SectionHeading head={home.features.head} align="center" />

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            <Tile tile={tiles.schedule} className="lg:col-span-2">
              <ScheduleDemo demo={tiles.schedule.demo} />
            </Tile>
            <Tile tile={tiles.whatsapp}>
              <WhatsAppDemo demo={tiles.whatsapp.demo} />
            </Tile>
            <Tile tile={tiles.portal}>
              <PortalDemo demo={tiles.portal.demo} />
            </Tile>
            <Tile tile={tiles.money} className="lg:col-span-2">
              <MoneyDemo demo={tiles.money.demo} />
            </Tile>
            <Tile tile={tiles.payroll}>
              <PayrollDemo demo={tiles.payroll.demo} />
            </Tile>
            <Tile tile={tiles.reports}>
              <ReportDemo demo={tiles.reports.demo} />
            </Tile>

            <div className="mk-ink relative flex flex-col overflow-hidden rounded-3xl p-6 sm:p-7">
              <div aria-hidden className="mk-lattice" />
              <div className="relative">
                <h3 className="text-xl font-extrabold text-white">{home.features.more.title}</h3>
                <p className="text-ink-foreground/70 mt-2 leading-relaxed">{home.features.more.body}</p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {home.features.more.items.map((item) => (
                    <li
                      key={item}
                      className="text-ink-foreground/90 flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-sm font-bold"
                    >
                      <span aria-hidden className="bg-gold size-1.5 rounded-full" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* ── A day at your academy ─────────────────────────────────────────────────────────── */}
      <Section tone="ink" id="day">
        <Container>
          <SectionHeading head={home.day.head} align="center" onInk />

          <ol className="relative mt-16 grid gap-8 lg:grid-cols-5 lg:gap-5">
            <span aria-hidden className="absolute inset-x-[10%] top-7 hidden h-px bg-[linear-gradient(90deg,transparent,oklch(0.8_0.125_82/0.6),transparent)] lg:block" />
            {home.day.steps.map((step, index) => (
              <li key={step.title} className="relative flex gap-4 lg:flex-col lg:items-center lg:text-center">
                <span className="bg-ink ring-gold/40 relative flex size-14 shrink-0 items-center justify-center rounded-2xl ring-1">
                  <IconTile name={step.icon} onInk className="size-12 rounded-xl ring-0" />
                  <span className="bg-gold text-gold-foreground absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full text-[11px] font-extrabold">
                    {index + 1}
                  </span>
                </span>
                <div>
                  <p className="text-gold text-sm font-bold">{step.time}</p>
                  <h3 className="mt-1 text-lg font-extrabold text-white">{step.title}</h3>
                  <p className="text-ink-foreground/70 mt-2 text-[0.95rem] leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* ── Modules ───────────────────────────────────────────────────────────────────────── */}
      <Section id="modules">
        <Container>
          <SectionHeading head={home.modules.head} align="center" />

          <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {home.modules.items.map((module, index) => (
              <li
                key={module.name}
                className="mk-card mk-card--lift relative flex flex-col rounded-3xl p-6"
              >
                {index === 0 ? (
                  <span aria-hidden className="ring-gold/70 pointer-events-none absolute inset-0 rounded-3xl ring-2" />
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <IconTile name={module.icon} />
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-bold",
                      index === 0
                        ? "bg-gold text-gold-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {module.tag}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-extrabold">{module.name}</h3>
                <p className="text-muted-foreground mt-2 text-[0.95rem] leading-relaxed">{module.body}</p>
                <ul className="mt-5 flex flex-col gap-2 text-sm">
                  {module.points.map((point) => (
                    <CheckItem key={point}>{point}</CheckItem>
                  ))}
                </ul>
                {module.cta ? (
                  <Link
                    href={module.cta.href}
                    className="text-primary hover:text-primary/80 focus-visible:outline-ring mt-auto inline-flex items-center gap-1.5 rounded pt-6 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {module.cta.label}
                    <Arrow aria-hidden className="size-4" />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* ── Foundation ────────────────────────────────────────────────────────────────────── */}
      <Section tone="muted">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <SectionHeading head={home.foundation.head} />
              <div className="relative mt-8 hidden overflow-hidden rounded-3xl lg:block">
                <Image
                  src="/marketing/photos/parent.webp"
                  alt=""
                  width={1200}
                  height={800}
                  sizes="460px"
                  className="aspect-[3/2] w-full object-cover"
                />
              </div>
            </div>
            <ul className="grid gap-x-8 gap-y-9 sm:grid-cols-2">
              {home.foundation.items.map((item) => (
                <li key={item.title}>
                  <IconTile name={item.icon} />
                  <h3 className="mt-4 text-lg font-extrabold">{item.title}</h3>
                  <p className="text-muted-foreground mt-2 leading-relaxed">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      {/* ── FAQ ───────────────────────────────────────────────────────────────────────────── */}
      <Section>
        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <SectionHeading head={home.faq.head} />
            <Faq items={home.faq.items} />
          </div>
        </Container>
      </Section>

      {/* ── Close ─────────────────────────────────────────────────────────────────────────── */}
      <Section tone="ink" id="demo">
        <Container>
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="lg:pt-6">
              <h2 className="text-3xl leading-[1.25] font-extrabold text-balance text-white sm:text-4xl lg:text-[2.6rem]">
                {home.close.title}
              </h2>
              <p className="text-ink-foreground/75 mt-4 text-lg leading-relaxed text-pretty">
                {home.close.body}
              </p>
              <ul className="mt-8 flex flex-col gap-3.5">
                {home.close.points.map((point) => (
                  <CheckItem key={point} onInk>
                    {point}
                  </CheckItem>
                ))}
              </ul>
            </div>

            <DemoForm t={t} locale={locale} defaultProduct="ACADEMY_MANAGEMENT" />
          </div>
        </Container>
      </Section>
    </>
  );
}

/** One cell of the feature grid: its words on top, its drawn screen on a soft stage below. */
function Tile({
  tile,
  className,
  children,
}: {
  tile: FeatureTile;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article className={cn("mk-card flex flex-col rounded-3xl p-6 sm:p-7", className)}>
      <p className="text-primary text-sm font-bold">{tile.tag}</p>
      <h3 className="mt-2 text-xl leading-snug font-extrabold text-balance">{tile.title}</h3>
      <p className="text-muted-foreground mt-2 leading-relaxed">{tile.body}</p>
      <div className="mk-stage mt-6 flex flex-1 flex-col justify-center rounded-2xl p-3 sm:p-4">{children}</div>
    </article>
  );
}
