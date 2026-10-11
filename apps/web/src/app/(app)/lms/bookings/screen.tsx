"use client";

import { CalendarCheck2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { BookingsManager } from "@/components/courses/bookings-manager";
import { EmptyState } from "@/components/courses/lms-ui";

/**
 * Booking requests (docs/lms/13) — the inbox the course site's booking forms feed, and the forms.
 * RBAC gate only; the plan gate renders as the nav lock + a 402 server-side, same as Courses.
 */
export function BookingsScreen() {
  const t = useTranslations("bookings");
  const { can } = useAuth();

  if (!can("booking.read")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={CalendarCheck2} color="slate" title={t("noAccess")} />
      </div>
    );
  }

  return <BookingsManager />;
}
