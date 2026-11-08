import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { DemoForm } from "@/components/marketing/demo-form";
import { Faq } from "@/components/marketing/faq";
import { ProductShot } from "@/components/marketing/product-shot";
import {
  CheckItem,
  Container,
  CtaLink,
  IconTile,
  Section,
  SectionHeading,
} from "@/components/marketing/ui";
import {
  COURSE_PLATFORM_PRICE,
  type MarketingContent,
  type ProductInterest,
  type ProductPageContent,
} from "@/content/marketing";
import type { Locale } from "@/i18n/config";
import { formatMoney } from "@/lib/money";

/**
 * The shared layout of both product pages.
 *
 * `/course-platform` and `/academy-management` are the same page with different words and different
 * screenshots, so they are the same component. The only thing that genuinely differs is the pricing
 * block — one product has a published annual offer, the other is quoted — and that difference is
 * carried by the content's discriminated union rather than by a second copy of the page.
 */
export function ProductPage({
  page,
  t,
  locale,
  product,
  heroVisual,
}: {
  page: ProductPageContent;
  t: MarketingContent;
  locale: Locale;
  /** The product this page sells — pre-ticked on its demo form. */
  product: ProductInterest;
  /**
   * A drawing to lead the hero instead of the tour's first capture. When given, the tour below
   * shows every capture, since none of them has been used up top.
   */
  heroVisual?: React.ReactNode;
}) {
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;
  const [lead, ...rest] = page.tour.shots;
  const tourShots = heroVisual ? page.tour.shots : rest;

  return (
    <>
      {/* Pulled up under the sticky header, which is transparent over this navy band until scroll. */}
      <section className="mk-ink relative -mt-16 overflow-hidden pt-16">
        <div aria-hidden className="mk-lattice" />
        <Container wide className="relative py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
            <div>
              <h1 className="text-4xl leading-[1.2] font-extrabold text-balance text-white sm:text-5xl lg:text-[3.3rem]">
                {page.hero.title}
                {page.hero.titleAccent ? (
                  <>
                    {" "}
                    <span className="bg-[linear-gradient(90deg,#F3D58A,#E2B550,#F3D58A)] bg-clip-text text-transparent">
                      {page.hero.titleAccent}
                    </span>
                  </>
                ) : null}
              </h1>
              <p className="text-ink-foreground/75 mt-6 text-lg leading-relaxed text-pretty">
                {page.hero.subtitle}
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <CtaLink href={page.hero.primary.href} variant="onInk">
                  {page.hero.primary.label}
                  <Arrow aria-hidden className="size-4" />
                </CtaLink>
                {page.hero.secondary ? (
                  <CtaLink href={page.hero.secondary.href} variant="onInkGhost">
                    {page.hero.secondary.label}
                  </CtaLink>
                ) : null}
              </div>

              <ul className="text-ink-foreground/75 mt-8 flex flex-col gap-2.5 text-[0.95rem]">
                {page.hero.points.map((point) => (
                  <li key={point} className="flex items-center gap-2.5">
                    <Check aria-hidden className="text-gold size-4 shrink-0" strokeWidth={3} />
                    {point}
                  </li>
                ))}
              </ul>

              {page.pricing.kind === "published" ? (
                <p className="text-ink-foreground/75 mt-8 rounded-2xl border border-white/12 bg-white/[0.06] p-4 text-sm leading-relaxed">
                  <span className="text-gold font-extrabold">
                    {price(COURSE_PLATFORM_PRICE.firstYearMinor, locale)}
                  </span>{" "}
                  — {page.pricing.firstYearLabel}
                  {" · "}
                  <span className="font-extrabold text-white">
                    {price(COURSE_PLATFORM_PRICE.renewalMinor, locale)}
                  </span>{" "}
                  — {page.pricing.renewalLabel}
                </p>
              ) : null}
            </div>

            {heroVisual ? (
              <div>{heroVisual}</div>
            ) : lead ? (
              <ProductShot
                shot={lead}
                priority
                onInk
                sizes="(min-width: 1024px) 600px, 100vw"
              />
            ) : null}
          </div>
        </Container>
      </section>

      <Section tone="muted">
        <Container>
          <SectionHeading head={page.audience.head} />

          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {page.audience.groups.map((group) => (
              <div
                key={group.title}
                className="mk-card relative overflow-hidden rounded-3xl p-6"
              >
                <span aria-hidden className="bg-gold absolute inset-x-6 top-0 h-0.5 rounded-b-full" />
                <h3 className="text-lg font-extrabold">{group.title}</h3>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="text-muted-foreground flex items-start gap-2.5 leading-relaxed"
                    >
                      <span
                        aria-hidden
                        className="bg-primary/60 mt-2.5 size-1.5 shrink-0 rounded-full"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section id="tour">
        <Container>
          <SectionHeading head={page.tour.head} />

          <div className="mt-12 grid gap-10 sm:grid-cols-2 sm:gap-8">
            {tourShots.map((s) => (
              <ProductShot
                key={s.src}
                shot={s}
                sizes="(min-width: 640px) 560px, 100vw"
              />
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="muted">
        <Container>
          <SectionHeading head={page.capabilities.head} />

          <ul className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2">
            {page.capabilities.items.map((item) => (
              <li key={item.title} className="flex gap-4">
                <IconTile name={item.icon} />
                <div>
                  <h3 className="text-lg font-extrabold">{item.title}</h3>
                  <p className="text-muted-foreground mt-1.5 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading head={page.workflow.head} />

          <ol className="relative mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <span aria-hidden className="absolute inset-x-[8%] top-6 hidden h-px bg-[linear-gradient(90deg,transparent,oklch(0.8_0.125_82/0.7),transparent)] lg:block" />
            {page.workflow.steps.map((step, index) => (
              <li key={step.title} className="relative">
                <span
                  aria-hidden
                  className="bg-ink text-gold ring-gold/40 flex size-12 items-center justify-center rounded-2xl text-lg font-extrabold ring-1"
                >
                  {index + 1}
                </span>
                <h3 className="mt-4 text-lg font-extrabold">{step.title}</h3>
                <p className="text-muted-foreground mt-2 leading-relaxed">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section id="pricing" tone="muted">
        <Container>
          <SectionHeading
            head={{
              eyebrow: page.pricing.eyebrow,
              title: page.pricing.title,
              body: page.pricing.body,
            }}
            align="center"
          />

          <div className="mk-card relative mx-auto mt-12 max-w-3xl overflow-hidden rounded-3xl p-6 sm:p-9">
            <span aria-hidden className="bg-gold absolute inset-x-0 top-0 h-1" />
            {page.pricing.kind === "published" ? (
              <div className="border-border grid gap-6 border-b pb-8 sm:grid-cols-2 sm:gap-10">
                <div>
                  <p className="text-muted-foreground text-sm font-semibold">
                    {page.pricing.firstYearLabel}
                  </p>
                  <p className="text-ink mt-2 text-3xl font-extrabold sm:text-4xl">
                    {price(COURSE_PLATFORM_PRICE.firstYearMinor, locale)}
                  </p>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                    {page.pricing.firstYearNote}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm font-semibold">
                    {page.pricing.renewalLabel}
                  </p>
                  <p className="text-ink mt-2 text-3xl font-extrabold sm:text-4xl">
                    {price(COURSE_PLATFORM_PRICE.renewalMinor, locale)}
                  </p>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                    {page.pricing.renewalNote}
                  </p>
                </div>
              </div>
            ) : null}

            <h3 className="mt-8 text-lg font-extrabold">
              {page.pricing.includesHeading}
            </h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {page.pricing.includes.map((item) => (
                <CheckItem key={item}>{item}</CheckItem>
              ))}
            </ul>

            <p className="border-border text-muted-foreground mt-8 border-t pt-6 text-sm leading-relaxed">
              {page.pricing.kind === "published"
                ? page.pricing.ownership
                : page.pricing.note}
            </p>

            <div className="mt-7">
              <CtaLink href={page.pricing.cta.href}>
                {page.pricing.cta.label}
                <Arrow aria-hidden className="size-4" />
              </CtaLink>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container className="max-w-3xl">
          <SectionHeading head={page.faq.head} />
          <div className="mt-10">
            <Faq items={page.faq.items} />
          </div>
        </Container>
      </Section>

      <Section tone="ink" id="demo">
        <Container>
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="text-3xl leading-[1.25] font-extrabold text-balance text-white sm:text-4xl">
                {page.close.title}
              </h2>
              <p className="text-ink-foreground/75 mt-4 text-lg leading-relaxed text-pretty">
                {page.close.body}
              </p>

              <ul className="mt-8 flex flex-col gap-3">
                {t.contact.expect.items.map((item) => (
                  <CheckItem key={item} onInk>
                    {item}
                  </CheckItem>
                ))}
              </ul>
            </div>

            <DemoForm t={t} locale={locale} defaultProduct={product} />
          </div>
        </Container>
      </Section>
    </>
  );
}

/**
 * A published price.
 *
 * Latin digits in BOTH locales (`-u-nu-latn` overrides the app's Arabic-Indic default): a price is
 * the one number on this page a visitor will retype into a message or a search box, and every
 * Egyptian storefront writes it this way. Whole amounts drop their `.00`, as a headline price
 * should.
 */
function price(minor: number, locale: Locale): string {
  return formatMoney(
    { amount: minor, currency: COURSE_PLATFORM_PRICE.currency },
    locale === "ar" ? "ar-EG-u-nu-latn" : "en",
    { trimZeroDecimals: true },
  );
}
