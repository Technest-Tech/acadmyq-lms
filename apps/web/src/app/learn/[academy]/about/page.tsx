"use client";

import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLearn } from "@/components/learn/context";
import {
  AboutSplit,
  CtaBand,
  FeatureGrid,
  InstructorGrid,
  PageHero,
  StatsBand,
  TestimonialGrid,
} from "@/components/learn/sections";

/** The academy's story (docs/lms/09) — off entirely when the client switched the page off. */
export default function AboutPage() {
  const t = useTranslations("learn");
  const { site, siteName, openRedeem } = useLearn();

  if (!site.pages.about) notFound();

  return (
    <>
      <PageHero
        title={site.about.heading || t("defaults.about.heading", { name: siteName })}
        subtitle={site.brand.tagline || undefined}
      />
      <StatsBand />
      <AboutSplit tone="plain" />
      <FeatureGrid tone="muted" divider />
      <InstructorGrid tone="pattern" divider />
      <TestimonialGrid tone="tint" divider />
      <CtaBand onPrimary={openRedeem} />
    </>
  );
}
