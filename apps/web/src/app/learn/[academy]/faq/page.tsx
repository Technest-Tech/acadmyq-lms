"use client";

import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLearn } from "@/components/learn/context";
import { CtaBand, FaqAccordion, PageHero } from "@/components/learn/sections";

/** Every question, not just the five the home page teases (docs/lms/09). */
export default function FaqPage() {
  const t = useTranslations("learn");
  const { site, openRedeem } = useLearn();

  if (!site.pages.faq) notFound();

  return (
    <>
      <PageHero
        title={site.faq.heading || t("defaults.faq.heading")}
        subtitle={t("faq.subtitle")}
      />
      <FaqAccordion />
      <CtaBand onPrimary={openRedeem} />
    </>
  );
}
