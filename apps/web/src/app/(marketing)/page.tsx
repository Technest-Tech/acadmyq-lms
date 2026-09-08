import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ProductShot } from "@/components/marketing/product-shot";
import {
  CheckItem,
  Container,
  CtaLink,
  Eyebrow,
  Icon,
  Section,
  SectionHeading,
} from "@/components/marketing/ui";
import { marketing, ROUTES, type ProductBand } from "@/content/marketing";
import { pageMetadata } from "./page-meta";

/**
 * The Acadmyq homepage.
 *
 * Its job is to answer one question — which of the two systems is the visitor here for — and hand
 * them to the right product page. The Course Platform leads: it is first, it carries the hero
 * picture, and it is the destination of the hero's secondary button, because that is where the
 * advertising sends people.
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

  return (
    <>
      {/*
        The hero's tint is a single soft radial wash, not a gradient across the whole page and not a
        field of floating particles. It exists to lift the headline off the paper ground; anything
        louder would be decoration competing with the one message.
      */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_70%)]"
        />
        <Container className="relative pt-16 pb-12 sm:pt-24 sm:pb-16">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.15]">
              {home.hero.title}
              {home.hero.titleAccent ? (
                <>
                  {" "}
                  <span className="text-primary">{home.hero.titleAccent}</span>
                </>
              ) : null}
            </h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty">
              {home.hero.subtitle}
            </p>

            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <CtaLink href={home.hero.primary.href}>
                {home.hero.primary.label}
                <Arrow aria-hidden className="size-4" />
              </CtaLink>
              {home.hero.secondary ? (
                <CtaLink href={home.hero.secondary.href} variant="secondary">
                  {home.hero.secondary.label}
                </CtaLink>
              ) : null}
            </div>

            <ul className="text-muted-foreground mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
              {home.hero.points.map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <span aria-hidden className="bg-accent size-1.5 rounded-full" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/*
            The hero picture is a drawn example, not a capture (see `heroImage` in content/shots),
            and it arrives with its own window frame, its own shadow and a transparent ground. So it
            is rendered bare — no `ProductShot` border, no card, no caption — and simply floats on
            the page's paper. Every screenshot further down still goes through `ProductShot`.
          */}
          <div className="mx-auto mt-10 max-w-5xl">
            <Image
              src={home.heroImage.src}
              alt={home.heroImage.alt}
              width={home.heroImage.width}
              height={home.heroImage.height}
              sizes="(min-width: 1024px) 1024px, 100vw"
              priority
              className="h-auto w-full"
            />
          </div>
        </Container>
      </section>

      <Section tone="muted">
        <Container>
          <SectionHeading head={home.products.head} align="center" />

          <div className="mt-14 flex flex-col gap-16 sm:gap-24">
            <Band band={home.products.course} arrow={<Arrow aria-hidden className="size-4" />} />
            <Band
              band={home.products.management}
              reverse
              arrow={<Arrow aria-hidden className="size-4" />}
            />
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading head={home.shared.head} />

          <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {home.shared.items.map((item) => (
              <li key={item.title}>
                <span className="bg-primary/8 text-primary flex size-11 items-center justify-center rounded-xl">
                  <Icon name={item.icon} className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="text-muted-foreground mt-2 leading-relaxed">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section tone="ink">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-balance sm:text-4xl">
              {home.close.title}
            </h2>
            <p className="text-ink-foreground/75 mt-4 text-lg leading-relaxed text-pretty">
              {home.close.body}
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <CtaLink href={home.close.primary.href} variant="onInk">
                {home.close.primary.label}
              </CtaLink>
              <CtaLink href={home.close.secondary.href} variant="onInkGhost">
                {home.close.secondary.label}
              </CtaLink>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}

/** One product on the homepage: copy on one side, a real screen on the other. */
function Band({
  band,
  reverse = false,
  arrow,
}: {
  band: ProductBand;
  reverse?: boolean;
  arrow: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={reverse ? "lg:order-2" : undefined}>
        <Eyebrow>{band.eyebrow}</Eyebrow>
        <h3 className="mt-3 text-2xl font-bold text-balance sm:text-3xl">
          {band.title}
        </h3>
        <p className="text-muted-foreground mt-4 leading-relaxed">{band.body}</p>

        <ul className="mt-6 flex flex-col gap-3">
          {band.bullets.map((bullet) => (
            <CheckItem key={bullet}>{bullet}</CheckItem>
          ))}
        </ul>

        <Link
          href={band.cta.href}
          className="text-primary hover:text-primary/80 focus-visible:outline-ring mt-7 inline-flex items-center gap-2 rounded text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {band.cta.label}
          {arrow}
        </Link>
      </div>

      <ProductShot
        shot={band.shot}
        className={reverse ? "lg:order-1" : undefined}
        sizes="(min-width: 1024px) 560px, 100vw"
      />
    </div>
  );
}
