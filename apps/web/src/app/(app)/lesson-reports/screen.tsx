"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { LessonReportsLog, type ReportsPeriod, type ReportsTab } from "@/components/reports/lesson-reports-log";

const PERIODS: readonly ReportsPeriod[] = ["all", "month", "last", "quarter"];

/**
 * Client gate for the reports log (session.read). `?tab=missing` opens on the lessons still owed a
 * report, `?student=<id>` on one student and `?period=month` on this month — the dashboard links here.
 */
export function LessonReportsScreen() {
  const t = useTranslations("lessonReports");
  const { can } = useAuth();
  const [initial, setInitial] = useState<{ tab: ReportsTab; student: string; period: ReportsPeriod } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setInitial({
      tab: params.get("tab") === "missing" ? "missing" : "written",
      student: params.get("student") ?? "",
      period: PERIODS.find((p) => p === params.get("period")) ?? "all",
    });
  }, []);

  if (!can("session.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }
  if (initial === null) return null;

  return <LessonReportsLog initialTab={initial.tab} initialStudent={initial.student} initialPeriod={initial.period} />;
}
