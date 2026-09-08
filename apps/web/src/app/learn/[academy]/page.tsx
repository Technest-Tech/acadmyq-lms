"use client";

import { ArrowRight, Ticket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useLearn } from "@/components/learn/context";
import { CourseGrid, CourseGridSkeleton } from "@/components/learn/course-card";
import {
  AboutSplit,
  Container,
  CtaBand,
  CtaButton,
  FaqAccordion,
  FeatureGrid,
  Hero,
  InstructorGrid,
  Section,
  SectionHeading,
  StatsBand,
  StepsRail,
  TestimonialGrid,
} from "@/components/learn/sections";
import { useHeroCta } from "@/components/learn/storefront";
import { learnCatalog, type LearnCourseCard } from "@/lib/learn-api";

/**
 * The academy's landing page (docs/lms/09) — the same section order for every LMS client: what they
 * teach, proof, the courses themselves, why here, how access works, who teaches, what students say,
 * the usual questions, and one closing ask. A client fills in as much as they want; sections with
 * nothing to show remove themselves.
 *
 * The course COLLECTIONS below (newest / free / popular) are built from real rows only, and each
 * only appears when it says something the main grid didn't. A "most popular" rail on a catalogue of
 * four courses is just the same four courses in a different order — and a popularity claim nobody
 * has earned yet.
 */
export default function SiteHomePage() {
  const t = useTranslations("learn");
  const { academy, site, commerce, openRedeem } = useLearn();
  const cta = useHeroCta();
  const [courses, setCourses] = useState<LearnCourseCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    learnCatalog(academy)
      .then((r) => setCourses(r.courses))
      .catch(() => setFailed(true));
  }, [academy]);

  const all = useMemo(() => courses ?? [], [courses]);
  const featured = all.slice(0, 6);
  const hasMore = all.length > featured.length;

  // Both extra rails are only worth their vertical space once the main grid is truncated —
  // otherwise they re-print courses the visitor can already see.
  const free = hasMore ? all.filter((c) => c.is_free).slice(0, 3) : [];
  const popular = useMemo(() => {
    if (!hasMore) return [];
    const enrolled = all.filter((c) => (c.learner_count ?? 0) > 0);
    // Three real enrolments-carrying courses is the floor for calling anything "most popular".
    return enrolled.length < 3
      ? []
      : [...enrolled]
          .sort((a, b) => (b.learner_count ?? 0) - (a.learner_count ?? 0))
          .slice(0, 3);
  }, [all, hasMore]);

  return (
    <>
      <Hero
        course={featured[0] ?? null}
        actions={
          <>
            {cta.primaryAction === "redeem" ? (
              <CtaButton onClick={openRedeem}>
                <Ticket className="size-4" aria-hidden />
                {cta.primaryLabel}
              </CtaButton>
            ) : (
              <CtaButton href={cta.primaryHref ?? `/learn/${academy}/courses`}>
                {cta.primaryLabel}
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </CtaButton>
            )}
            {cta.secondary && (
              <CtaButton variant="onDark" href={cta.secondary.href}>
                {cta.secondary.label}
              </CtaButton>
            )}
          </>
        }
        footnote={
          // The access code, demoted to a sentence. On a code-only site `useHeroCta` promotes it
          // back to the primary button instead — the copy follows the business, not the other way.
          cta.codeLink && cta.primaryAction !== "redeem" ? (
            <button
              type="button"
              onClick={openRedeem}
              className="inline-flex items-center gap-1.5 font-semibold underline decoration-current/40 underline-offset-4 transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
            >
              <Ticket className="size-4" aria-hidden />
              {t("hero.haveCode")}
            </button>
          ) : null
        }
      />

      <StatsBand />

      <Section id="courses">
        <SectionHeading
          eyebrow={t("catalog.eyebrow")}
          title={t("catalog.title")}
          subtitle={t("catalog.subtitle")}
        />

        {failed ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {t("errors.generic")}
          </p>
        ) : courses === null ? (
          <CourseGridSkeleton count={3} />
        ) : featured.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-16 text-center">
            <p className="font-semibold">{t("catalog.emptyTitle")}</p>
            <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
              {t("catalog.emptyHint")}
            </p>
          </div>
        ) : (
          <>
            <CourseGrid courses={featured} />
            {hasMore && (
              <div className="mt-10 text-center">
                <CtaButton
                  variant="outline"
                  href={`/learn/${academy}/courses`}
                >
                  {t("catalog.viewAll")}
                  <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                </CtaButton>
              </div>
            )}
          </>
        )}
      </Section>

      {free.length > 0 && (
        <Section tone="tint" divider>
          <SectionHeading
            title={t("home.free.title")}
            subtitle={t("home.free.subtitle")}
          />
          <CourseGrid courses={free} />
        </Section>
      )}

      {popular.length > 0 && (
        <Section tone="muted" divider>
          <SectionHeading
            title={t("home.popular.title")}
            subtitle={t("home.popular.subtitle")}
          />
          <CourseGrid courses={popular} />
        </Section>
      )}

      {/* Each section carries its own background tone so the page has a visual rhythm rather than
          one flat surface, and a divider badge straddles each boundary. Sections that render
          nothing (no instructors, no reviews) take their divider with them — no orphan splitters. */}
      <FeatureGrid tone={free.length > 0 || popular.length > 0 ? "plain" : "muted"} divider />
      <StepsRail tone="tint" divider />
      {site.pages.about && <AboutSplit tone="pattern" divider />}
      <InstructorGrid tone="muted" divider />
      <TestimonialGrid tone="tint" divider />
      <FaqAccordion limit={5} tone="plain" divider />

      {site.pages.faq && site.faq.show && (
        <Container className="-mt-6 text-center sm:-mt-8">
          <Link
            href={`/learn/${academy}/faq`}
            className="text-primary inline-flex items-center gap-1.5 rounded text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {t("faq.viewAll")}
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        </Container>
      )}

      {/* The site's single closing ask — the footer no longer repeats it (site-chrome.tsx). */}
      <CtaBand onPrimary={commerce.codes ? openRedeem : undefined} />
    </>
  );
}
