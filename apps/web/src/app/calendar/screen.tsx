"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { WeeklyCalendar } from "@/components/scheduling/weekly-calendar";

/**
 * Client gate for the Calendar screen: rendered only when the session grants `session.read`.
 * UX gate only — the server enforces it (and a Teacher's feed is row-scoped to their own
 * sessions server-side, AC-5.9).
 */
export function CalendarScreen() {
  const t = useTranslations("scheduling");
  const { can } = useAuth();

  if (!can("session.read")) {
    return (
      <p className="text-muted-foreground text-sm">{t("calendar.empty")}</p>
    );
  }

  return <WeeklyCalendar />;
}
