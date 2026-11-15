"use client";

import { Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Enter" the group's online room straight from the timetable (Lingo 2026-11-15: "if the group has
 * a room link, give us a join button so we can get into the lesson"). A real link opened in a new
 * tab, so no popup blocker stands in the way. The room is the group's own link, else its teacher's.
 */
export function GroupEnterLink({ url, testId }: { url: string; testId?: string }) {
  const t = useTranslations("groups");
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300")}
      data-testid={testId}
    >
      <Video className="size-3.5" aria-hidden />
      {t("lessons.enterRoom")}
    </a>
  );
}
