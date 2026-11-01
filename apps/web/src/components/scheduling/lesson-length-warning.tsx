"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ScheduleSlot } from "@/lib/api";

/**
 * The lesson length on a student's price and on their timetable are typed in two different places,
 * and the timetable is the one that counts: every lesson is billed and paid at its length. So when
 * they disagree, say it where it can still be fixed. Only a warning, because a difference can be
 * deliberate (siblings sharing one sitting, say).
 */
export function LessonLengthWarning({
  priced,
  slots,
}: {
  priced?: number | null;
  slots: Pick<ScheduleSlot, "duration_minutes">[];
}) {
  const t = useTranslations("scheduling");
  const differing = priced
    ? slots.find((s) => s.duration_minutes && s.duration_minutes !== priced)
    : undefined;
  if (!priced || !differing) return null;

  return (
    <p
      data-testid="lesson-length-warning"
      className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
      {t("lessonLengthMismatch", { priced, minutes: differing.duration_minutes })}
    </p>
  );
}
