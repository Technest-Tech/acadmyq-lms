"use client";

import { ArrowRight, CalendarCheck2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLearn } from "@/components/learn/context";
import {
  CtaButton,
  Section,
  SectionHeading,
  type SectionChrome,
} from "@/components/learn/sections";

/**
 * The home page's booking band (docs/lms/13) — every form the client flagged "show on the home
 * page", under the client's own names ("احجز استشارة", "احجز كورس").
 *
 * One form gets the whole band: its title IS the heading and its button is the ask, because a
 * consultancy with one door should not be made to read a generic "How can we help?" first. Two or
 * more become cards under that generic heading. No flagged forms ⇒ nothing renders, divider included.
 */
export function BookingBand({ tone = "tint", divider }: SectionChrome) {
  const t = useTranslations("learn.booking");
  const { academy, commerce } = useLearn();
  const forms = (commerce.bookings ?? []).filter((b) => b.home);
  if (forms.length === 0) return null;

  const href = (slug: string) => `/learn/${academy}/book/${slug}`;

  const [only] = forms;
  if (forms.length === 1 && only) {
    const form = only;
    return (
      <Section tone={tone} divider={divider} id="booking">
        <div className="bg-card relative mx-auto max-w-4xl overflow-hidden rounded-3xl border p-7 text-center shadow-sm sm:p-12">
          <div
            className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-72 rounded-full bg-[var(--brand-soft)] blur-3xl"
            aria-hidden
          />
          <div className="relative space-y-5">
            <span className="text-primary mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)]">
              <CalendarCheck2 className="size-7" aria-hidden />
            </span>
            <h2 dir="auto" className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              {form.title}
            </h2>
            <p dir="auto" className="text-muted-foreground mx-auto max-w-xl leading-relaxed">
              {form.description || t("defaultIntro")}
            </p>
            <CtaButton href={href(form.slug)}>
              <span dir="auto">{form.title}</span>
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </CtaButton>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section tone={tone} divider={divider} id="booking">
      <SectionHeading
        eyebrow={t("homeEyebrow")}
        title={t("homeTitle")}
        subtitle={t("homeSubtitle")}
      />
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {forms.map((form) => (
          <li key={form.slug}>
            <div className="bg-card hover:border-primary/40 flex h-full flex-col gap-4 rounded-2xl border p-6 transition-[border-color,box-shadow] hover:shadow-md">
              <span className="text-primary flex size-11 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                <CalendarCheck2 className="size-5" aria-hidden />
              </span>
              <h3 dir="auto" className="text-lg font-bold">
                {form.title}
              </h3>
              <p dir="auto" className="text-muted-foreground flex-1 text-sm leading-relaxed">
                {form.description || t("defaultIntro")}
              </p>
              <CtaButton href={href(form.slug)} variant="outline" size="md" className="w-full">
                <span dir="auto">{form.title}</span>
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </CtaButton>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
