import { ArrowLeft, ArrowRight } from "lucide-react";
import { DemoForm } from "@/components/marketing/demo-form";
import { Faq } from "@/components/marketing/faq";
import { ProductShot } from "@/components/marketing/product-shot";
import {
  CheckItem,
  Container,
  CtaLink,
  Icon,
  Section,
  SectionHeading,
} from "@/components/marketing/ui";
import {
  COURSE_PLATFORM_PRICE,
  type MarketingContent,
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
}: {
  page: ProductPageContent;
  t: MarketingContent;
  locale: Locale;
}) {
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;
  const [lead, ...rest] = page.tour.shots;

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_70%)]"
        />
        <Container className="relative py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div>
              <h1 className="text-4xl font-bold text-balance sm:text-5xl sm:leading-[1.12]">
                {page.hero.title}
                {page.hero.titleAccent ? (
                  <>
                    {" "}
                    <span className="text-primary">{page.hero.titleAccent}</span>
                  </>
                ) : null}
              </h1>
              <p className="text-muted-foreground mt-6 text-lg leading-relaxed text-pretty">
                {page.hero.subtitle}
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <CtaLink href={page.hero.primary.href}>
                  {page.hero.primary.label}
                  <Arrow aria-hidden className="size-4" />
                </CtaLink>
                {page.hero.secondary ? (
                  <CtaLink href={page.hero.secondary.href} variant="secondary">
                    {page.hero.secondary.label}
                  </CtaLink>
                ) : null}
              </div>

              <ul className="text-muted-foreground mt-8 flex flex-col gap-2 text-sm">
                {page.hero.points.map((point) => (
                  <li key={point} className="flex items-center gap-2.5">
                    <span aria-hidden className="bg-accent size-1.5 rounded-full" />
                    {point}
                  </li>
                ))}
              </ul>

              {page.pricing.kind === "published" ? (
                <p className="border-border bg-card text-muted-foreground mt-8 rounded-xl border p-4 text-sm leading-relaxed">
                  <span className="text-foreground font-semibold">
                    {price(COURSE_PLATFORM_PRICE.firstYearMinor, locale)}
                  </span>{" "}
                  — {page.pricing.firstYearLabel}
                  {" · "}
                  <span className="text-foreground font-semibold">
                    {price(COURSE_PLATFORM_PRICE.renewalMinor, locale)}
                  </span>{" "}
                  — {page.pricing.renewalLabel}
                </p>
              ) : null}
            </div>

            {lead ? (
              <ProductShot
                shot={lead}
                priority
                sizes="(min-width: 1024px) 560px, 100vw"
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
                className="border-border bg-card rounded-2xl border p-6"
              >
                <h3 className="text-base font-semibold">{group.title}</h3>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="text-muted-foreground flex items-start gap-2.5 leading-relaxed"
                    >
                      <span
                        aria-hidden
                        className="bg-accent mt-2 size-1.5 shrink-0 rounded-full"
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
            {rest.map((s) => (
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
                <span className="bg-primary/8 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <Icon name={item.icon} className="size-5" />
                </span>
                <div>
                  <h3 className="text-base font-semibold">{item.title}</h3>
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

          <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {page.workflow.steps.map((step, index) => (
              <li key={step.title}>
                <span
                  aria-hidden
                  className="border-border text-primary flex size-9 items-center justify-center rounded-full border text-sm font-bold"
                >
                  {index + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
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

          <div className="border-border bg-card mx-auto mt-12 max-w-3xl rounded-2xl border p-6 sm:p-9">
            {page.pricing.kind === "published" ? (
              <div className="border-border grid gap-6 border-b pb-8 sm:grid-cols-2 sm:gap-10">
                <div>
                  <p className="text-muted-foreground text-sm font-semibold">
                    {page.pricing.firstYearLabel}
                  </p>
                  <p className="mt-2 text-3xl font-bold sm:text-4xl">
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
                  <p className="mt-2 text-3xl font-bold sm:text-4xl">
                    {price(COURSE_PLATFORM_PRICE.renewalMinor, locale)}
                  </p>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                    {page.pricing.renewalNote}
                  </p>
                </div>
              </div>
            ) : null}

            <h3 className="mt-8 text-base font-semibold">
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

      <Section tone="ink">
        <Container>
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="text-ink-foreground text-3xl font-bold text-balance sm:text-4xl">
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

            <DemoForm t={t} locale={locale} />
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
