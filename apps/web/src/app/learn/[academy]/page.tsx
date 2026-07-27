"use client";

import { ArrowRight, Ticket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
import { learnCatalog, type LearnCourseCard } from "@/lib/learn-api";

/**
 * The academy's landing page (docs/lms/09) — the same section order for every LMS client: what they
 * teach, proof, the courses themselves, why here, how access works, who teaches, what students say,
 * the usual questions, and one closing ask. A client fills in as much as they want; sections with
 * nothing to show remove themselves.
 */
export default function SiteHomePage() {
  const t = useTranslations("learn");
  const { academy, site, openRedeem } = useLearn();
  const [courses, setCourses] = useState<LearnCourseCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    learnCatalog(academy)
      .then((r) => setCourses(r.courses))
      .catch(() => setFailed(true));
  }, [academy]);

  const featured = (courses ?? []).slice(0, 6);
  const hasMore = (courses?.length ?? 0) > featured.length;
  const heroCta = site.hero.primary_cta;

  return (
    <>
      <Hero
        actions={
          <>
            {heroCta === "redeem" ? (
              <CtaButton onClick={openRedeem}>
                <Ticket className="size-4" aria-hidden />
                {t("redeem.cta")}
              </CtaButton>
            ) : heroCta === "contact" && site.pages.contact ? (
              <CtaButton href={`/learn/${academy}/contact`}>{t("nav.contact")}</CtaButton>
            ) : (
              <CtaButton href={`/learn/${academy}/courses`}>
                {t("hero.browse")}
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </CtaButton>
            )}
            <CtaButton variant="onDark" onClick={openRedeem}>
              <Ticket className="size-4" aria-hidden />
              {t("redeem.cta")}
            </CtaButton>
          </>
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
          <p className="text-muted-foreground py-10 text-center text-sm">{t("errors.generic")}</p>
        ) : courses === null ? (
          <CourseGridSkeleton count={3} />
        ) : featured.length === 0 ? (
          <div className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center text-sm">
            {t("catalog.empty")}
          </div>
        ) : (
          <>
            <CourseGrid courses={featured} />
            {hasMore && (
              <div className="mt-10 text-center">
                <CtaButton variant="outline" href={`/learn/${academy}/courses`}>
                  {t("catalog.viewAll")}
                  <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                </CtaButton>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Each section carries its own background tone so the page has a visual rhythm rather than
          one flat surface, and a divider badge straddles each boundary. Sections that render
          nothing (no instructors, no reviews) take their divider with them — no orphan splitters. */}
      <FeatureGrid tone="muted" divider />
      <StepsRail tone="tint" divider />
      {site.pages.about && <AboutSplit tone="pattern" divider />}
      <InstructorGrid tone="muted" divider />
      <TestimonialGrid tone="tint" divider />
      <FaqAccordion limit={5} tone="plain" divider />

      {site.pages.faq && site.faq.show && (
        <Container className="-mt-8 text-center">
          <Link
            href={`/learn/${academy}/faq`}
            className="text-primary inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            {t("faq.viewAll")}
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        </Container>
      )}

      <CtaBand onPrimary={openRedeem} />
    </>
  );
}
