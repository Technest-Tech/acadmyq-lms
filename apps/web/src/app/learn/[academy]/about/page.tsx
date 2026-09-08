"use client";

import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLearn } from "@/components/learn/context";
import {
  AboutSplit,
  CtaBand,
  InstructorGrid,
  PageHero,
  StatsBand,
  TestimonialGrid,
} from "@/components/learn/sections";

/**
 * The academy's story (docs/lms/09 §6) — off entirely when the client switched the page off.
 *
 * Deliberately NOT a second copy of the home page. It used to render the same "why learn here"
 * feature grid the home page opens with, so a visitor who clicked "About" to find out who was
 * teaching them read the identical six blurbs again. What belongs here is the half of the profile
 * the home page never shows: the story, the mission, how they teach, who they are, and the numbers
 * they have actually earned.
 *
 * Every block hides itself when empty, so a client who wrote only a story gets a short, finished
 * page rather than a long one padded with generic filler.
 */
export default function AboutPage() {
  const t = useTranslations("learn");
  const { site, siteName, commerce, openRedeem } = useLearn();

  if (!site.pages.about) notFound();

  return (
    <>
      <PageHero
        title={site.about.heading || t("defaults.about.heading", { name: siteName })}
        subtitle={site.brand.tagline || t("about.subtitle")}
      />
      <StatsBand />
      <AboutSplit tone="plain" full />
      <InstructorGrid tone="pattern" divider />
      <TestimonialGrid tone="tint" divider />
      <CtaBand onPrimary={commerce.codes ? openRedeem : undefined} />
    </>
  );
}
