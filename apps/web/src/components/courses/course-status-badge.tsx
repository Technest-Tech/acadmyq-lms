"use client";

import { useTranslations } from "next-intl";
import { StatusPill, type PillTone } from "@/components/courses/lms-ui";
import type { CourseStatus } from "@/lib/api";

/** Draft is neutral, published is the "live" green, archived is the parked amber. */
const TONES: Record<CourseStatus, PillTone> = {
  DRAFT: "slate",
  PUBLISHED: "emerald",
  ARCHIVED: "amber",
};

/** A small pill for a course's lifecycle status. */
export function CourseStatusBadge({
  status,
  className,
}: {
  status: CourseStatus;
  className?: string;
}) {
  const t = useTranslations("courses");
  return (
    <StatusPill tone={TONES[status]} className={className}>
      {t(`status.${status}`)}
    </StatusPill>
  );
}
